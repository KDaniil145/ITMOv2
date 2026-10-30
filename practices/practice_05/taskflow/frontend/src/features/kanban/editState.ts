import type { Task, UserFields, PatchTaskRequest, ValidationDetail } from './types';
import { validateInput } from './validation';
export const editableFields = ['title','description','status','priority','due_date'] as const;
export function fieldsOf(task: UserFields): UserFields { return Object.fromEntries(editableFields.map(key=>[key,task[key]])) as unknown as UserFields; }
export function changedFields(base:Task,draft:UserFields):Partial<UserFields> {
  const normalized=validateInput('patch',{version:base.version,...fieldsOf(draft)});
  return Object.fromEntries(editableFields.filter(key=>normalized[key]!==base[key]).map(key=>[key,normalized[key]])) as Partial<UserFields>;
}
export function patchFor(base:Task,draft:UserFields,selected:readonly (keyof UserFields)[]=editableFields):PatchTaskRequest|null {
  if(!selected.length)return null;
  const normalized=validateInput('patch',{version:base.version,...Object.fromEntries(selected.map(key=>[key,draft[key]]))});
  const chosen=Object.fromEntries(selected.filter(key=>normalized[key]!==base[key]).map(key=>[key,normalized[key]]));
  return Object.keys(chosen).length?{version:base.version,...chosen} as PatchTaskRequest:null;
}
export type EditPhase='ready'|'sending'|'reading'|'review'|'unknown'|'absent'|'exhausted';
export interface EditState {base:Task;draft:UserFields;phase:EditPhase;fresh:Task|null;message:string;errors:ValidationDetail[];revision:number}
export function startEdit(task:Task):EditState {return {base:task,draft:fieldsOf(task),phase:'ready',fresh:null,message:'',errors:[],revision:0};}
