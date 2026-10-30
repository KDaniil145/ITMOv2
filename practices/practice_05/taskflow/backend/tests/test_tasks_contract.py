"""US1 read contract (UI S1/S5, BE AC-01/03/11, API §§1/2/3/6/7)."""
import json
import sqlite3
from fastapi.testclient import TestClient
from app.main import create_app
from app.tasks.storage import connection


def seed(path,count=30):
    rows=[]
    with connection(path,write=True) as db:
        for i in reversed(range(count)):
            row=(f'00000000-0000-4000-8000-{i:012x}',f'Задача {i:04}',f'Описание 😀 {i}',
                 ['todo','in_progress','done'][i%3],['low','medium','high'][i%3],
                 None if i%2 else '0001-01-01', f'2026-10-30T00:00:00.{i//2:06}Z',
                 f'2026-10-30T00:00:00.{i//2:06}Z',1)
            db.execute('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?)',row)
            rows.append(dict(zip(['id','title','description','status','priority','due_date','created_at','updated_at','version'],row)))
    return sorted(rows,key=lambda t:(t['created_at'],t['id']))


def test_empty_list_and_missing_are_distinct(database_path):
    with TestClient(create_app(database_path)) as client:
        response=client.get('/api/tasks')
        assert response.status_code==200
        assert response.json()=={'items':[],'total':0}
        response=client.get('/api/tasks/00000000-0000-4000-8000-000000000000')
        assert response.status_code==404
        assert response.json()['error']=={'code':'task_not_found','message':'Задача не найдена','details':[]}


def test_complete_read_snapshot_order_microseconds_and_no_limit(database_path):
    expected=seed(database_path,1001)
    with TestClient(create_app(database_path)) as client:
        for _ in range(2):
            result=client.get('/api/tasks')
            assert result.status_code==200
            assert result.json()=={'items':expected,'total':1001}
        for task in [expected[0],expected[1],expected[2],expected[-1]]:
            result=client.get('/api/tasks/'+task['id'])
            assert result.status_code==200 and result.json()==task
            assert len(result.json())==9
            assert len(result.json()['created_at'].split('.')[1])==7


def test_invalid_reads_do_not_open_storage(database_path):
    with TestClient(create_app(database_path)) as client:
        for path in ['/api/tasks?filter=todo','/api/tasks/invalid','/api/tasks/00000000-0000-4000-8000-000000000000?version=1']:
            result=client.get(path)
            assert result.status_code==422 and result.json()['error']['code']=='validation_error'
        assert client.request('GET','/api/tasks',content='{}').json()['error']['details'][0]['code']=='body_not_allowed'
    assert not database_path.exists()


def test_failed_storage_is_never_empty_or_missing_and_recovers(database_path):
    expected=seed(database_path)
    before=database_path.read_bytes()
    database_path.write_bytes(b'corrupt database')
    with TestClient(create_app(database_path)) as client:
        for path in ['/api/tasks','/api/tasks/'+expected[0]['id']]:
            result=client.get(path)
            assert result.status_code==503
            assert result.json()['error']['code']=='storage_unavailable'
            assert 'corrupt' not in result.text
        assert database_path.read_bytes()==b'corrupt database'
        assert client.get('/api/health').json()=={'status':'ok'}
        database_path.write_bytes(before)
        assert client.get('/api/tasks').json()=={'items':expected,'total':30}


def test_read_data_survives_actual_worker_restart(database_path):
    from tests.support.processes import BackendProcess
    from urllib.request import urlopen
    expected=seed(database_path)
    server=BackendProcess(database_path)
    try:
        server.start().wait_ready()
        with urlopen(server.base_url+'/api/tasks') as result: assert json.load(result)['items']==expected
        server.restart(cwd=database_path.parent).wait_ready()
        with urlopen(server.base_url+'/api/tasks') as result: assert json.load(result)['items']==expected
    finally:
        server.stop()


