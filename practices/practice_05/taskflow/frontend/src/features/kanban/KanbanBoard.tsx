import { useEffect, useRef, useState } from 'react';
import { STATUSES, type Status, type Task } from './types';
import { useKanban } from './useKanban';
import { EditTaskDialog } from './EditTaskDialog';
import { TaskCard, statusLabels } from './TaskCard';
import { TaskDialog, CreateTaskDialog, MoveTaskDialog, DeleteTaskDialog } from './TaskDialog';

export function KanbanBoard() {
  const model=useKanban();
  const {state,refresh,select,dismiss}=model;
  const createButton=useRef<HTMLButtonElement>(null);
  const root=useRef<HTMLElement>(null);
  const opener=useRef<{element:HTMLElement;status:Status;index:number} | null>(null);
  const [dragging,setDragging]=useState<string|null>(null),[target,setTarget]=useState<Status|null>(null);
  const focusedMove=useRef<Task|null>(null);
  useEffect(()=>{
    const task=model.moving.completed;
    if(!task||focusedMove.current===task||state.selected||model.moving.active||model.editing.active||state.creation.open)return;
    const frame=requestAnimationFrame(()=>{const card=root.current?.querySelector<HTMLElement>(`[data-task-id="${task.id}"]`);if(card){card.focus();card.scrollIntoView({block:'nearest'});focusedMove.current=task;}});
    return()=>cancelAnimationFrame(frame);
  },[model.moving.completed,model.moving.active,model.editing.active,state.selected,state.creation.open]);
  const previousEdit=useRef<string|null>(null);
  useEffect(()=>{
    const id=previousEdit.current;
    previousEdit.current=model.editing.active;
    if(!id || model.editing.active || state.creation.open)return;
    const frame=requestAnimationFrame(()=>{
      const card=root.current?.querySelector<HTMLElement>(`[data-task-id="${id}"]`);
      if(card){card.focus();card.scrollIntoView({block:'nearest'});}
      else root.current?.querySelector<HTMLElement>('h2')?.focus();
    });
    return()=>cancelAnimationFrame(frame);
  },[model.editing.active,state.creation.open]);
  const focusedDelete=useRef<Task|null>(null);
  useEffect(()=>{
    const task=model.deleting.removed;
    if(!task||focusedDelete.current===task||state.selected||model.deleting.active||model.editing.active||model.moving.active||state.creation.open)return;
    const frame=requestAnimationFrame(()=>{
      const column=root.current?.querySelector<HTMLElement>(`[data-status="${task.status}"]`);
      const cards=Array.from(column?.querySelectorAll<HTMLElement>('[data-task-id]')||[]);
      const next=cards.find(card=>{const value=state.snapshot?.items.find(t=>t.id===card.dataset.taskId);return value&&(value.created_at>task.created_at||(value.created_at===task.created_at&&value.id>task.id));})||column?.querySelector<HTMLElement>('h2');
      next?.focus();next?.scrollIntoView({block:'nearest'});focusedDelete.current=task;
    });
    return()=>cancelAnimationFrame(frame);
  },[model.deleting.removed,model.deleting.active,model.editing.active,model.moving.active,state.selected,state.creation.open,state.snapshot]);
  function remember(task: Task,element:HTMLElement) {
    opener.current={element,status:task.status,index:state.snapshot!.items.filter(t=>t.status===task.status).findIndex(t=>t.id===task.id)};
  }
  function open(task:Task,element:HTMLElement){remember(task,element);void select(task.id);}
  function openMove(task:Task){
    if(model.blocked(task.id))return;
    const card=root.current?.querySelector<HTMLElement>(`[data-task-id="${task.id}"]`);
    if(card)remember(task,card);
    model.moving.open(task);
  }
  function close() {
    dismiss();
    const previous=opener.current;
    requestAnimationFrame(()=>{
      if(previous?.element.isConnected) {previous.element.focus();return;}
      const same=root.current?.querySelector<HTMLElement>(`[data-task-id="${previous?.element.dataset.taskId}"]`);
      if(same) {same.focus();return;}
      const column=root.current?.querySelector<HTMLElement>(`[data-status="${previous?.status || 'todo'}"]`);
      const cards=column?.querySelectorAll<HTMLElement>('[data-task-id]');
      const fallback=cards?.[previous?.index || 0] || column?.querySelector<HTMLElement>('h2');
      fallback?.focus();
    });
  }
  return <section ref={root} className="kanban" aria-labelledby="board-title">
    <div className="board-heading"><div><div className="eyebrow">ОТ ИДЕИ К РЕЗУЛЬТАТУ</div><h1 id="board-title">Доска задач</h1><p>Всё важное — перед глазами.</p></div>
      <div className="board-toolbar"><button type="button" className="board-button" ref={createButton} disabled={!state.snapshot} onClick={model.openCreation}>Создать задачу</button>
        <button type="button" className="board-button" onClick={()=>void refresh()} disabled={state.refreshing}>Обновить</button></div></div>
    {model.deleting.notice && <p role="status" className="board-message">{model.deleting.notice}</p>}
    {!model.deleting.active&&Object.entries(model.deleting.records).map(([id,record])=><div key={id} className="board-message"><p role="status">Удаление: {record.message||record.base.title}</p><button type="button" className="board-button" onClick={()=>model.deleting.resume(id)}>Продолжить удаление: {record.base.title}</button></div>)}
    {model.moving.notice && <p role="status" className="board-message">{model.moving.notice}</p>}
    {!model.moving.active && Object.entries(model.moving.records).map(([id,record])=><div className="board-message" key={id}><p role="status">Перемещение: {record.message||record.base.title}</p><button type="button" className="board-button" onClick={()=>model.moving.resume(id)}>Продолжить перемещение: {record.base.title}</button></div>)}
    {model.editing.notice && <p role="status" className="board-message">{model.editing.notice}</p>}
    {!model.editing.active && Object.entries(model.editing.records).map(([id,record])=><div key={id} className="board-message"><p>Черновик редактирования: {record.draft.title}</p><button type="button" className="board-button" onClick={()=>model.editing.resume(id)}>Продолжить редактирование: {record.draft.title}</button></div>)}
    {state.creation.notice && <p role="status" className="board-message">{state.creation.notice}</p>}
    {state.creation.intent && !state.creation.open && <div className="board-message"><p role="status">Незавершённое создание. {state.creation.message}</p>
      <button type="button" className="board-button" onClick={model.openCreation}>Продолжить создание</button>
      <button type="button" className="board-button" disabled={state.creation.phase==='sending'||state.creation.phase==='reconciling'} onClick={()=>void model.reconcileCreation()}>Сверить состояние</button>
      {model.storageWarning && <p>{model.storageWarning}</p>}</div>}
    {state.phase==='loading'  && <p role="status" className="board-message">Загружаем задачи</p>}
    {(state.phase==='error' || state.phase==='stale') && <div className="board-message board-error" role="alert"><p>{state.error}</p>
      {state.snapshot && <p>Данные могут быть устаревшими. Показан последний подтверждённый снимок.</p>}
      <button type="button" className="board-button" disabled={state.refreshing} onClick={()=>void refresh()}>Повторить</button></div>}
    {state.refreshing && state.snapshot && <p role="status">Обновляем задачи</p>}
    {state.snapshot && <>
      {state.snapshot.total===0 && <p className="board-message">Создайте первую задачу</p>}
      <div className="board-columns" aria-busy={state.refreshing}>
        {STATUSES.map(status=>{
          const tasks=state.snapshot!.items.filter(task=>task.status===status);
          return <section key={status} className={`board-column${target===status?' board-column--target':''}`} data-status={status}
            onDragOver={event=>{if(dragging&&!model.blocked(dragging)){event.preventDefault();event.dataTransfer.dropEffect='move';setTarget(status);}}}
            onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setTarget(null);}}
            onDrop={event=>{event.preventDefault();const id=dragging;setDragging(null);setTarget(null);if(!id||model.blocked(id))return;const task=state.snapshot?.items.find(t=>t.id===id);if(task)model.moving.moveTo(task,status);}} aria-labelledby={`column-${status}`}>
            <div className="column-heading"><h2 id={`column-${status}`} tabIndex={-1}>{statusLabels[status]}</h2><span className="column-count" aria-label={`Задач: ${tasks.length}`}>{tasks.length}</span></div>
            {tasks.length===0?<p className="column-empty">Здесь пока нет задач</p>:<ul className="task-list">{tasks.map(task=><li key={task.id}><TaskCard day={model.day} task={task} blocked={model.blocked(task.id)} onOpen={element=>open(task,element)} onMove={()=>openMove(task)}
              onDragStart={event=>{if(model.blocked(task.id)){event.preventDefault();return;}event.dataTransfer.setData('text/plain',task.id);event.dataTransfer.effectAllowed='move';setDragging(task.id);}}
              onDragEnd={()=>{setDragging(null);setTarget(null);}} /></li>)}</ul>}
          </section>;
        })}
      </div></>}
    {state.creation.open && <CreateTaskDialog creation={state.creation} draft={state.draft} warning={model.storageWarning}
      onDraft={model.changeDraft} onSubmit={model.submitCreation} onRetry={model.retryCreation} onRead={()=>void model.reconcileCreation()} onAccept={model.acceptCreation}
      onDiscard={model.discardDraft} onClose={()=>{model.closeCreation();requestAnimationFrame(()=>createButton.current?.focus());}} />}
    {model.editing.active && model.editing.records[model.editing.active] && <EditTaskDialog blocked={[model.moving.records[model.editing.active]?.phase,model.deleting.records[model.editing.active]?.phase].some(phase=>phase!==undefined&&['sending','reading','unknown','review'].includes(phase))} key={model.editing.active} record={model.editing.records[model.editing.active]} onChange={model.editing.change} onSubmit={keys=>void model.editing.submit(keys)} onRead={()=>void model.editing.read(model.editing.active!)} onAccept={()=>{model.editing.accept();close();}} onDiscard={()=>{model.editing.discard();close();}} onCreate={model.editing.createFromDraft} onClose={()=>{model.editing.close();close();}} />}
    {model.moving.active && model.moving.records[model.moving.active] && <MoveTaskDialog record={model.moving.records[model.moving.active]} onTarget={status=>model.moving.change('status',status)} onSubmit={()=>void model.moving.submit(['status'])} onRead={()=>void model.moving.read(model.moving.active!)} onAccept={()=>{model.moving.accept();close();}} onClose={()=>{model.moving.close();close();}} />}
    {model.deleting.active&&model.deleting.records[model.deleting.active]&&<DeleteTaskDialog record={model.deleting.records[model.deleting.active]} onSubmit={()=>void model.deleting.submit()} onRead={()=>void model.deleting.read(model.deleting.active!)} onClose={()=>{model.deleting.close();close();}} />}
    {state.selected && <TaskDialog selection={state.selected} onDelete={()=>{if(state.selected?.task){model.deleting.open(state.selected.task);dismiss();}}} blocked={model.blocked(state.selected.id)} onMove={()=>{if(state.selected?.task){model.moving.open(state.selected.task);dismiss();}}} onClose={close} onRetry={()=>void select(state.selected!.id)} onEdit={()=>{if(state.selected?.task){model.editing.open(state.selected.task);dismiss();}}} />}
  </section>;
}
