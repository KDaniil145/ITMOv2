"""API §§1/2/6, BE AC-02/07/15: explicit inputs and independent expected codes."""
import json
import pytest
from app.tasks.errors import TaskError, ERRORS, DETAIL_MESSAGES
from app.tasks.types import MAX_VERSION, Task
from app.tasks.validation import validate_request

ID = '8b28fe8b-7a58-4c84-a733-1135f31237fe'
WS = '\u0009\u000a\u000b\u000c\u000d\u0020\u0085\u00a0\u1680' + ''.join(chr(c) for c in range(0x2000, 0x200B)) + '\u2028\u2029\u202f\u205f\u3000'


def request(operation='create', data=None, **kwargs):
    if data is None:
        data = {'id': ID, 'title': 'Задача'} if operation == 'create' else {'version': 1, 'title': 'Задача'}
    return validate_request(operation, body=json.dumps(data, ensure_ascii=True).encode(),
                            content_type='application/json; charset=utf-8',
                            task_id=ID if operation in ('patch', 'get', 'delete') else None, **kwargs)


def errors(call):
    with pytest.raises(TaskError) as caught:
        call()
    assert caught.value.code == 'validation_error'
    assert caught.value.status == 422
    return [(d.field, d.code) for d in caught.value.details]


def test_types_and_error_contract():
    assert set(Task.__annotations__) == {'id','title','description','status','priority','due_date','created_at','updated_at','version'}
    expected = {'invalid_json':400,'unsupported_media_type':415,'validation_error':422,
                'task_not_found':404,'version_conflict':409,'task_id_conflict':409,
                'task_id_retired':409,'version_exhausted':409,'method_not_allowed':405,
                'storage_unavailable':503,'internal_error':500}
    assert {k:v[0] for k,v in ERRORS.items()} == expected
    assert set(DETAIL_MESSAGES) == {'missing','invalid_type','invalid_length','invalid_value','invalid_format','invalid_date','invalid_characters','invalid_unicode','unknown_field','read_only','unknown_parameter','duplicate_parameter','empty_update','body_not_allowed','stale_version','id_conflict','retired'}
    for code,status in expected.items():
        error = TaskError(code, allow='GET, POST')
        assert error.status == status
        payload = error.to_dict()['error']
        assert set(payload) == {'code','message','details'}
        assert isinstance(payload['details'],list)
        assert any('а' <= ch <= 'я' for ch in payload['message'].lower())
        if code in {'version_conflict','task_id_conflict','task_id_retired'}:
            assert len(payload['details']) == 1
        elif code != 'validation_error':
            assert payload['details'] == []
    assert TaskError('method_not_allowed',allow='GET, POST').headers == {'Allow':'GET, POST'}


def test_defaults_omission_null_and_no_mutation():
    body = {'id':ID,'title':WS+'  e\u0301 😀 '+WS}
    before = dict(body)
    actual = request(data=body).data
    assert actual == {'id':ID,'title':'e\u0301 😀','description':'','status':'todo','priority':'medium','due_date':None}
    assert body == before
    assert request('patch',{'version':1,'due_date':None}).data == {'version':1,'due_date':None}
    assert request('patch',{'version':1,'description':''}).data == {'version':1,'description':''}


@pytest.mark.parametrize('field,value,code', [
 ('title','', 'invalid_length'), ('title',' '*10,'invalid_length'),
 ('title','x'*201,'invalid_length'),('title','x\ty','invalid_characters'),
 ('title','x\x00','invalid_characters'),('title','\ufeffx','ok'),
 ('title','\ud800'+'x'*201,'invalid_unicode'),('title','x'*201+'\tY','invalid_length'),
 ('description','x'*5001,'invalid_length'),('description','\x00','invalid_characters'),
 ('description','\udfff','invalid_unicode'),('description',' \t\r\n ','ok'),
 ('title',None,'invalid_type'),('description',None,'invalid_type'),
 ('status',None,'invalid_type'),('priority',None,'invalid_type'),
 ('status','TODO','invalid_value'),('priority','Medium','invalid_value'),
 ('due_date','', 'invalid_date'),('due_date','2025-02-29','invalid_date'),
 ('due_date','2024-02-29','ok'),('due_date','0001-01-01','ok'),('due_date','9999-12-31','ok'),
 ('due_date','0000-01-01','invalid_date'),('due_date','2024-2-01','invalid_date'),
 ('due_date','2024-01-01T00:00:00Z','invalid_date'),('due_date',' 2024-01-01','invalid_date'),
 ('due_date','２０２４-01-01','invalid_date'),('due_date',3,'invalid_type'),
 ('due_date','\ud800','invalid_unicode'),('id',ID.upper(),'invalid_format'),
 ('id',ID.replace('-4c84','-1c84'),'invalid_format'),
 ('id',ID.replace('-a733','-7733'),'invalid_format'),('id',None,'invalid_type'),
 ('version',True,'read_only'),('created_at',None,'read_only'),('unknown',None,'unknown_field'),
])
def test_field_boundaries(field,value,code):
    data={'id':ID,'title':'Задача',field:value}
    if code == 'ok':
        assert request(data=data).data[field] == value
    else:
        assert (field,code) in errors(lambda: request(data=data))


@pytest.mark.parametrize('length',[1,200])
def test_codepoint_title_boundaries(length):
    assert request(data={'id':ID,'title':'😀'*length}).data['title'] == '😀'*length


@pytest.mark.parametrize('length',[0,5000])
def test_description_boundaries(length):
    assert request(data={'id':ID,'title':'x','description':'😀'*length}).data['description'] == '😀'*length


@pytest.mark.parametrize('space',list(WS))
def test_exact_edge_whitespace(space):
    assert request(data={'id':ID,'title':space+'x'+space}).data['title'] == 'x'