def test_post_defaults_location_replay_and_persisted_state(database_path):
    id_='8b28fe8b-7a58-4c84-a733-1135f31237fe'
    with TestClient(create_app(database_path)) as client:
        first=client.post('/api/tasks',json={'id':id_,'title':' \tЗадача 😀\u00a0'})
        assert first.status_code==201
        assert first.headers['location']=='/api/tasks/'+id_
        task=first.json()
        assert task=={'id':id_,'title':'Задача 😀','description':'','status':'todo','priority':'medium','due_date':None,
                     'created_at':task['created_at'],'updated_at':task['created_at'],'version':1}
        import re
        assert re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z',task['created_at'])
        replay=client.post('/api/tasks',json={'id':id_,'title':'Задача 😀','description':'','status':'todo','priority':'medium','due_date':None})
        assert replay.status_code==200 and replay.json()==task
        assert client.get('/api/tasks/'+id_).json()==task
    with sqlite3.connect(database_path) as db:
        assert db.execute('SELECT count(*) FROM tasks').fetchone()[0]==1
        assert db.execute('SELECT title,due_date,version FROM tasks').fetchone()==('Задача 😀',None,1)


def test_post_all_statuses_due_date_and_duplicate_titles(database_path):
    with TestClient(create_app(database_path)) as client:
        for i,status in enumerate(['todo','in_progress','done']):
            result=client.post('/api/tasks',json={'id':f'00000000-0000-4000-8000-{i:012x}','title':'Одинаково',
                                                'description':'  Текст\n😀  ','status':status,'priority':'high','due_date':'0001-01-01'})
            assert result.status_code==201
            assert result.json()['status']==status and result.json()['description']=='  Текст\n😀  '
    with sqlite3.connect(database_path) as db:
        assert db.execute('SELECT count(*) FROM tasks').fetchone()[0]==3
        assert db.execute('SELECT DISTINCT due_date FROM tasks').fetchall()==[('0001-01-01',)]


def test_post_id_conflicts_do_not_change_either_table(database_path):
    id_='8b28fe8b-7a58-4c84-a733-1135f31237fe'
    original={'id':id_,'title':'x','description':'','status':'todo','priority':'medium','due_date':None}
    with TestClient(create_app(database_path)) as client:
        result=client.post('/api/tasks',json=original)
        assert result.status_code==201
        task=result.json()
        for field,value in [('title','other'),('description','other'),('status','done'),('priority','high'),('due_date','2024-02-29')]:
            conflict=client.post('/api/tasks',json={**original,field:value})
            assert conflict.status_code==409 and conflict.json()['error']['code']=='task_id_conflict'
            assert client.get('/api/tasks/'+id_).json()==task
        with connection(database_path,write=True) as db:
            db.execute('UPDATE tasks SET version=2 WHERE id=?',(id_,))
        conflict=client.post('/api/tasks',json=original)
        assert conflict.status_code==409
    with sqlite3.connect(database_path) as db:
        assert db.execute('SELECT title,version FROM tasks').fetchall()==[('x',2)]
        assert db.execute('SELECT count(*) FROM retired_task_ids').fetchone()[0]==0


def test_post_retired_id_stays_retired_after_worker_restart(database_path):
    import httpx
    from tests.support.processes import BackendProcess
    id_='8b28fe8b-7a58-4c84-a733-1135f31237fe'
    with connection(database_path,write=True) as db:
        db.execute('INSERT INTO retired_task_ids VALUES (?)',(id_,))
    server=BackendProcess(database_path)
    try:
        server.start().wait_ready()
        for _ in range(2):
            result=httpx.post(server.base_url+'/api/tasks',json={'id':id_,'title':'Не восстанавливать'})
            assert result.status_code==409
            assert result.json()['error']['details'][0]['code']=='retired'
            server.restart().wait_ready()
    finally: server.stop()
    with sqlite3.connect(database_path) as db:
        assert db.execute('SELECT count(*) FROM tasks').fetchone()[0]==0
        assert db.execute('SELECT id FROM retired_task_ids').fetchall()==[(id_,)]


def test_post_invalid_request_does_not_create_file(database_path):
    with TestClient(create_app(database_path)) as client:
        result=client.post('/api/tasks',json={'title':'x'})
        assert result.status_code==422 and result.json()['error']['details'][0]['code']=='missing'
    assert not database_path.exists()


