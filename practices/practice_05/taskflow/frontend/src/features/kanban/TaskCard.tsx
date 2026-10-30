import { useEffect, useRef, useState } from 'react';
import {isOverdue} from './calendar';
import type { Task } from './types';
export const statusLabels={todo:'К выполнению',in_progress:'В работе',done:'Готово'};
export const priorityLabels={low:'Низкий',medium:'Средний',high:'Высокий'};
export function formatDue(due: string | null) { return due?due.split('-').reverse().join('.'):'Без срока'; }
export function TaskCard({task,onOpen,onMove,day,blocked,onDragStart,onDragEnd}:{task:Task;day:string;blocked:boolean;onOpen:(element:HTMLButtonElement)=>void;onMove:()=>void;onDragStart:(event:import('react').DragEvent<HTMLButtonElement>)=>void;onDragEnd:()=>void}) {
  const description=useRef<HTMLSpanElement>(null);
  const [clipped,setClipped]=useState(false);
  useEffect(()=>{
    const element=description.current;
    if(!element) return;
    const observer=new ResizeObserver(()=>setClipped(element.scrollHeight>element.clientHeight+1));
    observer.observe(element); return ()=>observer.disconnect();
  },[task.description]);
  return <div className="task-card-wrap"><button type="button" className="task-card" data-task-id={task.id}
    draggable={!blocked} onDragStart={onDragStart} onDragEnd={onDragEnd} aria-busy={blocked}
    aria-label={`Открыть задачу: ${task.title}`} onClick={event=>onOpen(event.currentTarget)}>
    {isOverdue(task,day)&&<span className="task-overdue">Просрочено</span>}
    <span className="task-title">{task.title}</span>
    <span ref={description} className="task-description">{task.description || 'Без описания'}</span>
    {clipped && <span className="task-shortened">Описание сокращено · Открыть полностью</span>}
    <span className="task-meta"><span className={`priority priority--${task.priority}`}>Приоритет: {priorityLabels[task.priority]}</span>
      <span>{task.due_date?<><span>Срок: </span><time dateTime={task.due_date}>{formatDue(task.due_date)}</time></>:formatDue(null)}</span></span>
  </button><button type="button" className="board-button task-move-button" disabled={blocked} aria-label={`Переместить задачу: ${task.title}`} onClick={onMove}>Переместить</button></div>;
}
