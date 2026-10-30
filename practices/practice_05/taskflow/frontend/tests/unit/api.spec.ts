import { test, expect } from '@playwright/test';
import { createKanbanApi } from '../../src/features/kanban/api';
import { DETAIL_CODES, ERROR_STATUS } from '../../src/features/kanban/types';
import { decodeApiError } from '../../src/features/kanban/validation';
const id = '8b28fe8b-7a58-4c84-a733-1135f31237fe';
const task = {id,title:'x',description:'',status:'todo',priority:'medium',due_date:null,
  created_at:'2026-10-30T00:00:00.000001Z',updated_at:'2026-10-30T00:00:00.000001Z',version:1};
function json(value: unknown,status=200,headers: Record<string,string>={}) { return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}}); }
function fake(response: () => Response | Promise<Response>) {
  const calls: {url:string;init?:RequestInit}[]=[];
  const fetcher: typeof fetch = async (url,init) => { calls.push({url:String(url),init}); return response(); };
  return {api:createKanbanApi(fetcher),calls};
}
test('five methods, typed bodies, headers and no DELETE JSON parsing', async () => {
  let response=json({items:[task],total:1});
  const {api,calls}=fake(() => response);
  expect(await api.listTasks()).toEqual({items:[task],total:1});
  response=json(task); expect(await api.getTask(id)).toEqual(task);
  response=json(task,201,{Location:`/api/tasks/${id}`}); expect(await api.createTask({id,title:'x'})).toEqual(task);
  expect(calls[2].init?.headers).toEqual({'Content-Type':'application/json'});
  expect(JSON.parse(String(calls[2].init?.body))).toEqual({id,title:'x',description:'',status:'todo',priority:'medium',due_date:null});
  response=json({...task,title:'changed',version:2}); await api.patchTask(id,{version:1,title:'changed'});
  expect(JSON.parse(String(calls[3].init?.body))).toEqual({version:1,title:'changed'});
  response=new Response(null,{status:204});
  response.json=async () => { throw new Error('must not parse 204'); };
  await api.deleteTask(id,9007199254740991);
  expect(calls.map(c=>[c.url,c.init?.method])).toEqual([
    ['/api/tasks','GET'],[`/api/tasks/${id}`,'GET'],['/api/tasks','POST'],[`/api/tasks/${id}`,'PATCH'],[`/api/tasks/${id}?version=9007199254740991`,'DELETE']]);
  expect(calls[4].init?.body).toBeUndefined();
});
test('original serialized POST replay stays byte-for-byte identical',async () => {
  const {api,calls}=fake(()=>json(task));
  const body=` { "id": "${id}", "title": "x" } `;
  await api.createTask(body); await api.createTask(body);
  expect(calls.map(c=>c.init?.body)).toEqual([body,body]);
});
for (const [code,status] of Object.entries(ERROR_STATUS)) {
  test(`status/code decode and outcome ${code}`,async () => {
    const conflict=code==='version_conflict'?{field:'version',code:'stale_version'}:code==='task_id_conflict'?{field:'id',code:'id_conflict'}:code==='task_id_retired'?{field:'id',code:'retired'}:undefined;
    const error={code,message:'Русское сообщение',details:conflict?[{...conflict,message:'Уточнение'}]:[]};
    expect(decodeApiError({error},status)).toEqual(error);
    const {api,calls}=fake(()=>json({error},status,code==='method_not_allowed'?{Allow:'GET, POST'}:{}));
    await expect(api.createTask({id,title:'x'})).rejects.toMatchObject({outcome:status>=500?'unknown':'rejected',apiError:error});
    expect(calls).toHaveLength(1);
  });
}
test('17 detail categories accepted; unknown code or wrong status rejected', () => {
  for (const code of DETAIL_CODES) expect(decodeApiError({error:{code:'validation_error',message:'Ошибка',details:[{field:'title',code,message:'Ошибка поля'}]}},422).details[0].code).toBe(code);
  for (const body of [{error:{code:'future_error',message:'SQL secret',details:[]}}, {error:{code:'validation_error',message:'Ошибка',details:[{field:'title',code:'future_detail',message:'secret'}]}}, {error:{code:'version_conflict',message:'Ошибка',details:[]}}]) expect(()=>decodeApiError(body,409)).toThrow();
});
for (const failure of ['network','html','broken_json','invalid_task','wrong_status','wrong_location','unknown_code']) {
  test(`write remains unknown and never retries on ${failure}`, async () => {
    const {api,calls}=fake(()=>{
      if(failure==='network') throw new TypeError('network secret');
      if(failure==='html') return new Response('<html>SQL secret</html>',{status:503,headers:{'Content-Type':'text/html'}});
      if(failure==='broken_json') return new Response('{',{status:200,headers:{'Content-Type':'application/json'}});
      if(failure==='invalid_task') return json({...task,version:'1'});
      if(failure==='wrong_status') return json(task,202);
      if(failure==='wrong_location') return json(task,201,{Location:'/wrong'});
      return json({error:{code:'future_error',message:'SQL secret',details:[]}},409);
    });
    await expect(api.createTask({id,title:'x'})).rejects.toMatchObject({outcome:'unknown',message:expect.not.stringContaining('secret')});
    expect(calls).toHaveLength(1);
  });
}
test('GET failures are read errors; abort/PATCH/DELETE writes are unknown',async () => {
  const {api,calls}=fake(()=>{throw new DOMException('aborted','AbortError');});
  await expect(api.getTask(id)).rejects.toMatchObject({outcome:'read_error',reason:'network'});
  await expect(api.patchTask(id,{version:1,title:'x'})).rejects.toMatchObject({outcome:'unknown'});
  await expect(api.deleteTask(id,1)).rejects.toMatchObject({outcome:'unknown'});
  expect(calls).toHaveLength(3);
});
test('invalid outgoing requests do not send; wrong IDs/versions in successes are unknown',async () => {
  const {api,calls}=fake(()=>json({...task,id:id.replace('37fe','37ff')}));
  expect(()=>api.getTask('bad')).toThrow(); expect(()=>api.deleteTask(id,0)).toThrow();
  expect(calls).toHaveLength(0);
  await expect(api.getTask(id)).rejects.toMatchObject({outcome:'read_error',reason:'protocol'});
  await expect(api.createTask({id,title:'x'})).rejects.toMatchObject({outcome:'unknown',reason:'protocol'});
});