def test_two_post_workers_synchronize_before_write_and_create_one_row(database_path,monkeypatch):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    import app.tasks.storage as storage
    with connection(database_path): pass
    original=storage.connection
    gate=threading.Barrier(2)
    def gated(path,*,write=False,fault=None):
        def checkpoint(point,db):
            if write and point=='before_begin': gate.wait(timeout=5)
            if fault: fault(point,db)
        return original(path,write=write,fault=checkpoint)
    monkeypatch.setattr(storage,'connection',gated)
    body={'id':'8b28fe8b-7a58-4c84-a733-1135f31237fe','title':'Один замысел'}
    with TestClient(create_app(database_path)) as client, ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(lambda _:client.post('/api/tasks',json=body),range(2)))
    assert sorted(r.status_code for r in responses)==[200,201]
    assert responses[0].json()==responses[1].json()
    with sqlite3.connect(database_path) as db:
        assert db.execute('SELECT id,title,version FROM tasks').fetchall()==[(body['id'],body['title'],1)]
        assert db.execute('SELECT count(*) FROM retired_task_ids').fetchone()[0]==0


import pytest
@pytest.mark.parametrize('point,expected_count',[('before_commit',0),('after_commit',1)])
def test_post_503_cannot_by_itself_prove_rollback(database_path,monkeypatch,point,expected_count):
    import app.tasks.storage as storage
    original=storage.connection
    def broken(path,*,write=False,fault=None):
        def checkpoint(name,db):
            if write and name==point: raise OSError('injected delivery/commit boundary failure')
            if fault: fault(name,db)
        return original(path,write=write,fault=checkpoint)
    monkeypatch.setattr(storage,'connection',broken)
    body={'id':'8b28fe8b-7a58-4c84-a733-1135f31237fe','title':'Граница фиксации'}
    with TestClient(create_app(database_path)) as client:
        response=client.post('/api/tasks',json=body)
        assert response.status_code==503 and response.json()['error']['code']=='storage_unavailable'
        with sqlite3.connect(database_path) as db:
            assert db.execute('SELECT count(*) FROM tasks').fetchone()[0]==expected_count
        monkeypatch.setattr(storage,'connection',original)
        replay=client.post('/api/tasks',json=body)
        assert replay.status_code==(200 if expected_count else 201)
        with sqlite3.connect(database_path) as db:
            assert db.execute('SELECT count(*) FROM tasks').fetchone()[0]==1


# US3: all assertions include read-back or SQLite state, not only HTTP status.
def test_patch_atomic_fields_omission_normalized_noop_and_stale(database_path):
    id_='8b28fe8b-7a58-4c84-a733-1135f31237fe'
    with TestClient(create_app(database_path)) as client:
        base=client.post('/api/tasks',json={'id':id_,'title':'До','description':'Текст','priority':'high','due_date':'0001-01-01'}).json()
        url='/api/tasks/'+id_
        changed=client.patch(url,json={'version':1,'title':'  После 😀  ','description':''}).json()
        assert changed.get('version')==2
        assert changed['title']=='После 😀' and changed['description']==''
        assert changed['due_date']==base['due_date'] and changed['priority']=='high'
        assert changed['created_at']==base['created_at'] and changed['updated_at']>=base['updated_at']
        noop=client.patch(url,json={'version':2,'title':'\tПосле 😀\u00a0'})
        assert noop.status_code==200 and noop.json()==changed
        stale=client.patch(url,json={'version':1,'title':'После 😀'})
        assert stale.status_code==409 and stale.json()['error']['code']=='version_conflict'
        invalid=client.patch(url,json={'version':2,'title':'Частичный','due_date':'2025-02-29'})
        assert invalid.status_code==422
        assert client.patch(url,json={'version':2}).status_code==422
        assert client.get(url).json()==changed
        cleared=client.patch(url,json={'version':2,'due_date':None,'status':'done'})
        assert cleared.status_code==200 and cleared.json()['due_date'] is None
    with sqlite3.connect(database_path) as db:
        assert db.execute('SELECT title,description,status,priority,due_date,version FROM tasks').fetchall()==[('После 😀','','done','high',None,3)]


