import {test,expect} from './fixtures';
import {fixture} from '../support/backend.mjs';
import type {Page} from '@playwright/test';
const id='00000000-0000-4000-8000-000000000000';
const labels={todo:'К выполнению',in_progress:'В работе',done:'Готово'};
test.beforeEach(()=>fixture('seed'));test.afterEach(()=>fixture('restore'));
async function board(page:Page){await page.goto('/');await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();await expect(page.locator('[data-task-id]')).toHaveCount(30);}
async function form(page:Page,taskId=id){await page.locator(`[data-task-id="${taskId}"]`).click();await page.getByRole('dialog').getByRole('button',{name:'Переместить',exact:true}).click();return page.getByRole('dialog',{name:'Перемещение задачи',exact:true});}
test('button move preserves fields and server order, confirms focus and survives reload',async({page})=>{
 await board(page);const base=fixture('snapshot').tasks[0];const dialog=await form(page);await dialog.getByLabel('Целевая колонка',{exact:true}).selectOption('in_progress');await dialog.getByRole('button',{name:'Переместить',exact:true}).click();await expect(dialog).toHaveCount(0);
 const card=page.locator(`[data-task-id="${id}"]`);await expect(card).toBeFocused();await expect(page.locator('[data-status="in_progress"] [data-task-id]').first()).toHaveAttribute('data-task-id',id);
 const task=fixture('snapshot').tasks.find(t=>t.id===id)!;expect(task).toMatchObject({...base,status:'in_progress',version:2,updated_at:task.updated_at});
 await page.reload();await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();await expect(page.locator('[data-status="in_progress"] [data-task-id]').first()).toHaveAttribute('data-task-id',id);
});
for(const source of ['todo','in_progress','done'] as const)for(const target of ['todo','in_progress','done'] as const)if(source!==target)test(`native drag ${source} -> ${target}`,async({page})=>{
 await board(page);const index={todo:0,in_progress:1,done:2}[source],taskId=`00000000-0000-4000-8000-${index.toString(16).padStart(12,'0')}`;const before=fixture('snapshot').tasks.find(t=>t.id===taskId)!;
 await page.locator(`[data-task-id="${taskId}"]`).dragTo(page.locator(`[data-status="${target}"] h2`));await expect(page.locator(`[data-status="${target}"] [data-task-id="${taskId}"]`)).toBeVisible();await expect(page.locator(`[data-status="${source}"] .column-count`)).toHaveText('9');await expect(page.locator(`[data-status="${target}"] .column-count`)).toHaveText('11');await expect(page.locator(`[data-task-id="${taskId}"]`)).toBeFocused();
 const saved=fixture('snapshot').tasks.find(t=>t.id===taskId)!;expect(saved).toMatchObject({...before,status:target,version:2,updated_at:saved.updated_at});await expect(page.getByRole('status').filter({hasText:`Колонка: ${labels[target]}`})).toBeVisible();
});

test('same status, cancel and dropping in original column send no PATCH',async({page})=>{
 await board(page);let patches=0;page.on('request',r=>{if(r.method()==='PATCH')patches++;});
 let dialog=await form(page);await dialog.getByRole('button',{name:'Переместить',exact:true}).click();await expect(dialog).toHaveCount(0);
 dialog=await form(page);await dialog.getByLabel('Целевая колонка',{exact:true}).selectOption('done');await dialog.getByRole('button',{name:'Отмена',exact:true}).click();await expect(dialog).toHaveCount(0);
 await page.locator(`[data-task-id="${id}"]`).dragTo(page.locator('[data-status="todo"] h2'));expect(patches).toBe(0);expect(fixture('snapshot').tasks[0].version).toBe(1);
});

