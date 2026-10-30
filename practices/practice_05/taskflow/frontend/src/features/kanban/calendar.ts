import {useEffect,useState} from 'react';
import type {Task} from './types';
export function localDay(now=new Date()):string{return `${String(now.getFullYear()).padStart(4,'0')}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;}
export function isOverdue(task:Pick<Task,'due_date'|'status'>,day:string):boolean{return task.status!=='done' && task.due_date!==null && task.due_date<day;}

// Re-arm at local midnight; the one-minute cap also detects device timezone changes.
export function useLocalDay(){
 const [day,setDay]=useState(()=>localDay());
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>;
  function check(){
   clearTimeout(timer);const now=new Date();setDay(localDay(now));
   const midnight=new Date(now);midnight.setHours(24,0,0,0);
   timer=setTimeout(check,Math.max(1,Math.min(60000,midnight.getTime()-now.getTime()+1)));
  }
  check();document.addEventListener('visibilitychange',check);window.addEventListener('focus',check);
  return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',check);window.removeEventListener('focus',check);};
 },[]);
 return day;
}