def test_patch_maximum_and_clock_rollback(database_path):
    id_='8b28fe8b-7a58-4c84-a733-1135f31237fe'; maximum=9007199254740991
    with TestClient(create_app(database_path)) as client:
        client.post('/api/tasks',json={'id':id_,'title':'До'})
        with connection(database_path,write=True) as db:
            db.execute("UPDATE tasks SET version=?,updated_at='9999-12-31T23:59:59.999999Z'",(maximum-1,))
        url='/api/tasks/'+id_
        response=client.patch(url,json={'version':maximum-1,'title':'Предел'})
        assert response.status_code==200
        task=response.json(); assert task['version']==maximum
        assert task['updated_at']=='9999-12-31T23:59:59.999999Z'
        assert client.patch(url,json={'version':maximum,'title':'Предел'}).json()==task
        exhausted=client.patch(url,json={'version':maximum,'title':'Запрещено'})
        assert exhausted.status_code==409 and exhausted.json()['error']=={'code':'version_exhausted','message':'Достигнут предел версии задачи','details':[]}
        assert client.patch(url,json={'version':maximum-1,'title':'Предел'}).json()['error']['code']=='version_conflict'
        assert client.get(url).json()==task
    with sqlite3.connect(database_path) as db:
        assert db.execute('SELECT title,version FROM tasks').fetchall()==[('Предел',maximum)]


def test_patch_absent_validation_precedes_lookup(database_path):
    url='/api/tasks/8b28fe8b-7a58-4c84-a733-1135f31237fe'
    with TestClient(create_app(database_path)) as client:
        assert client.patch(url,json={'version':'abc','title':'x'}).status_code==422
        response=client.patch(url,json={'version':1,'title':'x'})
        assert response.status_code==404 and response.json()['error']['code']=='task_not_found'


def test_concurrent_real_patches_do_not_lose_updates(database_path,monkeypatch):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    import app.tasks.storage as storage
    id_='8b28fe8b-7a58-4c84-a733-1135f31237fe'
    with TestClient(create_app(database_path)) as client:
        client.post('/api/tasks',json={'id':id_,'title':'До'})
        original=storage.connection; gate=threading.Barrier(2)
        def gated(path,*,write=False,fault=None):
            def checkpoint(point,db):
                if write and point=='before_begin':gate.wait(timeout=5)
            return original(path,write=write,fault=checkpoint)
        monkeypatch.setattr(storage,'connection',gated)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda title:client.patch('/api/tasks/'+id_,json={'version':1,'title':title}),['Один','Два']))
        assert sorted(r.status_code for r in results)==[200,409]
        winner=next(r.json() for r in results if r.status_code==200)
    with sqlite3.connect(database_path) as db:
        assert db.execute('SELECT title,version FROM tasks').fetchall()==[(winner['title'],2)]


@pytest.mark.parametrize('point,new_state',[('before_commit',False),('after_commit',True)])
def test_patch_commit_failure_preserves_whole_old_or_new_state(database_path,monkeypatch,point,new_state):
    import app.tasks.storage as storage
    id_='8b28fe8b-7a58-4c84-a733-1135f31237fe';url='/api/tasks/'+id_
    with TestClient(create_app(database_path)) as client:
        base=client.post('/api/tasks',json={'id':id_,'title':'До','description':'До','due_date':'0001-01-01'}).json()
        original=storage.connection
        def broken(path,*,write=False,fault=None):
            def checkpoint(name,db):
                if write and name==point:raise OSError('injected PATCH commit boundary failure')
            return original(path,write=write,fault=checkpoint)
        monkeypatch.setattr(storage,'connection',broken)
        result=client.patch(url,json={'version':1,'title':'После','description':'После','due_date':None})
        assert result.status_code==503
        monkeypatch.setattr(storage,'connection',original)
        task=client.get(url).json()
        if new_state:
            assert (task['title'],task['description'],task['due_date'],task['version'])==('После','После',None,2)
            assert task['id']==base['id'] and task['created_at']==base['created_at']
        else:assert task==base
        with sqlite3.connect(database_path) as db:
            assert db.execute('SELECT title,description,due_date,version FROM tasks').fetchall()==[(task['title'],task['description'],task['due_date'],task['version'])]


