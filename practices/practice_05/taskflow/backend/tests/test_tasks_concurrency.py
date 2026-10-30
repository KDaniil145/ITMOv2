"""T044: independent SQLite connections, synchronized real writes, complete states."""
import sqlite3
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from tests.support.concurrency import pair,synchronized_writes,ordered_writes


def body(i):return {'id':f'00000000-0000-4000-8000-{i:012x}','title':f'Задача {i} 😀','description':' Текст\n😀 ','status':'todo','priority':'high','due_date':'0001-01-01'}
def snapshot(path):
    with sqlite3.connect(path) as db:
        cursor=db.execute('SELECT * FROM tasks ORDER BY created_at,id');names=[x[0] for x in cursor.description]
        return [dict(zip(names,row)) for row in cursor],db.execute('SELECT id FROM retired_task_ids ORDER BY id').fetchall()


def test_twenty_overlapping_post_and_patch_pairs(database_path,monkeypatch):
    expected={}
    with TestClient(create_app(database_path)) as client:
        assert client.get('/api/tasks').status_code==200
        for i in range(20):
            data=body(i)
            with synchronized_writes(monkeypatch) as arrivals:
                a,b=pair(lambda:client.post('/api/tasks',json=data),lambda:client.post('/api/tasks',json=data))
            assert len(arrivals)==2 and len(set(arrivals))==2
            assert sorted([a.status_code,b.status_code])==[200,201] and a.json()==b.json()
            assert {k:a.json()[k] for k in data}==data
            expected[data['id']]=a.json()
        assert snapshot(database_path)==(sorted(expected.values(),key=lambda t:(t['created_at'],t['id'])),[])
        for i in range(20):
            data=body(i);url='/api/tasks/'+data['id']
            changes=[{'title':f'Первый {i}','due_date':None},{'description':f'Второй {i}','priority':'low'}]
            with synchronized_writes(monkeypatch) as arrivals:
                a,b=pair(lambda:client.patch(url,json={'version':1,**changes[0]}),lambda:client.patch(url,json={'version':1,**changes[1]}))
            assert len(arrivals)==2 and len(set(arrivals))==2
            assert sorted([a.status_code,b.status_code])==[200,409]
            winner=a if a.status_code==200 else b;chosen=changes[0 if a.status_code==200 else 1]
            previous=expected[data['id']];actual=winner.json()
            assert actual=={**previous,**chosen,'version':2,'updated_at':actual['updated_at']}
            assert actual['updated_at']>=previous['updated_at']
            expected[data['id']]=actual
            assert client.get(url).json()==actual
        assert snapshot(database_path)==(sorted(expected.values(),key=lambda t:(t['created_at'],t['id'])),[])


@pytest.mark.parametrize('order',[('noop','noop'),('noop','patch'),('patch','noop'),('patch','delete'),('delete','patch'),('post','delete'),('delete','post')])
def test_each_ordered_interleaving_is_explicit(database_path,monkeypatch,order):
    data=body(99);url='/api/tasks/'+data['id']
    with TestClient(create_app(database_path)) as client:
        initial=client.post('/api/tasks',json=data).json()
        def run(operation):
            if operation=='noop':return client.patch(url,json={'version':1,'title':data['title']})
            if operation=='patch':return client.patch(url,json={'version':1,'title':'Изменено'})
            if operation=='delete':return client.delete(url+'?version=1')
            return client.post('/api/tasks',json=data)
        with ordered_writes(monkeypatch) as (invoke,arrivals):
            results=pair(lambda:invoke(0,lambda:run(order[0])),lambda:invoke(1,lambda:run(order[1])))
        assert sorted(arrivals)==[0,1]
        expected={('noop','noop'):[200,200],('noop','patch'):[200,200],('patch','noop'):[200,409],('patch','delete'):[200,409],('delete','patch'):[204,404],('post','delete'):[200,204],('delete','post'):[204,409]}
        assert [r.status_code for r in results]==expected[order]
        rows,marks=snapshot(database_path)
        if 204 in expected[order]:assert rows==[] and marks==[(data['id'],)]
        else:
            result=initial if order==('noop','noop') else next(r.json() for r,op in zip(results,order) if op=='patch')
            assert rows==[result] and marks==[]


def test_two_overlapping_noops_preserve_all_fields(database_path,monkeypatch):
    data=body(1)
    with TestClient(create_app(database_path)) as client:
        initial=client.post('/api/tasks',json=data).json();url='/api/tasks/'+data['id']
        with synchronized_writes(monkeypatch) as arrivals:
            a,b=pair(lambda:client.patch(url,json={'version':1,'title':data['title']}),lambda:client.patch(url,json={'version':1,'priority':'high'}))
        assert len(set(arrivals))==2 and a.status_code==b.status_code==200
        assert a.json()==b.json()==initial
        assert snapshot(database_path)==([initial],[])
