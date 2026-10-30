import { test, expect } from '@playwright/test';
import { CreationIntentStore, newIntent, INTENT_KEY, DRAFT_KEY } from '../../src/features/kanban/creationIntent';
const id='8b28fe8b-7a58-4c84-a733-1135f31237fe';
const draft={title:' x ',description:'  😀  ',status:'todo' as const,priority:'medium' as const,due_date:null};
function storage() {
  const data=new Map<string,string>();
  return {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};
}
test('one canonical ID, normalized frozen original body independent of mutable draft',()=>{
  let ids=0;
  const input={...draft}; const intent=newIntent(input,()=>{ids++;return id;});
  input.title='changed';
  expect(ids).toBe(1); expect(Object.isFrozen(intent)).toBe(true);
  expect(JSON.parse(intent.serializedBody)).toEqual({...draft,title:'x',id});
  expect(()=>newIntent(draft,()=>id.toUpperCase())).toThrow();
});
test('reload restores exact serialized body and draft separately; clearing intent preserves draft',()=>{
  const disk=storage(), first=new CreationIntentStore(()=>disk);
  const intent=newIntent(draft,()=>id);
  first.saveIntent(intent); first.saveDraft({...draft,title:'Edited after send'});
  const second=new CreationIntentStore(()=>disk);
  expect(second.loadIntent()).toEqual(intent);
  expect(second.loadDraft()?.title).toBe('Edited after send');
  second.clearIntent();
  expect(disk.getItem(INTENT_KEY)).toBeNull();
  expect(disk.getItem(DRAFT_KEY)).not.toBeNull();
  expect(second.loadDraft()?.title).toBe('Edited after send');
});
test('blocked session storage retains memory intent and warns, without inventing recovery guarantee',()=>{
  const store=new CreationIntentStore(()=>{throw new Error('blocked');});
  expect(store.loadIntent()).toBeNull();
  const intent=newIntent(draft,()=>id); store.saveIntent(intent); store.saveDraft(draft);
  expect(store.current()).toEqual(intent); expect(store.loadDraft()).toEqual(draft);
  expect(store.warning).toContain('памяти');
});
test('corrupt persisted intent is not silently accepted or resent',()=>{
  const disk=storage(); disk.setItem(INTENT_KEY,JSON.stringify({id,serializedBody:'{"id":"other"}'}));
  const store=new CreationIntentStore(()=>disk);
  expect(store.loadIntent()).toBeNull(); expect(store.warning).not.toBe('');
});

test('draft hydration does not coerce enum types from malformed stored values',()=>{
  const disk=storage();disk.setItem(DRAFT_KEY,JSON.stringify({...draft,status:['todo']}));
  const store=new CreationIntentStore(()=>disk);
  expect(store.loadDraft()).toBeNull();expect(store.warning).not.toBe('');
});