@pytest.mark.parametrize('source',['todo','in_progress','done'])
@pytest.mark.parametrize('target',['todo','in_progress','done'])
@pytest.mark.parametrize('priority,due',[('low',None),('medium','0001-01-01'),('high','9999-12-31')])
def test_move_patch_preserves_other_fields_and_noop(database_path,source,target,priority,due):
    id_='8b28fe8b-7a58-4c84-a733-1135f31237fe';url='/api/tasks/'+id_
    with TestClient(create_app(database_path)) as client:
        base=client.post('/api/tasks',json={'id':id_,'title':'Текст 😀','description':'  Не менять\n😀 ','status':source,'priority':priority,'due_date':due}).json()
        response=client.patch(url,json={'version':base['version'],'status':target})
        assert response.status_code==200
        result=response.json()
        for field in ('id','title','description','priority','due_date','created_at'):assert result[field]==base[field]
        assert result['status']==target and result['version']==(1 if source==target else 2)
        if source==target:assert result==base
        else:assert result['updated_at']>=base['updated_at']
        assert client.get(url).json()==result
    with sqlite3.connect(database_path) as db:
        cursor=db.execute('SELECT * FROM tasks');names=[column[0] for column in cursor.description]
        assert dict(zip(names,cursor.fetchone()))==result


def test_moved_old_card_keeps_microsecond_order_after_restart(database_path):
    import httpx
    from tests.support.processes import BackendProcess
    tasks=seed(database_path,6);id_=tasks[0]['id']
    with TestClient(create_app(database_path)) as client:
        response=client.patch('/api/tasks/'+id_,json={'version':1,'status':'in_progress'})
        assert response.status_code==200
        expected=client.get('/api/tasks').json()
        assert [t['id'] for t in expected['items'] if t['status']=='in_progress']==[tasks[i]['id'] for i in (0,1,4)]
    server=BackendProcess(database_path)
    try:
        server.start().wait_ready()
        assert httpx.get(server.base_url+'/api/tasks').json()==expected
        server.restart().wait_ready()
        assert httpx.get(server.base_url+'/api/tasks').json()==expected
    finally:server.stop()


@pytest.mark.parametrize('status',['todo','in_progress','done'])
def test_delete_contract_retired_and_unrelated_tasks(database_path,status):
    tasks=seed(database_path,3);target=tasks[['todo','in_progress','done'].index(status)];url='/api/tasks/'+target['id']
    with TestClient(create_app(database_path)) as client:
        before=client.get('/api/tasks').json()['items']
        response=client.delete(url+'?version=1')
        assert response.status_code==204 and response.content==b''
        assert client.get(url).status_code==404
        assert client.delete(url+'?version=1').status_code==404
        remaining=client.get('/api/tasks').json()
        assert remaining=={'items':[t for t in before if t['id']!=target['id']],'total':2}
        for title in [target['title'],'Другое содержимое']:
            result=client.post('/api/tasks',json={'id':target['id'],'title':title})
            assert result.status_code==409 and result.json()['error']['code']=='task_id_retired'
    with sqlite3.connect(database_path) as db:
        assert db.execute('SELECT * FROM retired_task_ids').fetchall()==[(target['id'],)]
        assert not db.execute('SELECT id FROM tasks INTERSECT SELECT id FROM retired_task_ids').fetchall()
        assert [r[1] for r in db.execute('PRAGMA table_info(retired_task_ids)')]==['id']


@pytest.mark.parametrize('query,code',[('', 'missing'),('?version=01','invalid_format'),('?version=1&version=1','duplicate_parameter'),('?version=9007199254740992','invalid_value'),('?version=+1','invalid_format'),('?version=1&extra=x','unknown_parameter')])
def test_delete_validation_precedes_lookup_without_writes(database_path,query,code):
    with TestClient(create_app(database_path)) as client:
        result=client.delete('/api/tasks/8b28fe8b-7a58-4c84-a733-1135f31237fe'+query)
        assert result.status_code==422
        assert result.json()['error']['details'][0]['code']==code
    assert not database_path.exists()


