from fastapi.testclient import TestClient
from app.main import app

def test_health():
    with TestClient(app) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_factory_health_does_not_open_bad_storage(database_path):
    from app.main import create_app
    database_path.write_bytes(b'not sqlite')
    before=database_path.read_bytes()
    with TestClient(create_app(database_path)) as client:
        assert client.get('/api/health').json()=={'status':'ok'}
    assert database_path.read_bytes()==before


def test_task_routes_validate_without_crud_or_initializing_storage(database_path):
    from app.main import create_app
    with TestClient(create_app(database_path)) as client:
        assert client.patch('/api/tasks/bad',json={'version':'abc'}).status_code==422
        error=client.patch('/api/tasks/8b28fe8b-7a58-4c84-a733-1135f31237fe',json={}).json()['error']
        assert [(d['field'],d['code']) for d in error['details']]==[('version','missing')]
        duplicate=client.delete('/api/tasks/8b28fe8b-7a58-4c84-a733-1135f31237fe?version=01&version=1')
        assert [(d['field'],d['code']) for d in duplicate.json()['error']['details']]==[('version','duplicate_parameter')]
        body=client.request('GET','/api/tasks',content='not allowed')
        assert [(d['field'],d['code']) for d in body.json()['error']['details']]==[('$','body_not_allowed')]
        forbidden=client.patch('/api/tasks/8b28fe8b-7a58-4c84-a733-1135f31237fe',json={'version':1,'id':None})
        assert [(d['field'],d['code']) for d in forbidden.json()['error']['details']]==[('id','read_only')]
        assert client.post('/api/tasks',content='{',headers={'content-type':'text/plain'}).status_code==415
        assert client.post('/api/tasks',content='{"id":1,"id":2}',headers={'content-type':'application/json'}).status_code==400
    assert not database_path.exists()


def test_405_allow_and_errors_do_not_change_health_format(database_path):
    from app.main import create_app
    with TestClient(create_app(database_path)) as client:
        for path,method,allow in [('/api/tasks','put',{'GET','POST'}),('/api/tasks/invalid','post',{'GET','PATCH','DELETE'})]:
            response=getattr(client,method)(path)
            assert response.status_code==405
            assert set(response.headers['allow'].replace(' ','').split(','))==allow
            assert response.json()['error']['code']=='method_not_allowed'
        assert client.get('/missing').json()=={'detail':'Not Found'}
        assert client.get('/api/health').json()=={'status':'ok'}


def test_validated_operation_runs_in_worker_and_owns_sqlite(database_path,monkeypatch):
    import threading
    import app.tasks.routes as routes
    from app.main import create_app
    from app.tasks.storage import connection
    threads={}
    original=routes.validate_request
    def validate(*args,**kwargs):
        threads['validate']=threading.get_ident()
        return original(*args,**kwargs)
    def worker(validated,path):
        threads['sqlite']=threading.get_ident()
        assert validated.operation=='list'
        assert path==database_path
        with connection(path) as db:
            assert db.execute('SELECT count(*) FROM tasks').fetchone()[0]==0
        # Probe only; this is not a CRUD response or an implementation of list.
        return {'worker_probe':True}
    monkeypatch.setattr(routes,'validate_request',validate)
    monkeypatch.setattr(routes,'execute_operation',worker)
    with TestClient(create_app(database_path)) as client:
        assert client.get('/api/tasks').json()=={'worker_probe':True}
    assert threads['validate']!=threads['sqlite']


def test_task_error_envelopes_and_unexpected_errors_are_safe(database_path,monkeypatch):
    import app.tasks.routes as routes
    from app.main import create_app
    from app.tasks.errors import TaskError
    def unavailable(*args): raise TaskError('storage_unavailable')
    monkeypatch.setattr(routes,'execute_operation',unavailable)
    with TestClient(create_app(database_path)) as client:
        response=client.get('/api/tasks')
        assert response.status_code==503 and response.json()['error']['details']==[]
        assert client.get('/api/health').status_code==200
        def broken(*args): raise RuntimeError('SQL secret path')
        monkeypatch.setattr(routes,'execute_operation',broken)
        response=client.get('/api/tasks')
        assert response.status_code==500
        assert 'secret' not in response.text
        response=client.post('/api/tasks',content='{"id":"8b28fe8b-7a58-4c84-a733-1135f31237fe","title":"x","\\ud800":null}',headers={'content-type':'application/json'})
        assert response.status_code==422


def test_openapi_explicit_raw_request_and_responses(database_path):
    from app.main import create_app
    schema=create_app(database_path).openapi()
    collection=schema['paths']['/api/tasks']
    item=schema['paths']['/api/tasks/{task_id}']
    assert set(collection)=={'get','post'}
    assert set(item)=={'get','patch','delete'}
    assert set(collection['get']['responses'])=={'200','422','405','503','500'}
    assert set(item['delete']['responses'])=={'204','422','404','409','405','503','500'}
    create=collection['post']['requestBody']['content']['application/json']['schema']
    assert create['required']==['id','title']
    assert create['properties']['due_date']['default'] is None
    assert 'Location' in collection['post']['responses']['201']['headers']
    task=collection['get']['responses']['200']['content']['application/json']['schema']['properties']['items']['items']
    assert len(task['required'])==9
    assert 'content' not in item['delete']['responses']['204']
    assert item['delete']['parameters'][1]['name']=='version'
    assert len(item['patch']['responses']['422']['content']['application/json']['schema']['properties']['error']['properties']['details']['items']['properties']['code']['enum'])==17
    assert not database_path.exists()
