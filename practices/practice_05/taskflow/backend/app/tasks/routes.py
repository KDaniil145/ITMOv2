"""Task HTTP routing with explicit contract validation and worker-owned storage."""
import json
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool
from starlette.responses import Response, JSONResponse

from .errors import DETAIL_MESSAGES, ERRORS, TaskError
from .types import ValidatedRequest
from .validation import validate_request


def error_response(error: TaskError):
    # ASCII escaping also safely represents unknown field names containing surrogates.
    return Response(json.dumps(error.to_dict(), ensure_ascii=True), status_code=error.status,
                    headers=error.headers, media_type='application/json')


class TaskRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()
        async def handle(request: Request):
            try:
                return await original(request)
            except TaskError as error:
                return error_response(error)
            except Exception:
                return error_response(TaskError('internal_error'))
        return handle


router = APIRouter(prefix='/api/tasks', route_class=TaskRoute)


def execute_operation(validated: ValidatedRequest, database_path: Path):
    from .storage import list_tasks, get_task, create_task, patch_task, delete_task
    if validated.operation == 'list':
        return list_tasks(database_path)
    if validated.operation == 'get':
        return get_task(database_path, validated.task_id)
    if validated.operation == 'create':
        task, created = create_task(database_path, validated.data)
        return JSONResponse(task, status_code=201 if created else 200,
                            headers={'Location': '/api/tasks/' + task['id']} if created else None)
    if validated.operation == 'patch':
        return patch_task(database_path, validated.task_id, validated.data)
    if validated.operation == 'delete':
        delete_task(database_path, validated.task_id, validated.data['version'])
        return Response(status_code=204)
    raise ValueError('Unknown validated operation')


async def process(request: Request, operation):
    validated = validate_request(operation, body=await request.body(),
        content_type=request.headers.get('content-type'), query=request.query_params.multi_items(),
        task_id=request.path_params.get('task_id'))
    return await run_in_threadpool(execute_operation, validated, request.app.state.database_path)


# Explicit documentation is necessary because inputs are read as raw Request.
UUID_SCHEMA = {'type':'string','format':'uuid','pattern':r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'}
VERSION_SCHEMA = {'type':'integer','minimum':1,'maximum':9007199254740991}
USER_SCHEMA = {
    'title': {'type':'string','minLength':1,'maxLength':200,'description':'Точная обрезка White_Space, Unicode-кодовые точки; API §2.1.'},
    'description': {'type':'string','maxLength':5000,'description':'Без обрезки; LF/CR/TAB разрешены; API §2.1.'},
    'status': {'type':'string','enum':['todo','in_progress','done']},
    'priority': {'type':'string','enum':['low','medium','high']},
    'due_date': {'anyOf':[{'type':'string','format':'date','pattern':r'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'},{'type':'null'}],
                 'description':'Григорианская дата 0001–9999 без UTC-конвертации.'},
}
TIME_SCHEMA = {'type':'string','format':'date-time','pattern':r'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'}
TASK_SCHEMA = {'type':'object','additionalProperties':False,
    'required':['id',*USER_SCHEMA,'created_at','updated_at','version'],
    'properties':{'id':UUID_SCHEMA,**USER_SCHEMA,'created_at':TIME_SCHEMA,'updated_at':TIME_SCHEMA,'version':VERSION_SCHEMA}}
ERROR_SCHEMA = {'type':'object','required':['error'],'additionalProperties':False,'properties':{'error':{
    'type':'object','required':['code','message','details'],'additionalProperties':False,
    'properties':{'code':{'type':'string','enum':list(ERRORS)},'message':{'type':'string'},'details':{'type':'array','items':{
        'type':'object','required':['field','code','message'],'additionalProperties':False,
        'properties':{'field':{'type':'string'},'code':{'type':'string','enum':list(DETAIL_MESSAGES)},'message':{'type':'string'}}}}}}}}


def docs(success, *, body=None, item=False, delete=False):
    statuses = {422, 405, 503, 500}
    if item:
        statuses.add(404)
    if body:
        statuses.update({400, 415, 409})
    if delete:
        statuses.add(409)
    responses = {str(status): {'description':'Ошибка по API §6','content':{'application/json':{'schema':ERROR_SCHEMA}}}
                 for status in statuses}
    responses['405']['headers'] = {'Allow':{'schema':{'type':'string'}}}
    responses.update(success)
    result = {'responses': responses}
    parameters = []
    if item:
        parameters.append({'name':'task_id','in':'path','required':True,'schema':UUID_SCHEMA})
    if delete:
        parameters.append({'name':'version','in':'query','required':True,'schema':{'type':'string','pattern':r'^[1-9][0-9]*$'},
            'description':'Ровно один параметр; после URL-декодирования ASCII, без знака/нулей/пробелов, диапазон 1…9007199254740991.'})
    if parameters: result['parameters'] = parameters
    if body:
        result['requestBody'] = {'required':True,'content':{'application/json':{'schema':body}},
            'description':'Только JSON-объект; повтор ключа — 400; строгие типы и приоритеты API §6.3.'}
    return result


def task_response(description):
    return {'description':description,'content':{'application/json':{'schema':TASK_SCHEMA}}}


CREATE_PROPERTIES = {'id': UUID_SCHEMA, **{name: dict(schema) for name, schema in USER_SCHEMA.items()}}
for name, default in {'description': '', 'status': 'todo', 'priority': 'medium', 'due_date': None}.items():
    CREATE_PROPERTIES[name]['default'] = default
CREATE_SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['id', 'title'],
                 'properties': CREATE_PROPERTIES}
PATCH_SCHEMA = {'type':'object','additionalProperties':False,'required':['version'],
    'properties':{'version':VERSION_SCHEMA,**USER_SCHEMA},
    'anyOf':[{'required':[name]} for name in USER_SCHEMA],
    'description':'Пропуск сохраняет значение; null очищает только due_date. Проверки полей раньше empty_update.'}


@router.get('', response_model=None, openapi_extra=docs({'200':{'description':'Полный серверный порядок created_at/id; без усечения микросекунд и лимита1000.',
    'content':{'application/json':{'schema':{'type':'object','required':['items','total'],'additionalProperties':False,
        'properties':{'items':{'type':'array','items':TASK_SCHEMA},'total':{'type':'integer','minimum':0}}}}}}}))
async def list_tasks(request: Request):
    return await process(request, 'list')


@router.post('', response_model=None, status_code=201, openapi_extra=docs({
    '201':{**task_response('Создано; все9 полей'), 'headers':{'Location':{'schema':{'type':'string'}}}},
    '200':task_response('Допустимый повтор исходного POST, версия1')},body=CREATE_SCHEMA))
async def create_task(request: Request):
    return await process(request, 'create')


@router.get('/{task_id}', response_model=None, openapi_extra=docs({'200':task_response('Полная задача')},item=True))
async def get_task(request: Request):
    return await process(request, 'get')


@router.patch('/{task_id}', response_model=None, openapi_extra=docs({'200':task_response('Полная задача, включая no-op')},item=True,body=PATCH_SCHEMA))
async def patch_task(request: Request):
    return await process(request, 'patch')


@router.delete('/{task_id}', response_class=Response, status_code=204, openapi_extra=docs({'204':{'description':'Удалено; тела нет'}},item=True,delete=True))
async def delete_task(request: Request):
    return await process(request, 'delete')