def test_delete_stale_max_and_patch_delete_orderings(database_path):
    task=seed(database_path,1)[0];url='/api/tasks/'+task['id']
    with TestClient(create_app(database_path)) as client:
        patched=client.patch(url,json={'version':1,'title':'Свежее'}).json()
        stale=client.delete(url+'?version=1')
        assert stale.status_code==409 and stale.json()['error']['code']=='version_conflict'
        assert client.get(url).json()==patched
        with connection(database_path,write=True) as db:db.execute('UPDATE tasks SET version=9007199254740991')
        assert client.delete(url+'?version=9007199254740991').status_code==204
        assert client.patch(url,json={'version':9007199254740991,'title':'После удаления'}).status_code==404
    with sqlite3.connect(database_path) as db:
        assert db.execute('SELECT count(*) FROM tasks').fetchone()[0]==0
        assert db.execute('SELECT id FROM retired_task_ids').fetchall()==[(task['id'],)]


@pytest.mark.parametrize('operations',[('delete','delete'),('patch','delete'),('post','delete')])
def test_concurrent_delete_serializes_with_other_writes(database_path,monkeypatch,operations):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    import app.tasks.storage as storage
    task=seed(database_path,1)[0];url='/api/tasks/'+task['id'];original=storage.connection;gate=threading.Barrier(2)
    def gated(path,*,write=False,fault=None):
        def checkpoint(point,db):
            if write and point=='before_begin':gate.wait(timeout=5)
        return original(path,write=write,fault=checkpoint)
    monkeypatch.setattr(storage,'connection',gated)
    with TestClient(create_app(database_path)) as client:
        def perform(operation):
            if operation=='delete':return client.delete(url+'?version=1')
            if operation=='patch':return client.patch(url,json={'version':1,'title':'Победитель'})
            return client.post('/api/tasks',json={key:task[key] for key in ('id','title','description','status','priority','due_date')})
        with ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(perform,operations))
    codes=tuple(r.status_code for r in responses)
    if operations==('delete','delete'):assert sorted(codes)==[204,404]
    elif operations==('patch','delete'):assert codes in {(200,409),(404,204)}
    else:assert codes in {(200,204),(409,204)}
    with sqlite3.connect(database_path) as db:
        row=db.execute('SELECT title,version FROM tasks').fetchone();marks=db.execute('SELECT id FROM retired_task_ids').fetchall()
        if row:assert row==('Победитель',2) and marks==[]
        else:assert marks==[(task['id'],)]


