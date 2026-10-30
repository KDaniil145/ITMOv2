"""T046: genuine locks/access failures plus internal pre/post COMMIT failures."""
import os
import sqlite3
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from tests.support.faults import fail_at
from tests.test_tasks_concurrency import body,snapshot


@pytest.mark.parametrize('lock,method',[('EXCLUSIVE','GET'),('EXCLUSIVE','POST'),('EXCLUSIVE','PATCH'),('EXCLUSIVE','DELETE'),('IMMEDIATE','PATCH')])
def test_real_sqlite_lock_is_503_never_empty_or_missing(database_path,lock,method):
    with TestClient(create_app(database_path)) as client:
        task=client.post('/api/tasks',json=body(1)).json();before=snapshot(database_path)
        blocker=sqlite3.connect(database_path,autocommit=True)
        try:
            blocker.execute('BEGIN '+lock)
            url='/api/tasks' if method in {'GET','POST'} else '/api/tasks/'+task['id']
            response=client.request(method,url+('?version=1' if method=='DELETE' else ''),**({'json':body(2)} if method=='POST' else {'json':{'version':1,'title':'Не менять'}} if method=='PATCH' else {}))
            assert response.status_code==503 and response.json()['error']['code']=='storage_unavailable'
            assert client.get('/api/health').json()=={'status':'ok'}
        finally:blocker.execute('ROLLBACK');blocker.close()
        assert snapshot(database_path)==before


def test_real_permission_denial_is_503_and_keeps_bytes(database_path):
    # chmod is meaningful only for the actual unprivileged account.
    assert os.geteuid()!=0,'Run this test unprivileged; root chmod is not evidence'
    with TestClient(create_app(database_path)) as client:
        assert client.post('/api/tasks',json=body(1)).status_code==201
        original=database_path.read_bytes();database_path.chmod(0)
        try:
            response=client.get('/api/tasks')
            assert response.status_code==503 and response.json()['error']['code']=='storage_unavailable'
            assert client.get('/api/health').status_code==200
        finally:database_path.chmod(0o600)
        assert database_path.read_bytes()==original


def test_corruption_and_readonly_directory_are_not_reset(database_path):
    with TestClient(create_app(database_path)) as client:
        database_path.write_bytes(b'corrupted-owned-fixture')
        assert client.get('/api/tasks').status_code==503
        assert database_path.read_bytes()==b'corrupted-owned-fixture'
    assert os.geteuid()!=0
    nested=database_path.parent/'locked';nested.mkdir();nested.chmod(0o500)
    try:
        with TestClient(create_app(nested/'tasks.sqlite3')) as client:
            assert client.post('/api/tasks',json=body(1)).status_code==503
            assert client.get('/api/health').status_code==200
            assert not (nested/'tasks.sqlite3').exists()
    finally:nested.chmod(0o700)


@pytest.mark.parametrize('point',['before_begin','after_begin','before_commit','after_commit'])
@pytest.mark.parametrize('operation',['POST','PATCH','DELETE'])
def test_write_boundary_failure_keeps_whole_expected_state(database_path,monkeypatch,point,operation):
    data=body(1)
    with TestClient(create_app(database_path)) as client:
        if operation!='POST':assert client.post('/api/tasks',json=data).status_code==201
        else:assert client.get('/api/tasks').status_code==200
        before=snapshot(database_path)
        with fail_at(monkeypatch,point):
            if operation=='POST':response=client.post('/api/tasks',json=data)
            elif operation=='PATCH':response=client.patch('/api/tasks/'+data['id'],json={'version':1,'title':'Новый','due_date':None})
            else:response=client.delete('/api/tasks/'+data['id']+'?version=1')
            assert response.status_code==503
            assert client.get('/api/health').json()=={'status':'ok'}
        after=snapshot(database_path)
        if point!='after_commit':assert after==before
        elif operation=='DELETE':assert after==([] ,[(data['id'],)])
        elif operation=='POST':assert len(after[0])==1 and after[1]==[] and {k:after[0][0][k] for k in data}==data
        else:
            actual=after[0][0]
            assert after==([{**before[0][0],'title':'Новый','due_date':None,'version':2,'updated_at':actual['updated_at']}],[])


def test_existing_readonly_file_allows_read_but_denies_write_without_changes(database_path):
    assert os.geteuid()!=0
    with TestClient(create_app(database_path)) as client:
        task=client.post('/api/tasks',json=body(1)).json();before=database_path.read_bytes()
        database_path.chmod(0o400)
        try:
            read=client.get('/api/tasks/'+task['id']);assert read.status_code==200 and read.json()==task
            response=client.patch('/api/tasks/'+task['id'],json={'version':1,'title':'Не сохранять'})
            assert response.status_code==503 and response.json()['error']['code']=='storage_unavailable'
        finally:database_path.chmod(0o600)
        assert database_path.read_bytes()==before
