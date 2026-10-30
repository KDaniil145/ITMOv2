import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { fieldMessage, type Selection, type CreationState } from './useKanban';
import type { UserFields } from './types';
import { emptyDraft, intentFields } from './creationIntent';
import { formatDue, priorityLabels, statusLabels } from './TaskCard';
export function TaskDialog({selection,onClose,onRetry,onEdit,onMove,onDelete,blocked}:{selection:Selection;onClose:()=>void;onRetry:()=>void;onEdit:()=>void;onMove:()=>void;onDelete:()=>void;blocked:boolean}) {
  const dialog=useRef<HTMLDialogElement>(null), close=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const node=dialog.current;
    node?.showModal(); close.current?.focus();
    return ()=>node?.close();
  },[]);
  useEffect(()=>{
    if(dialog.current?.open && !dialog.current.contains(document.activeElement)) close.current?.focus();
  },[selection.phase]);
  const task=selection.task;
  return <dialog className="task-dialog" ref={dialog} aria-labelledby="task-dialog-title"
    onCancel={event=>{event.preventDefault();onClose();}}
    onKeyDown={trapTab}>
    <div className="dialog-top"><h2 id="task-dialog-title">{task?.title || (selection.phase==='loading'?'Загрузка задачи':'Просмотр задачи')}</h2>
      <button type="button" className="board-button" ref={close} onClick={onClose}>Закрыть</button></div>
    {selection.phase==='loading' && <p role="status">Загружаем задачу</p>}
    {(selection.phase==='error' || selection.phase==='absent') && <div role="alert"><p>{selection.error}</p>
      {selection.phase==='error' && <button type="button" className="board-button" onClick={onRetry}>Повторить загрузку задачи</button>}</div>}
    {task && <><p className="sr-only" role="status">Задача загружена</p><dl className="task-details">
      <dt>Описание</dt><dd className="full-description">{task.description || 'Без описания'}</dd>
      <dt>Статус</dt><dd>{statusLabels[task.status]}</dd>
      <dt>Приоритет</dt><dd>{priorityLabels[task.priority]}</dd>
      <dt>Срок</dt><dd>{formatDue(task.due_date)}</dd>
    </dl><div className="dialog-actions" aria-describedby="read-only-notice">
      <button type="button" className="board-button" disabled={blocked} onClick={onEdit}>Редактировать</button><button type="button" className="board-button" disabled={blocked} onClick={onMove}>Переместить</button><button type="button" className="board-button" disabled={blocked} onClick={onDelete}>Удалить</button>
    </div><p id="read-only-notice" className="read-only-note">Перед удалением потребуется подтверждение.</p></>}
  </dialog>;
}