def test_http_all_seventeen_details_and_eleven_upper_codes(database_path,monkeypatch):
    """Independent contract vocabulary exercised at the real HTTP boundary."""
    data={'id':'8b28fe8b-7a58-4c84-a733-1135f31237fe','title':'Исходное'}
    url='/api/tasks/'+data['id'];seen_details=set();seen_errors=set()
    def check(response,status,upper,details):
        assert response.status_code==status
        payload=response.json()['error'];assert set(payload)=={'code','message','details'}
        assert payload['code']==upper and isinstance(payload['message'],str)
        got=[(d['field'],d['code']) for d in payload['details']]
        assert got==details and got==sorted(got)
        assert all(set(d)=={'field','code','message'} for d in payload['details'])
        assert not any(s in response.text for s in ['Traceback','SELECT ','sqlite3.','/home/'])
        seen_details.update(code for _,code in got);seen_errors.add((status,upper))
    with TestClient(create_app(database_path)) as client:
        created=client.post('/api/tasks',json=data);assert created.status_code==201 and created.headers['location']==url
        base=client.get('/api/tasks').json()
        cases=[
            ({'id':data['id']},'title','missing'),
            ({**data,'title':None},'title','invalid_type'),
            ({**data,'title':''},'title','invalid_length'),
            ({**data,'priority':'HIGH'},'priority','invalid_value'),
            ({**data,'id':data['id'].upper()},'id','invalid_format'),
            ({**data,'due_date':'2025-02-29'},'due_date','invalid_date'),
            ({**data,'title':'a\tb'},'title','invalid_characters'),
            ({**data,'title':'\ud800'},'title','invalid_unicode'),
            ({**data,'other':None},'other','unknown_field'),
            ({**data,'created_at':None},'created_at','read_only'),
        ]
        for body,field,code in cases:
            response=client.post('/api/tasks',content=json.dumps(body),headers={'Content-Type':'application/json'})
            check(response,422,'validation_error',[(field,code)])
            assert client.get('/api/tasks').json()==base
        check(client.get('/api/tasks?x=1'),422,'validation_error',[('x','unknown_parameter')])
        check(client.delete(url+'?version=01&version=1'),422,'validation_error',[('version','duplicate_parameter')])
        check(client.patch(url,json={'version':1}),422,'validation_error',[('$','empty_update')])
        check(client.request('GET',url,content=b'x'),422,'validation_error',[('$','body_not_allowed')])
        check(client.request('DELETE',url+'?version=1',content=b'x'),422,'validation_error',[('$','body_not_allowed')])
        check(client.patch(url,json={'version':2,'title':data['title']}),409,'version_conflict',[('version','stale_version')])
        check(client.post('/api/tasks',json={**data,'title':'Занято'}),409,'task_id_conflict',[('id','id_conflict')])
        check(client.post('/api/tasks',content='{"id":1,"id":2}',headers={'Content-Type':'application/json'}),400,'invalid_json',[])
        check(client.post('/api/tasks',content='{bad',headers={'Content-Type':'text/plain'}),415,'unsupported_media_type',[])
        for method,path,allow in [('PUT','/api/tasks',{'GET','POST'}),('POST',url,{'GET','PATCH','DELETE'})]:
            response=client.request(method,path);check(response,405,'method_not_allowed',[])
            assert set(x.strip() for x in response.headers['allow'].split(','))==allow
        check(client.get('/api/tasks/00000000-0000-4000-8000-000000000099'),404,'task_not_found',[])
        with connection(database_path,write=True) as db:db.execute('UPDATE tasks SET version=9007199254740991')
        check(client.patch(url,json={'version':9007199254740991,'title':'Реальное'}),409,'version_exhausted',[])
        response=client.delete(url+'?version=9007199254740991');assert response.status_code==204 and response.content==b''
        check(client.post('/api/tasks',json=data),409,'task_id_retired',[('id','retired')])
        import app.tasks.storage as storage
        with monkeypatch.context() as patch:
            patch.setattr(storage,'list_tasks',lambda path:(_ for _ in ()).throw(RuntimeError('SELECT secret /home/private')))
            check(client.get('/api/tasks'),500,'internal_error',[])
        original=database_path.read_bytes();database_path.write_bytes(b'corrupted-owned-fixture')
        try:check(client.get('/api/tasks'),503,'storage_unavailable',[])
        finally:database_path.write_bytes(original)
    assert seen_details=={'missing','invalid_type','invalid_length','invalid_value','invalid_format','invalid_date','invalid_characters','invalid_unicode','unknown_field','read_only','unknown_parameter','duplicate_parameter','empty_update','body_not_allowed','stale_version','id_conflict','retired'}
    assert seen_errors=={(400,'invalid_json'),(415,'unsupported_media_type'),(422,'validation_error'),(404,'task_not_found'),(409,'version_conflict'),(409,'task_id_conflict'),(409,'task_id_retired'),(409,'version_exhausted'),(405,'method_not_allowed'),(503,'storage_unavailable'),(500,'internal_error')}


@pytest.mark.parametrize('body,expected',[
 ({'version':1,'id':None},[('id','read_only')]),
 ({'version':1,'title':None,'unknown':None},[('title','invalid_type'),('unknown','unknown_field')]),
 ({'version':1,'title':'x'*201+'\ud800'},[('title','invalid_unicode')]),
 ({'version':1,'title':'x'*201+'\tx'},[('title','invalid_length')]),
 ({'version':'bad','title':''},[('title','invalid_length'),('version','invalid_type')]),
])
def test_http_priority_before_absence_and_sorted_independent_errors(database_path,body,expected):
    with TestClient(create_app(database_path)) as client:
        response=client.patch('/api/tasks/00000000-0000-4000-8000-000000000099',content=json.dumps(body),headers={'Content-Type':'application/json'})
        assert response.status_code==422
        assert [(d['field'],d['code']) for d in response.json()['error']['details']]==expected
    assert not database_path.exists()
