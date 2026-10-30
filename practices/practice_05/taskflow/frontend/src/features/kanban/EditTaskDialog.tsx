import {useEffect,useRef,useState} from 'react';
import {editableFields,type EditState} from './editState';
import type {UserFields} from './types';
import {fieldMessage} from './useKanban';
import {trapTab} from './TaskDialog';
import {statusLabels,priorityLabels,formatDue} from './TaskCard';
const labels={title:'Название (обязательно)',description:'Описание',status:'Статус',priority:'Приоритет',due_date:'Срок (необязательно)'};
interface Props {record:EditState;blocked:boolean;onChange:(field:keyof UserFields,value:string|null)=>void;onSubmit:(selected?:readonly (keyof UserFields)[])=>void;onRead:()=>void;onAccept:()=>void;onClose:()=>void;onDiscard:()=>void;onCreate:()=>void}
function display(field:keyof UserFields,value:string|null){return field==='status'?statusLabels[value as keyof typeof statusLabels]:field==='priority'?priorityLabels[value as keyof typeof priorityLabels]:field==='due_date'?formatDue(value):value||'Пусто';}
export function EditTaskDialog({record,blocked,onChange,onSubmit,onRead,onAccept,onClose,onDiscard,onCreate}:Props){
 const dialog=useRef<HTMLDialogElement>(null),title=useRef<HTMLInputElement>(null),summary=useRef<HTMLDivElement>(null),continueButton=useRef<HTMLButtonElement>(null);
 const [confirm,setConfirm]=useState(false),[chosen,setChosen]=useState<(keyof UserFields)[]>([]);
 const pending=record.phase==='sending'||record.phase==='reading';
 const dirty=editableFields.some(field=>record.draft[field]!==record.base[field]);
 useEffect(()=>{const node=dialog.current;node?.showModal();title.current?.focus();return()=>node?.close();},[]);
 useEffect(()=>{if(confirm)continueButton.current?.focus();},[confirm]);
 useEffect(()=>{if(record.errors.length){const field=editableFields.find(key=>record.errors.some(e=>e.field===key));if(field)dialog.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();else summary.current?.focus();}},[record.errors]);
 useEffect(()=>{if(record.phase==='review'||record.phase==='absent'||record.phase==='exhausted'||record.phase==='unknown')summary.current?.focus();},[record.phase]);
 const fresh=record.fresh;
 function close(){if(dirty||pending||record.phase==='unknown')setConfirm(true);else onClose();}
 return <dialog ref={dialog} className="task-dialog create-dialog" aria-labelledby="edit-dialog-title" onKeyDown={trapTab} onCancel={e=>{e.preventDefault();close();}}>
 <div className="dialog-top"><h2 id="edit-dialog-title">Редактирование задачи</h2><button type="button" className="board-button" onClick={close}>Закрыть</button></div>
 {confirm?<section aria-label="Несохранённый черновик"><h3>Черновик редактирования</h3><p>Закрытие не отменяет уже отправленный запрос. Черновик сохранится в текущем сеансе.</p><div className="dialog-actions">
 <button ref={continueButton} type="button" className="board-button" onClick={()=>{setConfirm(false);requestAnimationFrame(()=>title.current?.focus());}}>Продолжить ввод</button>
 <button type="button" className="board-button" onClick={onClose}>Сохранить черновик и закрыть</button>
 <button type="button" className="board-button" disabled={pending||record.phase==='unknown'} onClick={onDiscard}>Отбросить черновик</button></div></section>:<>
 {record.message&&<div className="create-message" ref={summary} tabIndex={-1} role={pending?'status':'alert'}>{record.message}</div>}
 {record.phase==='review'&&fresh&&<section aria-label="Сравнение изменений" className="creation-review"><h3>Актуальная задача и ваш черновик</h3>
 <p>Выберите только поля, которые хотите применить. Остальные сохранят серверные значения.</p>
 {editableFields.map(field=><div className="edit-difference" key={field}><strong>{labels[field]}</strong><p>На сервере: {display(field,fresh[field])}</p><p>В черновике: {display(field,record.draft[field])}</p>
 {fresh[field]!==record.draft[field]&&<label><input type="checkbox" checked={chosen.includes(field)} onChange={e=>setChosen(keys=>e.target.checked?[...keys,field]:keys.filter(k=>k!==field))}/>Применить: {labels[field]}</label>}</div>)}
 <div className="dialog-actions"><button type="button" className="board-button" onClick={onAccept}>Принять актуальные данные</button>
 <button type="button" className="board-button" disabled={blocked||!chosen.some(field=>fresh[field]!==record.draft[field])} onClick={()=>{onSubmit(chosen.filter(field=>fresh[field]!==record.draft[field]));setChosen([]);}}>Применить выбранные изменения</button></div></section>}
 {(record.phase==='unknown'||record.phase==='absent')&&<button type="button" className="board-button" onClick={onRead}>Повторить сверку</button>}
 {record.phase==='absent'&&<button type="button" className="board-button" onClick={onCreate}>Перенести черновик в создание</button>}
 <form noValidate className="create-form" onSubmit={e=>{e.preventDefault();onSubmit();}}>
 {editableFields.map(field=>{
 const error=record.errors.find(item=>item.field===field),id=`edit-${field}`,common={id,name:field,'aria-invalid':!!error,'aria-describedby':`${id}-hint${error?` ${id}-error`:''}`};
 return <div className="edit-field" key={field}><label htmlFor={id}>{labels[field]}</label>
 {field==='description'?<textarea {...common} rows={4} value={record.draft.description} onChange={e=>onChange(field,e.target.value)}/>:field==='status'||field==='priority'?<select {...common} value={record.draft[field]} onChange={e=>onChange(field,e.target.value)}>{Object.entries(field==='status'?statusLabels:priorityLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>:<input {...common} ref={field==='title'?title:undefined} type="text" aria-required={field==='title'} value={record.draft[field]??''} onChange={e=>onChange(field,field==='due_date'?(e.target.value||null):e.target.value)}/>}
 <p id={`${id}-hint`} className="field-hint">{field==='title'?`От 1 до 200 кодовых точек после обрезки · Сейчас: ${[...record.draft.title].length}`:field==='description'?`До 5000 кодовых точек; пробелы сохраняются · Сейчас: ${[...record.draft.description].length}`:field==='due_date'?'ГГГГ-ММ-ДД, год 0001–9999. Пустое поле очищает срок.':'Выберите значение.'}</p>
 {error&&<p id={`${id}-error`} className="field-error">{fieldMessage(field,error.code)}</p>}</div>;
 })}
 <div className="dialog-actions">{record.phase==='ready'&&<button type="submit" disabled={blocked} className="board-button primary-action">Сохранить</button>}
 <button type="button" className="board-button" onClick={close}>Отмена</button></div></form></>}
 </dialog>;
}
