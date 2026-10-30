"""T007/T008: real files and transaction foundation, not CRUD acceptance."""
from datetime import datetime
from pathlib import Path
import sqlite3
import pytest
from app.config import BACKEND_ROOT, resolve_database_path
from app.tasks.errors import TaskError
from app.tasks.storage import connection
from tests.support.fixtures import isolated_database

ID='8b28fe8b-7a58-4c84-a733-1135f31237fe'


def test_configuration_independent_of_cwd(monkeypatch,database_path):
    monkeypatch.delenv('TASKFLOW_DB_PATH',raising=False)
    assert resolve_database_path()==BACKEND_ROOT/'data/taskflow.sqlite3'
    monkeypatch.setenv('TASKFLOW_DB_PATH','.test-data/custom/tasks.sqlite3')
    expected=BACKEND_ROOT/'.test-data/custom/tasks.sqlite3'
    monkeypatch.chdir(database_path.parent)
    assert resolve_database_path()==expected
    assert resolve_database_path(database_path)==database_path


def test_schema_and_reopen(database_path):
    assert not database_path.exists()
    with connection(database_path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==1
        columns=db.execute('PRAGMA table_info(tasks)').fetchall()
        assert [row[1] for row in columns]==['id','title','description','status','priority','due_date','created_at','updated_at','version']
        assert [row[2] for row in columns]==['TEXT']*8+['INTEGER']
        assert {row[1] for row in columns if not row[3]}=={'due_date'}
        assert [row[1] for row in db.execute('PRAGMA table_info(retired_task_ids)')]==['id']
        index=db.execute('PRAGMA index_xinfo(tasks_created_id)').fetchall()
        assert [(row[2],row[4]) for row in index if row[5]]==[('created_at','BINARY'),('id','BINARY')]
        assert db.execute('PRAGMA journal_mode').fetchone()[0]=='delete'
        assert db.execute('PRAGMA synchronous').fetchone()[0]==2
        assert db.execute('PRAGMA busy_timeout').fetchone()[0]==5000
    with pytest.raises(sqlite3.ProgrammingError):
        db.execute('SELECT 1')
    with connection(database_path) as reopened:
        assert reopened.execute('SELECT count(*) FROM tasks').fetchone()[0]==0


@pytest.mark.parametrize('change',[
 {'title':None},{'status':'TODO'},{'priority':'urgent'}, {'version':0},
 {'version':9007199254740992},{'version':1.5},{'description':None},
])
def test_schema_constraints(database_path,change):
    values={'id':ID,'title':'Задача','description':'','status':'todo','priority':'medium','due_date':None,
            'created_at':'2026-10-30T00:00:00.000001Z','updated_at':'2026-10-30T00:00:00.000001Z','version':1}
    values.update(change)
    with pytest.raises(TaskError) as caught:
        with connection(database_path,write=True) as db:
            db.execute('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?)',tuple(values.values()))
    assert caught.value.code == 'internal_error'
    assert isinstance(caught.value.__cause__, sqlite3.IntegrityError)
    with connection(database_path) as db:
        assert db.execute('SELECT count(*) FROM tasks').fetchone()[0]==0


def test_commit_rollback_and_minimal_retired_table(database_path):
    with connection(database_path,write=True) as db:
        db.execute('INSERT INTO retired_task_ids VALUES (?)',(ID,))
    with pytest.raises(RuntimeError,match='injected'):
        with connection(database_path,write=True) as db:
            db.execute('DELETE FROM retired_task_ids')
            raise RuntimeError('injected')
    with connection(database_path) as db:
        assert db.execute('SELECT * FROM retired_task_ids').fetchall()==[(ID,)]
        assert not db.in_transaction


def test_write_begin_and_internal_fault_points(database_path):
    events=[]
    with connection(database_path,write=True,fault=lambda point,db: events.append((point,db.in_transaction))) as db:
        assert db.in_transaction
        db.execute('INSERT INTO retired_task_ids VALUES (?)',(ID,))
    assert ('after_begin',True) in events
    assert ('before_commit',True) in events
    assert ('after_commit',False) in events

    def fail(point,db):
        if point=='before_commit':
            raise RuntimeError('abort before commit')
    with pytest.raises(RuntimeError):
        with connection(database_path,write=True,fault=fail) as db:
            db.execute('DELETE FROM retired_task_ids')
    with connection(database_path) as db:
        assert db.execute('SELECT * FROM retired_task_ids').fetchall()==[(ID,)]


@pytest.mark.parametrize('kind',['bytes','foreign','wrong_version','missing_index','wrong_constraint','changed_enum'])
def test_existing_bad_database_not_reset(database_path,kind):
    if kind=='bytes':
        database_path.write_bytes(b'not a sqlite database\0\xff')
    elif kind=='foreign':
        with sqlite3.connect(database_path) as db:
            db.execute('CREATE TABLE user_content (text TEXT)')
            db.execute("INSERT INTO user_content VALUES ('keep')")
    else:
        with connection(database_path):
            pass
        with sqlite3.connect(database_path) as db:
            if kind=='wrong_version': db.execute('PRAGMA user_version=99')
            elif kind=='missing_index': db.execute('DROP INDEX tasks_created_id')
            elif kind=='changed_enum':
                from app.tasks.storage import SCHEMA
                db.execute('DROP TABLE tasks')
                db.execute(SCHEMA['tasks'].replace("'todo'","'TODO'"))
                db.execute(SCHEMA['tasks_created_id'])
            else:
                db.execute('DROP TABLE tasks')
                db.execute('CREATE TABLE tasks (id TEXT)')
    before=database_path.read_bytes()
    with pytest.raises(TaskError) as caught:
        with connection(database_path):
            pytest.fail('invalid storage accepted')
    assert (caught.value.status,caught.value.code)==(503,'storage_unavailable')
    assert database_path.read_bytes()==before


def test_path_failure_is_safe_error(database_path):
    database_path.mkdir()
    with pytest.raises(TaskError) as caught:
        with connection(database_path): pass
    assert caught.value.code=='storage_unavailable'
    assert str(database_path) not in str(caught.value.to_dict())


def test_empty_file_and_new_parent_can_initialize(database_path):
    database_path.touch()
    with connection(database_path) as db:
        assert db.execute('SELECT count(*) FROM retired_task_ids').fetchone()[0]==0
    with isolated_database() as other:
        nested=other.parent/'nested'/'tasks.sqlite3'
        with connection(nested) as db:
            assert db.execute('PRAGMA user_version').fetchone()[0]==1


def test_sql_order_keeps_microseconds(database_path):
    ids=[ID,ID.replace('37fe','37ff'),ID.replace('37fe','37fd')]
    moments=['2026-10-30T00:00:00.000002Z','2026-10-30T00:00:00.000001Z','2026-10-30T00:00:00.000001Z']
    with connection(database_path,write=True) as db:
        for id_,moment in zip(ids,moments):
            db.execute('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?)',(id_,'x','','todo','medium','0001-01-01',moment,moment,1))
    with connection(database_path) as db:
        ordered=db.execute('SELECT created_at,id FROM tasks ORDER BY created_at COLLATE BINARY,id COLLATE BINARY').fetchall()
    assert ordered==sorted(zip(moments,ids),key=lambda row:(datetime.fromisoformat(row[0]),row[1]))


def test_schema_initialization_failure_rolls_back_all_objects(database_path,monkeypatch):
    import app.tasks.storage as storage
    original=storage.SCHEMA
    monkeypatch.setattr(storage,'SCHEMA',{**original,'retired_task_ids':'INVALID SCHEMA SQL'})
    with pytest.raises(TaskError) as caught:
        with connection(database_path): pass
    assert caught.value.code=='internal_error'
    with sqlite3.connect(database_path) as db:
        assert db.execute("SELECT name FROM sqlite_schema WHERE type='table'").fetchall()==[]
        assert db.execute('PRAGMA user_version').fetchone()[0]==0
    monkeypatch.setattr(storage,'SCHEMA',original)
    with connection(database_path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==1


def test_failure_after_commit_does_not_undo_confirmed_state(database_path):
    def fail(point,db):
        if point=='after_commit': raise OSError('lost delivery')
    with pytest.raises(TaskError) as caught:
        with connection(database_path,write=True,fault=fail) as db:
            db.execute('INSERT INTO retired_task_ids VALUES (?)',(ID,))
    assert caught.value.code=='storage_unavailable'
    with connection(database_path) as db:
        assert db.execute('SELECT id FROM retired_task_ids').fetchall()==[(ID,)]


@pytest.mark.parametrize('point,deleted',[('after_retired_insert',False),('before_commit',False),('after_commit',True)])
def test_delete_and_retired_mark_are_one_transaction(database_path,monkeypatch,point,deleted):
    import app.tasks.storage as storage
    from app.main import create_app
    from fastapi.testclient import TestClient
    with TestClient(create_app(database_path)) as client:
        original_task=client.post('/api/tasks',json={'id':ID,'title':'Не терять','due_date':'0001-01-01'}).json()
        original=storage.delete_task
        def broken(path,task_id,version,*,fault=None):
            def checkpoint(name,db):
                if name==point:raise OSError('injected delete transaction boundary')
            return original(path,task_id,version,fault=checkpoint)
        monkeypatch.setattr(storage,'delete_task',broken)
        result=client.delete('/api/tasks/'+ID+'?version=1')
        assert result.status_code==503
        monkeypatch.setattr(storage,'delete_task',original)
        read=client.get('/api/tasks/'+ID)
        if deleted:assert read.status_code==404
        else:assert read.json()==original_task
    with sqlite3.connect(database_path) as db:
        assert db.execute('SELECT count(*) FROM tasks').fetchone()[0]==(0 if deleted else 1)
        assert db.execute('SELECT * FROM retired_task_ids').fetchall()==([(ID,)] if deleted else [])


def test_lost_post_deleted_then_replayed_after_new_process_stays_retired(database_path):
    import httpx
    from tests.support.processes import BackendProcess
    body={'id':ID,'title':'Исходный POST','due_date':'2024-02-29'}
    server=BackendProcess(database_path)
    try:
        server.start().wait_ready()
        # Discard the successful creation response; the original caller may never see it.
        assert httpx.post(server.base_url+'/api/tasks',json=body).status_code==201
        assert httpx.delete(server.base_url+'/api/tasks/'+ID+'?version=1').status_code==204
        server.restart().wait_ready()
        for request_body in [body,{**body,'title':'Другой текст'}]:
            replay=httpx.post(server.base_url+'/api/tasks',json=request_body)
            assert replay.status_code==409 and replay.json()['error']['code']=='task_id_retired'
        assert httpx.get(server.base_url+'/api/tasks/'+ID).status_code==404
        assert httpx.delete(server.base_url+'/api/tasks/'+ID+'?version=1').status_code==404
    finally:server.stop()
    with sqlite3.connect(database_path) as db:
        assert db.execute('SELECT * FROM tasks').fetchall()==[]
        assert db.execute('SELECT * FROM retired_task_ids').fetchall()==[(ID,)]


def test_1002_tasks_survive_graceful_and_forced_restart_with_other_cwd(database_path):
    import httpx
    from tests.support.processes import BackendProcess
    server=BackendProcess(database_path);expected={};retired=[]
    try:
        server.start().wait_ready()
        with httpx.Client(base_url=server.base_url,timeout=15) as client:
            for i in range(1002):
                values={'id':f'00000000-0000-4000-8000-{i:012x}','title':f'План {i} 😀','description':f' Строка\n{i} ','status':['todo','in_progress','done'][i%3],'priority':['low','medium','high'][i%3],'due_date':['0001-01-01','2024-02-29','9999-12-31',None][i%4]}
                response=client.post('/api/tasks',json=values);assert response.status_code==201
                task=response.json();assert {k:task[k] for k in values}==values
                assert task['version']==1 and task['created_at']==task['updated_at']
                expected[task['id']]=task
            for i,task in enumerate(list(expected.values())):
                if i%10==0:
                    fields={'title':f'Изменён {i} 😀','description':'','due_date':None,'status':'done','priority':'high'}
                    changed=client.patch('/api/tasks/'+task['id'],json={'version':task['version'],**fields})
                    assert changed.status_code==200
                    actual=changed.json();assert actual=={**task,**fields,'version':2,'updated_at':actual['updated_at']}
                    expected[task['id']]=actual
            deleted=next(iter(expected.values()))
            assert client.delete('/api/tasks/'+deleted['id']+'?version='+str(deleted['version'])).status_code==204
            retired=[(deleted['id'],)];del expected[deleted['id']]
        ordered=sorted(expected.values(),key=lambda t:(t['created_at'],t['id']))
        for force in [False,True]:
            old_pid=server.process.pid;server.restart(force=force,cwd=database_path.parent).wait_ready()
            assert server.process.pid!=old_pid
            with httpx.Client(base_url=server.base_url) as client:
                result=client.get('/api/tasks');assert result.status_code==200
                assert result.json()=={'items':ordered,'total':1001}
                replay=client.post('/api/tasks',json={'id':retired[0][0],'title':'Не восстанавливать'})
                assert replay.status_code==409 and replay.json()['error']['code']=='task_id_retired'
            with sqlite3.connect(database_path) as db:
                cursor=db.execute('SELECT * FROM tasks ORDER BY created_at,id');names=[c[0] for c in cursor.description]
                assert [dict(zip(names,row)) for row in cursor]==ordered
                assert db.execute('SELECT * FROM retired_task_ids').fetchall()==retired
    finally:server.stop()
