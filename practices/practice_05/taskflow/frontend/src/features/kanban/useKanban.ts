import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { kanbanApi, KanbanApiError } from './api';
import type { Task, TaskList, UserFields, ValidationDetail } from './types';
import { useLocalDay } from './calendar';
import { useTaskEditing } from './useTaskEditing';
import { InputError } from './validation';
import { CreationIntentStore, emptyDraft, intentFields, newIntent, sameFields, type CreationIntent } from './creationIntent';

export interface Selection { id: string; task: Task | null; phase: 'loading' | 'ready' | 'error' | 'absent'; error: string }
export type CreatePhase = 'idle' | 'sending' | 'unknown' | 'reconciling' | 'retry_available' | 'review' | 'retired' | 'rejected';
export interface CreationState { open:boolean;phase:CreatePhase;intent:CreationIntent|null;review:Task|null;message:string;notice:string;errors:ValidationDetail[] }
interface State {
  snapshot: TaskList | null;
  phase: 'loading' | 'ready' | 'error' | 'stale';
  refreshing: boolean;
  error: string;
  selected: Selection | null;
  draft: UserFields;
  creation: CreationState;
  operationById: Record<string, 'pending' | 'unknown'>;
}
function initial(store:CreationIntentStore): State {
  const intent=store.loadIntent();
  const draft=store.loadDraft() || (intent?intentFields(intent):emptyDraft());
  return {snapshot:null,phase:'loading',refreshing:false,error:'',selected:null,draft,operationById:{},
    creation:{open:false,phase:intent?'unknown':'idle',intent,review:null,message:intent?'Есть незавершённое создание. Сначала сверьте состояние.':'',notice:'',errors:[]}};
}
type Action = {type:'list_start'} | {type:'list_ok';list:TaskList} | {type:'list_error';error:string} |
  {type:'select_start';id:string} | {type:'select_ok';task:Task} |
  {type:'select_error';id:string;error:string;absent:boolean} | {type:'dismiss'} |
  {type:'creation';patch:Partial<CreationState>} | {type:'draft';draft:UserFields} | {type:'task_upsert';task:Task} | {type:'task_missing';id:string};
