import {useRef,useState} from 'react';
import {kanbanApi,KanbanApiError} from './api';
import {statusLabels} from './TaskCard';
import {InputError} from './validation';
import {fieldsOf,patchFor,startEdit,type EditState} from './editState';
import type {Status,Task,UserFields} from './types';
interface Callbacks {confirm:(task:Task)=>void;missing:(id:string)=>void;stale:()=>void;refresh:()=>Promise<void>;beginRead:()=>number;canAccept:(ticket:number)=>boolean;toCreation:(draft:UserFields)=>void;acquire:(id:string)=>boolean;release:(id:string)=>void}
export function useTaskEditing(callbacks:Callbacks,mode:'edit'|'move'|'delete'='edit') {
  const [records,setRecords]=useState<Record<string,EditState>>({});
  const recordsRef=useRef(records);
  const [active,setActive]=useState<string|null>(null);
  const [notice,setNotice]=useState('');
  const [completed,setCompleted]=useState<Task|null>(null);
  const [removed,setRemoved]=useState<Task|null>(null);
  function put(id:string,value:EditState|null) {
    const next={...recordsRef.current};if(value)next[id]=value;else delete next[id];
    recordsRef.current=next;setRecords(next);
  }
  function open(task:Task,target?:Status){if(!recordsRef.current[task.id])put(task.id,{...startEdit(task),draft:{...fieldsOf(task),status:target??task.status}});setActive(task.id);setNotice('');}
  function change(field:keyof UserFields,value:string|null){
    if(!active)return;const record=recordsRef.current[active];if(!record)return;
    put(active,{...record,draft:{...record.draft,[field]:value},revision:record.revision+1,errors:[]});
  }
  function finishDelete(task:Task,acknowledged:boolean){
    callbacks.missing(task.id);callbacks.release(task.id);put(task.id,null);setRemoved(task);
    setActive(value=>value===task.id?null:value);
    setNotice(acknowledged?'Задача удалена.':'Задача уже отсутствует. Авторство удаления не установлено.');
    if(acknowledged)void callbacks.refresh();
  }
  async function read(id:string) {
    const previous=recordsRef.current[id];if(!previous || ['sending','reading'].includes(previous.phase))return;
    put(id,{...previous,phase:'reading',fresh:null,message:'Сверяем актуальное состояние задачи.',errors:[]});
    const ticket=callbacks.beginRead();
    try {
      const task=await kanbanApi.getTask(id);
      const record=recordsRef.current[id];if(!record)return;
      if(!callbacks.canAccept(ticket)) {put(id,{...record,phase:'unknown',message:'Получены более свежие сведения. Повторите сверку.'});callbacks.stale();return;}
      callbacks.confirm(task);
      if(mode==='move' && task.status===record.draft.status){
        callbacks.release(id);put(id,null);setCompleted(task);setActive(value=>value===id?null:value);setNotice(`Состояние сверено. Колонка: ${statusLabels[task.status]}. Дополнительный перенос не требуется; авторство изменения не установлено.`);return;
      }
      put(id,{...record,phase:'review',fresh:task,message:mode==='delete'?'Задача существует. Проверьте актуальные сведения и подтвердите удаление заново.':mode==='move'?'Состояние сверено. Выбранная колонка ещё не установлена. Повторите перенос явно с актуальной версией либо оставьте текущий статус.':'Состояние сверено. Совпадение значений не доказывает, кто выполнил изменение. Примите актуальные данные или явно выберите поля для применения.'});
    } catch(error) {
      const record=recordsRef.current[id];if(!record)return;
      if(!callbacks.canAccept(ticket)){put(id,{...record,phase:'unknown',fresh:null,message:'Данные обновились. Повторите сверку.'});callbacks.stale();return;}
      if(error instanceof KanbanApiError && error.apiError?.code==='task_not_found') {
        if(mode==='delete'){finishDelete(record.fresh||record.base,false);return;}
        callbacks.release(id);callbacks.missing(id);put(id,{...record,phase:'absent',fresh:null,message:'Задача уже отсутствует. Черновик сохранён отдельно.'});
      }else{callbacks.stale();put(id,{...record,phase:'unknown',fresh:null,message:'Сверка не удалась. Черновик сохранён; запись заблокирована до успешного чтения.'});}
    }
  }
  async function submit(selected?:readonly (keyof UserFields)[],taskId=active) {
    if(!taskId)return;const id=taskId,record=recordsRef.current[id];
    if(!record || !['ready','review'].includes(record.phase))return;
    const base=record.phase==='review'?record.fresh!:record.base;
    if(record.phase==='review' && !selected && mode!=='delete')return;
    let patch;
    try{patch=mode==='delete'?undefined:patchFor(base,record.draft,mode==='move'?['status']:selected);}catch(error){
      put(id,{...record,errors:error instanceof InputError?error.details.map(d=>({...d,message:'Проверьте значение поля.'})):[],message:'Проверьте поля формы.'});return;
    }
    if(!patch && mode!=='delete'){
      if(record.phase==='review'){put(id,{...record,message:'Выберите изменения или примите актуальные данные.'});return;}
      callbacks.release(id);put(id,null);setActive(value=>value===id?null:value);setNotice('Изменений нет. Запрос не отправлялся.');return;
    }
    if(!callbacks.acquire(id))return;
    put(id,{...record,phase:'sending',errors:[],message:'Сохраняем изменения.'});
    try {
      if(mode==='delete'){await kanbanApi.deleteTask(id,base.version);finishDelete(base,true);return;}
      const task=await kanbanApi.patchTask(id,patch!);
      callbacks.confirm(task);callbacks.release(id);
      const current=recordsRef.current[id];if(!current)return;
      if(current.revision===record.revision){put(id,null);setActive(value=>value===id?null:value);}
      else put(id,{...current,base:task,fresh:null,phase:'ready',message:'Изменения сохранены. Более новый черновик оставлен отдельно.'});
      if(mode==='move')setCompleted(task);
      setNotice(mode==='move'?`Перемещение подтверждено. Колонка: ${statusLabels[task.status]}.`:'Изменения сохранены.');void callbacks.refresh();
    }catch(error){
      const current=recordsRef.current[id];if(!current)return;
      const code=error instanceof KanbanApiError?error.apiError?.code:undefined;
      if(code==='version_exhausted'){callbacks.release(id);put(id,{...current,phase:'exhausted',fresh:null,message:'Достигнут предел версии задачи. Изменения не сохранены'});}
      else if(code==='version_conflict' || code==='task_not_found' || !(error instanceof KanbanApiError) || error.outcome==='unknown'){
        put(id,{...current,phase:'unknown',fresh:null,message:code==='version_conflict'?'Задача была изменена. Черновик сохранён.':'Результат изменения неизвестен. Черновик сохранён.'});
        await read(id);
      }else {callbacks.release(id);put(id,{...current,phase:'ready',errors:error.apiError?.details||[],message:'Сервер отклонил запрос. Черновик сохранён.'});}
    }
  }
  function accept(){if(!active)return;const record=recordsRef.current[active];if(record?.phase!=='review'||!record.fresh)return;callbacks.confirm(record.fresh);callbacks.release(active);put(active,null);setActive(null);setNotice('Приняты актуальные данные.');}
  function discard(){if(!active)return;const record=recordsRef.current[active];if(record && !['sending','reading','unknown'].includes(record.phase)){callbacks.release(active);put(active,null);setActive(null);}}
  function createFromDraft(){if(!active)return;const record=recordsRef.current[active];if(record?.phase!=='absent')return;callbacks.toCreation(fieldsOf(record.draft));setActive(null);}
  function moveTo(task:Task,target:Status){
    if(mode!=='move' || task.status===target || recordsRef.current[task.id])return;
    put(task.id,{...startEdit(task),draft:{...fieldsOf(task),status:target}});
    void submit(['status'],task.id);
  }
  function close(){
    if(active && ((mode==='move'&&recordsRef.current[active]?.phase==='ready')||(mode==='delete'&&['ready','review'].includes(recordsRef.current[active]?.phase)))){callbacks.release(active);put(active,null);}
    setActive(null);
  }
  return {records,active,notice,completed,removed,open,change,submit,read,accept,discard,createFromDraft,moveTo,close,resume:(id:string)=>setActive(id)};
}
