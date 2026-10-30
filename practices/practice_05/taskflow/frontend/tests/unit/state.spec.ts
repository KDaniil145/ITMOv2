import {test,expect} from '@playwright/test';
import {changedFields,patchFor} from '../../src/features/kanban/editState';
import type {Task} from '../../src/features/kanban/types';
const base:Task={id:'8b28fe8b-7a58-4c84-a733-1135f31237fe',title:'До',description:'Не трогать',status:'todo',priority:'high',due_date:'0001-01-01',version:2,created_at:'2026-10-30T00:00:00.000001Z',updated_at:'2026-10-30T00:00:00.000002Z'};
test('normalizes before detecting no-op and never builds version-only PATCH',()=>{
 expect(patchFor(base,{...base,title:'\tДо\u00a0'})).toBeNull();
 expect(patchFor(base,{...base,description:'',due_date:null})).toEqual({version:2,description:'',due_date:null});
});
test('explicit conflict choices apply only selected changes to fresh version',()=>{
 const fresh={...base,title:'Чужой заголовок',description:'Чужое описание',version:3};
 const draft={...base,title:'Мой заголовок',due_date:null};
 expect(changedFields(base,draft)).toEqual({title:'Мой заголовок',due_date:null});
 expect(patchFor(fresh,draft,['title'])).toEqual({version:3,title:'Мой заголовок'});
 expect(patchFor(fresh,draft,[])).toBeNull();
});
test('invalid draft is rejected before PATCH while original object stays intact',()=>{
 const draft={...base,title:'',due_date:'2025-02-29'};expect(()=>patchFor(base,draft)).toThrow();expect(draft.title).toBe('');
});
test('an unselected invalid field cannot enter or prevent a selected valid conflict PATCH',()=>{
 expect(patchFor(base,{...base,title:'Выбрано',due_date:'bad'},['title'])).toEqual({version:2,title:'Выбрано'});
});
for(const status of ['todo','in_progress','done'] as const)for(const target of ['todo','in_progress','done'] as const)test(`move payload ${status} -> ${target} has no other fields or no-op request`,()=>{
 const task={...base,status};expect(patchFor(task,{...task,status:target},['status'])).toEqual(status===target?null:{version:2,status:target});
 expect(task.title).toBe(base.title);expect(task.due_date).toBe('0001-01-01');
});