function reduce(state: State, action: Action): State {
  switch(action.type) {
    case 'creation': return {...state,creation:{...state.creation,...action.patch}};
    case 'draft': return {...state,draft:action.draft,creation:{...state.creation,errors:[]}};
    case 'task_upsert': {
      const items=[...(state.snapshot?.items.filter(task=>task.id!==action.task.id)||[]),action.task];
      items.sort((a,b)=>a.created_at<b.created_at?-1:a.created_at>b.created_at?1:a.id<b.id?-1:a.id>b.id?1:0);
      return {...state,snapshot:{items,total:items.length}};
    }
    case 'task_missing': {
      const items=state.snapshot?.items.filter(task=>task.id!==action.id);
      return {...state,snapshot:items?{items,total:items.length}:state.snapshot};
    }
    case 'list_start': return {...state,refreshing:true,phase:state.snapshot?state.phase:'loading',error:state.snapshot?state.error:''};
    case 'list_ok': return {...state,snapshot:action.list,phase:'ready',refreshing:false,error:''};
    case 'list_error': return {...state,phase:state.snapshot?'stale':'error',refreshing:false,error:action.error};
    case 'select_start': return {...state,selected:{id:action.id,task:null,phase:'loading',error:''}};
    case 'select_ok': {
      const items=state.snapshot?.items.map(task=>task.id===action.task.id?action.task:task);
      return {...state,snapshot:items?{items,total:items.length}:state.snapshot,selected:{id:action.task.id,task:action.task,phase:'ready',error:''}};
    }
    case 'select_error': {
      const items=action.absent?state.snapshot?.items.filter(task=>task.id!==action.id):undefined;
      return {...state,snapshot:items?{items,total:items.length}:state.snapshot,
        selected:{id:action.id,task:null,phase:action.absent?'absent':'error',error:action.error}};
    }
    case 'dismiss': return {...state,selected:null};
  }
}
function readError(error: unknown, detail=false) {
  if(error instanceof KanbanApiError && error.apiError?.code==='storage_unavailable') return detail?'Не удалось загрузить задачу: хранилище временно недоступно. Повторите чтение.':'Не удалось загрузить задачи: хранилище временно недоступно. Повторите чтение.';
  if(error instanceof KanbanApiError && error.apiError?.code==='internal_error') return detail?'Не удалось загрузить задачу: внутренняя ошибка сервера. Повторите чтение.':'Не удалось загрузить задачи: внутренняя ошибка сервера. Повторите чтение.';
  if(error instanceof KanbanApiError && error.reason==='protocol') return 'Ответ сервера невозможно корректно отобразить. Повторите чтение.';
  return detail?'Не удалось загрузить задачу. Повторите чтение.':'Не удалось загрузить задачи. Проверьте соединение и повторите чтение.';
}
export function useKanban() {
  const day=useLocalDay();
  const [store]=useState(()=>new CreationIntentStore(()=>sessionStorage));
  const [state,dispatch]=useReducer(reduce,store,initial);
  const draftRef=useRef(state.draft), busy=useRef(false), createPhase=useRef<CreatePhase>(state.creation.phase);
  const epoch=useRef(0), accepted=useRef(0), listEpoch=useRef(0), selectionEpoch=useRef(0);
  const listAbort=useRef<AbortController | null>(null), selectionAbort=useRef<AbortController | null>(null);
  const refresh=useCallback(async () => {
    const seq=++epoch.current; listEpoch.current=seq;
    listAbort.current?.abort();
    const controller=new AbortController(); listAbort.current=controller;
    dispatch({type:'list_start'});
    try {
      const list=await kanbanApi.listTasks(controller.signal);
      if(controller.signal.aborted || listEpoch.current!==seq) return;
      if(seq<accepted.current) { dispatch({type:'list_error',error:'Получены более свежие сведения задачи. Обновите доску.'}); return; }
      accepted.current=seq; dispatch({type:'list_ok',list});
    } catch(error) {
      if(!controller.signal.aborted && listEpoch.current===seq) dispatch({type:'list_error',error:readError(error)});
    }
  },[]);
  const select=useCallback(async (id: string) => {
    const seq=++epoch.current; selectionEpoch.current=seq;
    selectionAbort.current?.abort();
    const controller=new AbortController(); selectionAbort.current=controller;
    dispatch({type:'select_start',id});
    try {
      const task=await kanbanApi.getTask(id,controller.signal);
      if(controller.signal.aborted || selectionEpoch.current!==seq) return;
      if(seq<accepted.current) { dispatch({type:'select_error',id,error:'Данные обновились во время чтения. Повторите загрузку задачи.',absent:false}); return; }
      accepted.current=seq; dispatch({type:'select_ok',task});
    } catch(error) {
      if(controller.signal.aborted || selectionEpoch.current!==seq) return;
      const absent=error instanceof KanbanApiError && error.apiError?.code==='task_not_found';
      if(seq<accepted.current) { dispatch({type:'select_error',id,error:'Данные обновились во время чтения. Повторите загрузку задачи.',absent:false}); return; }
      if(absent) accepted.current=seq;
      dispatch({type:'select_error',id,absent,error:absent?'Задача уже отсутствует':readError(error,true)});
    }
  },[]);
  const dismiss=useCallback(() => {
    selectionEpoch.current=++epoch.current;
    selectionAbort.current?.abort(); dispatch({type:'dismiss'});
  },[]);
  function changeCreation(patch:Partial<CreationState>) {
    if(patch.phase) createPhase.current=patch.phase;
    dispatch({type:'creation',patch});
  }
  function changeDraft(field:keyof UserFields,value:string|null) {
    const draft={...draftRef.current,[field]:value} as UserFields;
    draftRef.current=draft; store.saveDraft(draft); dispatch({type:'draft',draft});
  }
  function resetDraft() {
    const draft=emptyDraft(); draftRef.current=draft; store.clearDraft(); dispatch({type:'draft',draft});
  }
  function confirmTask(task:Task) {
    accepted.current=++epoch.current;
    dispatch({type:'task_upsert',task});
  }
  function finish(task:Task,post:boolean) {
    confirmTask(task);
    const kept=!sameFields(draftRef.current,task);
    store.clearIntent();
    if(!kept) resetDraft();
    changeCreation({intent:null,phase:'idle',review:null,open:false,message:'',errors:[],
      notice:(post?'Задача создана.':'Состояние задачи сверено.')+(kept?' Изменённый черновик сохранён.':'')});
    void refresh();
  }
  async function readIntent(intent:CreationIntent) {
    changeCreation({phase:'reconciling',message:'Не удалось подтвердить сохранение. Сверяем состояние задачи.',errors:[]});
    try {
      const task=await kanbanApi.getTask(intent.id);
      if(store.current()?.id!==intent.id) return;
      confirmTask(task);
      changeCreation({phase:'review',review:task,message:'Задача найдена на сервере. Сравните сведения с черновиком. Повторная отправка не выполняется.'});
    } catch(error) {
      if(store.current()?.id!==intent.id) return;
      if(error instanceof KanbanApiError && error.apiError?.code==='task_not_found') {
        accepted.current=++epoch.current; dispatch({type:'task_missing',id:intent.id});
        changeCreation({phase:'retry_available',review:null,message:'Задача пока не найдена. Можно явно повторить первоначальную отправку с теми же данными.'});
      } else {
        dispatch({type:'list_error',error:'Сверка исхода не завершена. '+readError(error)});
        changeCreation({phase:'unknown',review:null,message:'Не удалось подтвердить сохранение. Сверка не удалась. Повторите чтение; повторная отправка заблокирована.'});
      }
    }
  }
  async function send(intent:CreationIntent) {
    if(busy.current) return;
    busy.current=true;
    changeCreation({phase:'sending',intent,review:null,message:'Сохраняем задачу',errors:[],notice:''});
    try {
      const task=await kanbanApi.createTask(intent.serializedBody);
      if(store.current()?.id===intent.id) finish(task,true);
    } catch(error) {
      if(store.current()?.id!==intent.id) return;
      if(error instanceof KanbanApiError && error.apiError?.code==='task_id_retired') {
        store.clearIntent();
        changeCreation({intent:null,phase:'retired',message:'Этот идентификатор относится к удалённой задаче. Старое намерение завершено. Черновик сохранён; новая задача возможна только по вашему решению.'});
      } else if(error instanceof KanbanApiError && error.outcome==='rejected' && error.apiError?.code!=='task_id_conflict') {
        store.clearIntent();
        changeCreation({intent:null,phase:'rejected',errors:error.apiError?.details||[],message:'Сервер отклонил запрос. Черновик сохранён. Проверьте поля перед новой отправкой.'});
      } else {
        changeCreation({phase:'unknown',message:'Не удалось подтвердить сохранение. Исходные данные отправки сохранены.'});
        await readIntent(intent);
      }
    } finally {busy.current=false;}
  }
  function submitCreation() {
    if(busy.current || store.current()) return;
    try {
      const intent=newIntent(draftRef.current); store.saveIntent(intent); void send(intent);
    } catch(error) {
      const details=error instanceof InputError?error.details:[];
      changeCreation({errors:details.map(detail=>({...detail,message:fieldMessage(detail.field,detail.code)})),message:details.length?'Проверьте поля формы.':'Не удалось подготовить создание. Черновик сохранён.'});
    }
  }
  function retryCreation() {
    const intent=store.current();
    if(!busy.current && intent && createPhase.current==='retry_available') void send(intent);
  }
  async function reconcileCreation() {
    const intent=store.current();
    if(busy.current || !intent) return;
    busy.current=true;
    try {await readIntent(intent);} finally {busy.current=false;}
  }
  function acceptCreation() {
    if(!busy.current && state.creation.phase==='review' && state.creation.review && store.current()) finish(state.creation.review,false);
  }
  const operationOwners=useRef<Record<string,'edit'|'move'|'delete'>>({});
  function acquire(id:string,owner:'edit'|'move'|'delete'){
    const current=operationOwners.current[id];if(current&&current!==owner)return false;
    operationOwners.current[id]=owner;return true;
  }
  function release(id:string,owner:'edit'|'move'|'delete'){if(operationOwners.current[id]===owner)delete operationOwners.current[id];}
  const operationCallbacks={confirm:confirmTask,refresh,
    missing:(id:string)=>{accepted.current=++epoch.current;dispatch({type:'task_missing',id});},
    stale:()=>dispatch({type:'list_error',error:'Сверка изменения не завершена. Последний снимок может быть устаревшим.'}),
    beginRead:()=>++epoch.current,canAccept:(ticket:number)=>ticket>=accepted.current,
    toCreation:(draft:UserFields)=>{draftRef.current=draft;store.saveDraft(draft);dispatch({type:'draft',draft});changeCreation({open:true});}};
  const editing=useTaskEditing({...operationCallbacks,acquire:(id)=>acquire(id,'edit'),release:(id)=>release(id,'edit')});
  const moving=useTaskEditing({...operationCallbacks,acquire:(id)=>acquire(id,'move'),release:(id)=>release(id,'move')},'move');
  const deleting=useTaskEditing({...operationCallbacks,acquire:(id)=>acquire(id,'delete'),release:(id)=>release(id,'delete')},'delete');
  function blocked(id:string){return [editing.records[id]?.phase,moving.records[id]?.phase,deleting.records[id]?.phase].some(phase=>phase!==undefined&&['sending','reading','unknown','review'].includes(phase));}
  useEffect(()=>{
    void refresh();
    return ()=>{ listAbort.current?.abort(); selectionAbort.current?.abort(); };
  },[refresh]);
  return {state,refresh,select,dismiss,editing,moving,deleting,blocked,day,changeDraft,submitCreation,retryCreation,reconcileCreation,acceptCreation,
    openCreation:()=>changeCreation({open:true}),closeCreation:()=>changeCreation({open:false}),discardDraft:resetDraft,storageWarning:store.warning};
}

export function fieldMessage(field:string,code:string):string {
  if(code==='invalid_length') return field==='title'?'Название должно содержать от 1 до 200 кодовых точек.':'Описание не должно превышать 5000 кодовых точек.';
  if(code==='invalid_date') return 'Укажите существующую дату ГГГГ-ММ-ДД, год от 0001 до 9999.';
  if(code==='missing') return 'Обязательное поле не заполнено.';
  if(code==='invalid_characters' || code==='invalid_unicode') return 'Текст содержит недопустимые символы.';
  return 'Проверьте значение поля.';
}