@pytest.mark.parametrize('status',['todo','in_progress','done'])
@pytest.mark.parametrize('priority',['low','medium','high'])
def test_enums(status,priority):
    assert request(data={'id':ID,'title':'x','status':status,'priority':priority}).data['status'] == status


def test_name_priority_independent_errors_and_empty_patch():
    assert errors(lambda: request('patch',{'id':None,'title':None,'version':1,'zzz':None})) == [('id','read_only'),('title','invalid_type'),('zzz','unknown_field')]
    assert errors(lambda: request('patch',{'version':1})) == [('$','empty_update')]
    assert errors(lambda: request(data={})) == [('id','missing'),('title','missing')]
    assert errors(lambda: request('patch',{'title':'x'})) == [('version','missing')]


@pytest.mark.parametrize('version,code', [(True,'invalid_type'),(1.0,'invalid_type'),('1','invalid_type'),(None,'invalid_type'),(0,'invalid_value'),(-1,'invalid_value'),(MAX_VERSION+1,'invalid_value')])
def test_patch_version(version,code):
    assert ('version',code) in errors(lambda: request('patch',{'version':version,'title':'x'}))


@pytest.mark.parametrize('version',[1,MAX_VERSION])
def test_patch_version_valid(version):
    assert request('patch',{'version':version,'title':'x'}).data['version']==version


@pytest.mark.parametrize('raw,code', [('', 'missing'),('version=', 'invalid_format'),('version=01','invalid_format'),('version=%2B1','invalid_format'),('version=+1','invalid_format'),('version=1.0','invalid_format'),('version=1e0','invalid_format'),('version=%201','invalid_format'),('version=١','invalid_format'),('version=9007199254740992','invalid_value'),('version=01&version=1','duplicate_parameter'),('version=1&version=1','duplicate_parameter')])
def test_delete_query(raw,code):
    from urllib.parse import parse_qsl
    found = errors(lambda: validate_request('delete',task_id=ID,query=parse_qsl(raw,keep_blank_values=True)))
    assert ('version',code) in found


def test_delete_valid_unknown_query_and_get_body():
    assert validate_request('delete',task_id=ID,query=[('version',str(MAX_VERSION))]).data == {'version':MAX_VERSION}
    assert errors(lambda: validate_request('get',task_id=ID,body=b'x',query=[('filter','x')])) == [('$','body_not_allowed'),('filter','unknown_parameter')]
    assert errors(lambda: validate_request('get',task_id='bad')) == [('id','invalid_format')]


@pytest.mark.parametrize('raw',[b'',b'{',b'{"id":1,"id":2}',b'{"a":{"b":1,"b":2}}',b'{"title":NaN}',b'{"title":Infinity}',b'\xff'])
def test_invalid_json(raw):
    with pytest.raises(TaskError) as caught:
        validate_request('create',body=raw,content_type='application/json')
    assert (caught.value.status,caught.value.code)==(400,'invalid_json')


@pytest.mark.parametrize('data',[None,[],1,'x',True])
def test_json_object_required(data):
    assert errors(lambda: validate_request('create',body=json.dumps(data).encode(),content_type='application/json')) == [('$','invalid_type')]


def test_media_before_json_and_unicode_pair():
    with pytest.raises(TaskError) as caught:
        validate_request('create',body=b'{',content_type='text/plain')
    assert caught.value.code=='unsupported_media_type'
    data = validate_request('create',content_type='application/json',body=(' {"id":"'+ID+'","title":"\\ud83d\\ude00"}').encode()).data
    assert data['title']=='😀'

@pytest.mark.parametrize('field',['title','description','status','priority','due_date','id'])
@pytest.mark.parametrize('value',[True,7,1.5,[],{}])
def test_no_field_type_coercion(field,value):
    assert (field,'invalid_type') in errors(lambda: request(data={'id':ID,'title':'x',field:value}))


@pytest.mark.parametrize('field',['id','created_at','updated_at'])
def test_patch_forbidden_fields_before_null(field):
    assert (field,'read_only') in errors(lambda: request('patch',{'version':1,'title':'x',field:None}))


@pytest.mark.parametrize('control',[chr(c) for c in range(32)]+['\x7f'])
def test_controls_inside_title_and_description(control):
    assert ('title','invalid_characters') in errors(lambda: request(data={'id':ID,'title':'x'+control+'x'}))
    if control in '\n\r\t':
        assert request(data={'id':ID,'title':'x','description':'x'+control+'x'}).data['description']=='x'+control+'x'
    else:
        assert ('description','invalid_characters') in errors(lambda: request(data={'id':ID,'title':'x','description':'x'+control+'x'}))


def test_no_hidden_normalization():
    title='A  e\u0301\ufeff'
    assert request(data={'id':ID,'title':title}).data['title']==title


@pytest.mark.parametrize('raw',[b'{"version":'+b'9'*5000+b',"title":"x"}',b'{"version":9007199254740992,"title":"x"}'])
def test_large_json_integer_is_range_error_not_json_error(raw):
    assert ('version','invalid_value') in errors(lambda: validate_request('patch',body=raw,content_type='application/json',task_id=ID))


@pytest.mark.parametrize('data,expected', [
    ({}, [('version', 'missing')]),
    ({'version': 'abc'}, [('version', 'invalid_type')]),
    ({'version': 1}, [('$', 'empty_update')]),
    ({'version': 1, 'id': None}, [('id', 'read_only')]),
    ({'version': 1, 'unknown': 123}, [('unknown', 'unknown_field')]),
])
def test_empty_update_only_after_valid_patch_body(data, expected):
    assert errors(lambda: request('patch', data)) == expected
