import type { UserFields } from './types';
import { isRecord, isUuid, validateInput } from './validation';
export interface CreationIntent { readonly id: string; readonly serializedBody: string }
export const INTENT_KEY='taskflow-kanban-create-intent';
export const DRAFT_KEY='taskflow-kanban-create-draft';
export const emptyDraft=():UserFields=>({title:'',description:'',status:'todo',priority:'medium',due_date:null});
export function newIntent(draft: UserFields, idFactory:()=>string=()=>crypto.randomUUID()): CreationIntent {
  const id=idFactory(), values=validateInput('create',{...draft,id});
  return Object.freeze({id,serializedBody:JSON.stringify(values)});
}
export function intentFields(intent:CreationIntent): UserFields {
  const values=validateInput('create',JSON.parse(intent.serializedBody));
  return {title:values.title as string,description:values.description as string,status:values.status as UserFields['status'],priority:values.priority as UserFields['priority'],due_date:values.due_date as string|null};
}
export function sameFields(draft:UserFields, fields:UserFields): boolean {
  try {
    const normalized=validateInput('create',{...draft,id:'00000000-0000-4000-8000-000000000000'});
    return (Object.keys(emptyDraft()) as (keyof UserFields)[]).every(field=>normalized[field]===fields[field]);
  } catch {return false;}
}
export class CreationIntentStore {
  warning='';
  private intent: CreationIntent | null=null;
  private draft:UserFields|null=null;
  constructor(private storage:()=>Pick<Storage,'getItem'|'setItem'|'removeItem'>) {}
  private unavailable() {this.warning='Сеансовое хранилище недоступно: намерение и черновик удерживаются только в памяти. После перезагрузки восстановление не гарантируется.';}
  loadIntent():CreationIntent|null {
    try {
      const raw=this.storage().getItem(INTENT_KEY);
      if(raw) {
        const saved:unknown=JSON.parse(raw);
        if(!isRecord(saved) || !isUuid(saved.id) || typeof saved.serializedBody!=='string') throw new Error('Invalid intent');
        const values=validateInput('create',JSON.parse(saved.serializedBody));
        if(values.id!==saved.id) throw new Error('Mismatched intent ID');
        this.intent=Object.freeze({id:saved.id,serializedBody:saved.serializedBody});
      }
    } catch {this.unavailable();}
    return this.intent;
  }
  current() {return this.intent;}
  saveIntent(intent:CreationIntent) {
    this.intent=Object.freeze({...intent});
    try {this.storage().setItem(INTENT_KEY,JSON.stringify(this.intent));} catch {this.unavailable();}
  }
  clearIntent() {
    this.intent=null;
    try {this.storage().removeItem(INTENT_KEY);} catch {this.unavailable();}
  }
  loadDraft():UserFields|null {
    try {
      const raw=this.storage().getItem(DRAFT_KEY);
      if(raw) {
        const value:unknown=JSON.parse(raw);
        if(!isRecord(value) || typeof value.title!=='string' || typeof value.description!=='string' ||
          typeof value.status!=='string' || !['todo','in_progress','done'].includes(value.status) || typeof value.priority!=='string' || !['low','medium','high'].includes(value.priority) ||
          !(value.due_date===null || typeof value.due_date==='string')) throw new Error('Invalid draft');
        this.draft={title:value.title,description:value.description,status:value.status as UserFields['status'],priority:value.priority as UserFields['priority'],due_date:value.due_date as string|null};
      }
    } catch {this.unavailable();}
    return this.draft;
  }
  saveDraft(draft:UserFields) {
    this.draft={...draft};
    try {this.storage().setItem(DRAFT_KEY,JSON.stringify(this.draft));} catch {this.unavailable();}
  }
  clearDraft() {
    this.draft=null;
    try {this.storage().removeItem(DRAFT_KEY);} catch {this.unavailable();}
  }
}