test('conflict already at target needs no second PATCH or overwrite',async({page,request})=>{
 await board(page);const dialog=await form(page);await dialog.getByLabel('Целевая колонка',{exact:true}).selectOption('done');
 await request.patch('/api/tasks/'+id,{data:{version:1,status:'done',description:'Чужое описание'}});
 let patches=0;page.on('request',r=>{if(r.method()==='PATCH')patches++;});await dialog.getByRole('button',{name:'Переместить',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('status').filter({hasText:'Дополнительный перенос не требуется'})).toBeVisible();
 expect(patches).toBe(1);const task=fixture('snapshot').tasks[0];expect(task.description).toBe('Чужое описание');expect(task.status).toBe('done');expect(task.version).toBe(2);
});

test('different status and repeated conflict require new explicit confirmation, preserving concurrent fields',async({page,request})=>{
 await board(page);const dialog=await form(page);await dialog.getByLabel('Целевая колонка',{exact:true}).selectOption('done');
 await request.patch('/api/tasks/'+id,{data:{version:1,status:'in_progress',description:'Чужой текст'}});
 await dialog.getByRole('button',{name:'Переместить',exact:true}).click();await expect(dialog.getByRole('region',{name:'Актуальное состояние переноса'})).toContainText('Чужой текст');expect(fixture('snapshot').tasks[0].status).toBe('in_progress');
 await request.patch('/api/tasks/'+id,{data:{version:2,title:'Ещё изменение',priority:'high'}});
 await dialog.getByRole('button',{name:'Повторить перенос',exact:true}).click();await expect(dialog.getByRole('region',{name:'Актуальное состояние переноса'})).toContainText('Ещё изменение');expect(fixture('snapshot').tasks[0].version).toBe(3);
 await dialog.getByRole('button',{name:'Повторить перенос',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(fixture('snapshot').tasks[0]).toMatchObject({title:'Ещё изменение',description:'Чужой текст',priority:'high',status:'done',version:4,due_date:'0001-01-01'});
});

test('lost response after commit is read back without another PATCH',async({page})=>{
 await board(page);const dialog=await form(page);await dialog.getByLabel('Целевая колонка',{exact:true}).selectOption('done');let patches=0;
 await page.route(`**/api/tasks/${id}`,async route=>{if(route.request().method()==='PATCH'){patches++;const response=await route.fetch();expect(response.status()).toBe(200);await route.abort('failed');}else await route.continue();});
 await dialog.getByRole('button',{name:'Переместить',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.locator(`[data-status="done"] [data-task-id="${id}"]`)).toBeVisible();expect(patches).toBe(1);expect(fixture('snapshot').tasks[0].version).toBe(2);
});

test('lost request and failed GET block move and edit until manual successful reconciliation',async({page})=>{
 await board(page);const dialog=await form(page);await dialog.getByLabel('Целевая колонка',{exact:true}).selectOption('done');let patches=0;
 await page.route(`**/api/tasks/${id}`,async route=>{if(route.request().method()==='PATCH'){patches++;fixture('corrupt');await route.abort('failed');}else await route.continue();});
 await dialog.getByRole('button',{name:'Переместить',exact:true}).click();await expect(dialog.getByText('Сверка не удалась.',{exact:false})).toBeVisible();await expect(dialog.getByRole('button',{name:'Повторить перенос',exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(page.getByRole('button',{name:'Переместить задачу: Задача 00',exact:true})).toBeDisabled();
 fixture('restore');await page.locator(`[data-task-id="${id}"]`).click();await expect(page.getByRole('dialog').getByRole('button',{name:'Редактировать',exact:true})).toBeDisabled();await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByRole('button',{name:'Продолжить перемещение: Задача 00',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Повторить сверку',exact:true}).click();await expect(page.getByRole('dialog').getByRole('button',{name:'Повторить перенос',exact:true})).toBeVisible();expect(patches).toBe(1);expect(fixture('snapshot').tasks[0].status).toBe('todo');
 await page.getByRole('dialog').getByRole('button',{name:'Оставить актуальный статус',exact:true}).click();expect(patches).toBe(1);await expect(page.getByRole('button',{name:'Переместить задачу: Задача 00',exact:true})).toBeEnabled();
});

test('external 404 removes card while keeping independent edit draft',async({page})=>{
 await board(page);await page.locator(`[data-task-id="${id}"]`).click();await page.getByRole('dialog').getByRole('button',{name:'Редактировать',exact:true}).click();const edit=page.getByRole('dialog');await edit.getByLabel('Название (обязательно)',{exact:true}).fill('Отдельный черновик');await edit.getByRole('button',{name:'Закрыть',exact:true}).click();await edit.getByRole('button',{name:'Сохранить черновик и закрыть',exact:true}).click();
 const dialog=await form(page);await dialog.getByLabel('Целевая колонка',{exact:true}).selectOption('done');fixture('delete_first');await dialog.getByRole('button',{name:'Переместить',exact:true}).click();await expect(dialog.getByText('Задача уже отсутствует.',{exact:false})).toBeVisible();await expect(page.locator(`[data-task-id="${id}"]`)).toHaveCount(0);
 await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByRole('button',{name:'Продолжить редактирование: Отдельный черновик',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('Название (обязательно)',{exact:true})).toHaveValue('Отдельный черновик');expect(fixture('snapshot').tasks).toHaveLength(29);
});

for(const source of ['todo','in_progress','done'] as const)for(const target of ['todo','in_progress','done'] as const)if(source!==target)test(`keyboard button ${source} -> ${target} sends only status/version`,async({page})=>{
 await board(page);const index={todo:0,in_progress:1,done:2}[source],taskId=`00000000-0000-4000-8000-${index.toString(16).padStart(12,'0')}`;const before=fixture('snapshot').tasks.find(t=>t.id===taskId)!;
 await page.getByRole('button',{name:`Переместить задачу: Задача 0${index}`,exact:true}).focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:'Перемещение задачи'}),select=dialog.getByLabel('Целевая колонка',{exact:true});await expect(select).toBeFocused();
 await page.keyboard.press('Home');for(let i=0;i<{todo:0,in_progress:1,done:2}[target];i++)await page.keyboard.press('ArrowDown');await expect(select).toHaveValue(target);await page.keyboard.press('Tab');await expect(dialog.getByRole('button',{name:'Переместить',exact:true})).toBeFocused();
 const requestPromise=page.waitForRequest(r=>r.method()==='PATCH');await page.keyboard.press('Enter');const request=await requestPromise;expect(request.postDataJSON()).toEqual({version:1,status:target});await expect(dialog).toHaveCount(0);
 await expect(page.locator(`[data-status="${target}"] [data-task-id="${taskId}"]`)).toBeFocused();const saved=fixture('snapshot').tasks.find(t=>t.id===taskId)!;expect(saved).toMatchObject({...before,status:target,version:2,updated_at:saved.updated_at});
});

test('pending is not optimistic, duplicate is blocked, and a different task can move',async({page})=>{
 await board(page);const dialog=await form(page);await dialog.getByLabel('Целевая колонка',{exact:true}).selectOption('done');let count=0,release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),seen=new Promise<void>(r=>entered=r);
 await page.route(`**/api/tasks/${id}`,async route=>{if(route.request().method()==='PATCH'){count++;entered();await gate;const response=await route.fetch();await route.fulfill({response});}else await route.continue();});
 await dialog.getByRole('button',{name:'Переместить',exact:true}).evaluate(b=>{(b as HTMLButtonElement).click();(b as HTMLButtonElement).click();});await seen;
 await expect(page.locator(`[data-status="todo"] [data-task-id="${id}"]`)).toHaveCount(1);expect(fixture('snapshot').tasks[0].version).toBe(1);await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
 await expect(page.getByRole('button',{name:'Переместить задачу: Задача 00',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Переместить задачу: Задача 01',exact:true}).click();const other=page.getByRole('dialog');await other.getByLabel('Целевая колонка',{exact:true}).selectOption('todo');await other.getByRole('button',{name:'Переместить',exact:true}).click();await expect(other).toHaveCount(0);
 release();await expect(page.locator(`[data-status="done"] [data-task-id="${id}"]`)).toBeVisible();expect(count).toBe(1);expect(fixture('snapshot').tasks.find(t=>t.id.endsWith('0001'))!.status).toBe('todo');
});

test('two actual tabs: second move wins, first gets conflict without reverting the target',async({page,context})=>{
 await board(page);const first=await form(page);await first.getByLabel('Целевая колонка',{exact:true}).selectOption('done');const other=await context.newPage();await board(other);const second=await form(other);await second.getByLabel('Целевая колонка',{exact:true}).selectOption('done');await second.getByRole('button',{name:'Переместить',exact:true}).click();await expect(second).toHaveCount(0);
 await first.getByRole('button',{name:'Переместить',exact:true}).click();await expect(first).toHaveCount(0);await expect(page.getByRole('status').filter({hasText:'Дополнительный перенос не требуется'})).toBeVisible();expect(fixture('snapshot').tasks[0]).toMatchObject({status:'done',version:2});await other.close();
});

for(const width of [390,1440])for(const dark of [false,true])test(`move alternative accessibility ${width} dark=${dark}`,async({browser},info)=>{
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:width===390});const page=await context.newPage();await page.addInitScript(d=>localStorage.setItem('taskflow-theme',d?'dark':'light'),dark);
 await board(page);const button=page.getByRole('button',{name:'Переместить задачу: Задача 00',exact:true});
 if(width===390)await button.tap();else{await button.focus();await page.keyboard.press('Enter');}
 let dialog=page.getByRole('dialog',{name:'Перемещение задачи'});await expect(dialog.getByLabel('Целевая колонка',{exact:true})).toBeFocused();await page.screenshot({path:info.outputPath('move.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.locator(`[data-task-id="${id}"]`)).toBeFocused();
 if(width===390)await button.tap();else await button.click();dialog=page.getByRole('dialog');await dialog.getByLabel('Целевая колонка',{exact:true}).selectOption('done');if(width===390)await dialog.getByRole('button',{name:'Переместить',exact:true}).tap();else await dialog.getByRole('button',{name:'Переместить',exact:true}).click();await expect(dialog).toHaveCount(0);
 const card=page.locator(`[data-status="done"] [data-task-id="${id}"]`);await expect(card).toBeInViewport();await expect(card).toBeFocused();expect(fixture('snapshot').tasks[0].version).toBe(2);await context.close();
});

test('an existing edit draft cannot write while this task has an unresolved move',async({page})=>{
 await board(page);await page.locator(`[data-task-id="${id}"]`).click();await page.getByRole('dialog').getByRole('button',{name:'Редактировать',exact:true}).click();let dialog=page.getByRole('dialog');await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Отдельный черновик');await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await dialog.getByRole('button',{name:'Сохранить черновик и закрыть',exact:true}).click();
 dialog=await form(page);await dialog.getByLabel('Целевая колонка',{exact:true}).selectOption('done');let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),seen=new Promise<void>(r=>entered=r);
 await page.route(`**/api/tasks/${id}`,async route=>{if(route.request().method()==='PATCH'){entered();await gate;const response=await route.fetch();await route.fulfill({response});}else await route.continue();});
 await dialog.getByRole('button',{name:'Переместить',exact:true}).click();await seen;await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByRole('button',{name:'Продолжить редактирование: Отдельный черновик',exact:true}).click();await expect(page.getByRole('dialog').getByRole('button',{name:'Сохранить',exact:true})).toBeDisabled();
 release();await expect(page.getByRole('dialog').getByRole('button',{name:'Сохранить',exact:true})).toBeEnabled();expect(fixture('snapshot').tasks[0]).toMatchObject({title:'Задача 00',status:'done',version:2});
});

test('network failure before commit requires an explicit move after GET',async({page})=>{
 await board(page);const dialog=await form(page);await dialog.getByLabel('Целевая колонка',{exact:true}).selectOption('done');let patches=0;
 await page.route(`**/api/tasks/${id}`,async route=>{if(route.request().method()==='PATCH'&&++patches===1)await route.abort('failed');else await route.continue();});
 await dialog.getByRole('button',{name:'Переместить',exact:true}).click();await expect(dialog.getByRole('button',{name:'Повторить перенос',exact:true})).toBeVisible();expect(patches).toBe(1);expect(fixture('snapshot').tasks[0]).toMatchObject({status:'todo',version:1});
 await dialog.getByRole('button',{name:'Повторить перенос',exact:true}).click();await expect(dialog).toHaveCount(0);expect(patches).toBe(2);expect(fixture('snapshot').tasks[0]).toMatchObject({status:'done',version:2});
});