export function trapTab(event:KeyboardEvent<HTMLDialogElement>) {
  if(event.key!=='Tab') return;
  const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')).filter(node=>node.getClientRects().length>0);
  const first=controls[0],last=controls[controls.length-1];
  if(!first) {event.preventDefault();return;}
  if(event.shiftKey && document.activeElement===first) {event.preventDefault();last.focus();}
  else if(!event.shiftKey && document.activeElement===last) {event.preventDefault();first.focus();}
}
const createFieldOrder=['title','description','status','priority','due_date'];
interface CreateDialogProps {
  creation:CreationState;draft:UserFields;warning:string;
  onDraft:(field:keyof UserFields,value:string|null)=>void;
  onSubmit:()=>void;onRetry:()=>void;onRead:()=>void;onAccept:()=>void;onClose:()=>void;onDiscard:()=>void;
}
export function CreateTaskDialog(props:CreateDialogProps) {
  const {creation,draft,warning}=props;
  const dialog=useRef<HTMLDialogElement>(null),title=useRef<HTMLInputElement>(null),continued=useRef<HTMLButtonElement>(null),summary=useRef<HTMLDivElement>(null);
  const [confirm,setConfirm]=useState(false);
  const pending=creation.phase==='sending' || creation.phase==='reconciling';
  useEffect(()=>{const node=dialog.current;node?.showModal();title.current?.focus();return()=>node?.close();},[]);
  useEffect(()=>{if(confirm) continued.current?.focus();else title.current?.focus();},[confirm]);
  useEffect(()=>{
    if(!creation.errors.length) return;
    const first=createFieldOrder.find(field=>creation.errors.some(error=>error.field===field));
    if(first) dialog.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();else summary.current?.focus();
  },[creation.errors]);
  function requestClose() {
    if(JSON.stringify(draft)!==JSON.stringify(emptyDraft())) setConfirm(true);else props.onClose();
  }
  function error(field:string) {
    const detail=creation.errors.find(item=>item.field===field);
    return detail?<p className="field-error" id={`create-${field}-error`}>{fieldMessage(field,detail.code)}</p>:null;
  }
  function described(field:string) {return `create-${field}-hint`+(creation.errors.some(item=>item.field===field)?` create-${field}-error`:'');}
  const original=creation.intent?intentFields(creation.intent):null;
  return <dialog ref={dialog} className="task-dialog create-dialog" aria-labelledby="create-title" onCancel={event=>{event.preventDefault();requestClose();}} onKeyDown={trapTab}>
    <div className="dialog-top"><h2 id="create-title">Создание задачи</h2><button type="button" className="board-button" onClick={requestClose}>Закрыть</button></div>
    {confirm?<div role="group" aria-labelledby="discard-title"><h3 id="discard-title">Несохранённый черновик</h3>
      <p>Продолжите ввод, сохраните черновик для следующего открытия или явно отбросьте его. Уже отправленное намерение останется до сверки.</p>
      <div className="dialog-actions"><button type="button" ref={continued} className="board-button" onClick={()=>setConfirm(false)}>Продолжить ввод</button>
      <button type="button" className="board-button" onClick={props.onClose}>Сохранить черновик и закрыть</button>
      <button type="button" className="board-button" onClick={()=>{props.onDiscard();props.onClose();}}>Отбросить черновик</button></div></div>:<>
      {warning && <p className="create-warning" role="status">{warning}</p>}
      {creation.message && <div ref={summary} tabIndex={-1} className="create-message" role={pending?'status':'alert'}>{creation.message}</div>}
      {creation.review && <section className="creation-review" aria-label="Сведения на сервере"><h3>Сведения на сервере</h3><p>{creation.review.title}</p><p className="full-description">{creation.review.description||'Без описания'}</p>
        <p>{statusLabels[creation.review.status]} · {priorityLabels[creation.review.priority]} · {formatDue(creation.review.due_date)}</p>
        <button type="button" className="board-button" onClick={props.onAccept}>Принять задачу с сервера</button></section>}
      {original && <details className="creation-original"><summary>Первоначально отправленные данные</summary><p>{original.title}</p><p className="full-description">{original.description||'Без описания'}</p><p>{statusLabels[original.status]} · {priorityLabels[original.priority]} · {formatDue(original.due_date)}</p>
        <p>Изменения в форме ниже не меняют первоначальную отправку.</p></details>}
      {creation.intent && <div className="dialog-actions">
        {creation.phase==='retry_available' && <button type="button" className="board-button" onClick={props.onRetry}>Повторить исходную отправку</button>}
        <button type="button" className="board-button" disabled={pending} onClick={props.onRead}>Сверить состояние</button>
      </div>}
      <form noValidate onSubmit={event=>{event.preventDefault();props.onSubmit();}} className="create-form">
        <label htmlFor="create-title-input">Название (обязательно)</label>
        <input id="create-title-input" name="title" ref={title} value={draft.title} aria-required="true" aria-invalid={creation.errors.some(e=>e.field==='title')} aria-describedby={described('title')} onChange={e=>props.onDraft('title',e.target.value)}/>
        <p id="create-title-hint" className="field-hint">От 1 до 200 кодовых точек после обрезки краёв · Сейчас: {[...draft.title].length}</p>{error('title')}
        <label htmlFor="create-description">Описание</label>
        <textarea id="create-description" name="description" rows={4} value={draft.description} aria-invalid={creation.errors.some(e=>e.field==='description')} aria-describedby={described('description')} onChange={e=>props.onDraft('description',e.target.value)}/>
        <p id="create-description-hint" className="field-hint">До 5000 кодовых точек; пробелы сохраняются · Сейчас: {[...draft.description].length}</p>{error('description')}
        <label htmlFor="create-status">Статус</label><select id="create-status" name="status" value={draft.status} aria-invalid={creation.errors.some(e=>e.field==='status')} aria-describedby={described('status')} onChange={e=>props.onDraft('status',e.target.value)}>
          {Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><p id="create-status-hint" className="field-hint">Можно создать задачу сразу в любом статусе.</p>{error('status')}
        <label htmlFor="create-priority">Приоритет</label><select id="create-priority" name="priority" value={draft.priority} aria-invalid={creation.errors.some(e=>e.field==='priority')} aria-describedby={described('priority')} onChange={e=>props.onDraft('priority',e.target.value)}>
          {Object.entries(priorityLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><p id="create-priority-hint" className="field-hint">По умолчанию — средний.</p>{error('priority')}
        <label htmlFor="create-due">Срок (необязательно)</label><input id="create-due" name="due_date" type="text" placeholder="ГГГГ-ММ-ДД" value={draft.due_date??''} aria-invalid={creation.errors.some(e=>e.field==='due_date')} aria-describedby={described('due_date')} onChange={e=>props.onDraft('due_date',e.target.value||null)}/>
        <p id="create-due_date-hint" className="field-hint">Год от 0001 до 9999; прошедшая дата допустима. Пустое поле — без срока.</p>{error('due_date')}
        <div className="dialog-actions">{!creation.intent && <button type="submit" className="board-button primary-action" disabled={pending}>{creation.phase==='retired'?'Создать как новую задачу':'Создать'}</button>}
          <button type="button" className="board-button" onClick={requestClose}>Отмена</button></div>
      </form>
    </>}
  </dialog>;
}

interface MoveDialogProps {
 record:import('./editState').EditState;
 onTarget:(target:string)=>void;onSubmit:()=>void;onRead:()=>void;onAccept:()=>void;onClose:()=>void;
}
export function MoveTaskDialog({record,onTarget,onSubmit,onRead,onAccept,onClose}:MoveDialogProps){
 const dialog=useRef<HTMLDialogElement>(null),select=useRef<HTMLSelectElement>(null),summary=useRef<HTMLParagraphElement>(null);
 const pending=record.phase==='sending'||record.phase==='reading';
 useEffect(()=>{const node=dialog.current;node?.showModal();select.current?.focus();return()=>node?.close();},[]);
 useEffect(()=>{if(['review','unknown','absent','exhausted'].includes(record.phase))summary.current?.focus();},[record.phase]);
 return <dialog ref={dialog} className="task-dialog" aria-labelledby="move-dialog-title" onKeyDown={trapTab} onCancel={event=>{event.preventDefault();onClose();}}>
  <div className="dialog-top"><h2 id="move-dialog-title">Перемещение задачи</h2><button type="button" className="board-button" onClick={onClose}>Закрыть</button></div>
  <p>{record.base.title}</p><p>Выбранная колонка: {statusLabels[record.draft.status]}</p>
  {record.message&&<p ref={summary} tabIndex={-1} className="create-message" role={pending?'status':'alert'}>{record.message}</p>}
  {record.phase==='ready'&&<form className="create-form" onSubmit={event=>{event.preventDefault();onSubmit();}}>
   <label htmlFor="move-target">Целевая колонка</label><select id="move-target" ref={select} value={record.draft.status} onChange={e=>onTarget(e.target.value)}>{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
   <div className="dialog-actions"><button type="submit" className="board-button primary-action">Переместить</button><button type="button" className="board-button" onClick={onClose}>Отмена</button></div>
  </form>}
  {record.phase==='review'&&record.fresh&&<section className="creation-review" aria-label="Актуальное состояние переноса"><p>Сейчас: {statusLabels[record.fresh.status]}</p><p>Задача: {record.fresh.title}</p><p className="full-description">{record.fresh.description||'Без описания'}</p><p>{priorityLabels[record.fresh.priority]} · {formatDue(record.fresh.due_date)}</p>
   <div className="dialog-actions"><button type="button" className="board-button" onClick={onSubmit}>Повторить перенос</button><button type="button" className="board-button" onClick={onAccept}>Оставить актуальный статус</button></div></section>}
  {record.phase==='unknown'&&<button type="button" className="board-button" onClick={onRead}>Повторить сверку</button>}
  {record.phase!=='ready'&&<button type="button" className="board-button" onClick={onClose}>Закрыть окно</button>}
 </dialog>;
}

export function DeleteTaskDialog({record,onSubmit,onRead,onClose}:{record:import('./editState').EditState;onSubmit:()=>void;onRead:()=>void;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null);
 const pending=record.phase==='sending'||record.phase==='reading',task=record.fresh||record.base;
 useEffect(()=>{const node=dialog.current;node?.showModal();cancel.current?.focus();return()=>node?.close();},[]);
 useEffect(()=>{if(record.phase==='review'||record.phase==='unknown')cancel.current?.focus();},[record.phase]);
 return <dialog className="task-dialog" ref={dialog} aria-labelledby="delete-dialog-title" onKeyDown={trapTab} onCancel={event=>{event.preventDefault();onClose();}}>
 <div className="dialog-top"><h2 id="delete-dialog-title">Удаление задачи</h2><button type="button" className="board-button" onClick={onClose}>Закрыть</button></div>
 <p className="full-description">{task.title}</p><p>Удаление необратимо. Задача будет удалена без возможности восстановления.</p>
 {record.phase==='review'&&<section className="creation-review" aria-label="Актуальные сведения перед удалением"><p>Актуальная задача: {task.title}</p><p className="full-description">{task.description||'Без описания'}</p><p>{statusLabels[task.status]} · {priorityLabels[task.priority]} · {formatDue(task.due_date)}</p></section>}
 {record.message&&<p role={pending?'status':'alert'} className="create-message">{record.message}</p>}
 <div className="dialog-actions"><button type="button" className="board-button" ref={cancel} onClick={onClose}>Отмена</button>
 {(record.phase==='ready'||record.phase==='review')&&<button type="button" className="board-button" onClick={onSubmit}>{record.phase==='review'?'Подтвердить удаление заново':'Удалить'}</button>}
 {record.phase==='unknown'&&<button type="button" className="board-button" onClick={onRead}>Повторить сверку</button>}</div>
 </dialog>;
}
