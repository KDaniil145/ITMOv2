import {test,expect} from './fixtures';
import {fixture} from '../support/backend.mjs';
import type {Page} from '@playwright/test';
const id='00000000-0000-4000-8000-000000000000';
test.beforeEach(()=>fixture('seed'));test.afterEach(()=>fixture('restore'));
async function board(page:Page){await page.goto('/');await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();await expect(page.locator('[data-task-id]')).toHaveCount(30);}
async function confirm(page:Page,taskId=id){await page.locator(`[data-task-id="${taskId}"]`).click();await page.getByRole('dialog').getByRole('button',{name:'Удалить',exact:true}).click();return page.getByRole('dialog',{name:'Удаление задачи',exact:true});}
for(const index of [0,1,2])test(`delete column ${index} is confirmed, preserves others and focuses next card`,async({page})=>{
 await board(page);const taskId=`00000000-0000-4000-8000-${index.toString(16).padStart(12,'0')}`,before=fixture('snapshot').tasks;const dialog=await confirm(page,taskId);
 await expect(dialog.getByRole('button',{name:'Отмена',exact:true})).toBeFocused();await expect(dialog).toContainText(`Задача 0${index}`);await expect(dialog).toContainText('необратимо');
 await dialog.getByRole('button',{name:'Удалить',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.locator(`[data-task-id="${taskId}"]`)).toHaveCount(0);
 const after=fixture('snapshot');expect(after.tasks).toEqual(before.filter(t=>t.id!==taskId));expect(after.retired).toEqual([taskId]);await expect(page.locator(`[data-status="${['todo','in_progress','done'][index]}"] .column-count`)).toHaveText('9');await expect(page.locator(`[data-task-id="00000000-0000-4000-8000-${(index+3).toString(16).padStart(12,'0')}"]`)).toBeFocused();
});
test('cancel and Escape never send DELETE',async({page})=>{
 await board(page);let deletes=0;page.on('request',r=>{if(r.method()==='DELETE')deletes++;});let dialog=await confirm(page);await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);dialog=await confirm(page);await dialog.getByRole('button',{name:'Отмена',exact:true}).click();await expect(dialog).toHaveCount(0);expect(deletes).toBe(0);expect(fixture('snapshot').tasks).toHaveLength(30);
});

test('concurrent edit requires fresh details and a second explicit delete confirmation',async({page,request})=>{
 await board(page);const dialog=await confirm(page);await request.patch('/api/tasks/'+id,{data:{version:1,title:'Изменено другой вкладкой',description:'Свежий текст'}});let deletes=0;page.on('request',r=>{if(r.method()==='DELETE')deletes++;});
 await dialog.getByRole('button',{name:'Удалить',exact:true}).click();await expect(dialog.getByRole('region',{name:'Актуальные сведения перед удалением'})).toContainText('Свежий текст');await expect(dialog.getByRole('button',{name:'Отмена',exact:true})).toBeFocused();expect(deletes).toBe(1);expect(fixture('snapshot').tasks[0]).toMatchObject({title:'Изменено другой вкладкой',version:2});
 await request.patch('/api/tasks/'+id,{data:{version:2,title:'Повторное изменение'}});await dialog.getByRole('button',{name:'Подтвердить удаление заново',exact:true}).click();await expect(dialog.getByRole('region',{name:'Актуальные сведения перед удалением'})).toContainText('Повторное изменение');expect(fixture('snapshot').tasks[0].version).toBe(3);
 await dialog.getByRole('button',{name:'Подтвердить удаление заново',exact:true}).click();await expect(dialog).toHaveCount(0);expect(deletes).toBe(3);expect(fixture('snapshot').retired).toContain(id);
});

test('another actual tab deletes first; 404 is absence, not ownership',async({page,context})=>{
 await board(page);const dialog=await confirm(page);const other=await context.newPage();await board(other);const second=await confirm(other);await second.getByRole('button',{name:'Удалить',exact:true}).click();await expect(second).toHaveCount(0);
 await dialog.getByRole('button',{name:'Удалить',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('status').filter({hasText:'Задача уже отсутствует.'})).toBeVisible();expect(fixture('snapshot').retired).toEqual([id]);await other.close();
});

for(const afterCommit of [false,true])test(`lost DELETE response afterCommit=${afterCommit} never retries automatically`,async({page})=>{
 await board(page);const dialog=await confirm(page);let deletes=0;const urls:string[]=[];
 await page.route(`**/api/tasks/${id}?*`,async route=>{if(route.request().method()==='DELETE'){deletes++;urls.push(route.request().url());if(deletes===1){if(afterCommit){const response=await route.fetch();expect(response.status()).toBe(204);}await route.abort('failed');}else await route.continue();}else await route.continue();});
 await dialog.getByRole('button',{name:'Удалить',exact:true}).click();
 if(afterCommit){await expect(dialog).toHaveCount(0);await expect(page.getByRole('status').filter({hasText:'Задача уже отсутствует.'})).toBeVisible();expect(fixture('snapshot').retired).toEqual([id]);}
 else{await expect(dialog.getByRole('button',{name:'Подтвердить удаление заново',exact:true})).toBeVisible();expect(fixture('snapshot').tasks).toHaveLength(30);expect(deletes).toBe(1);await dialog.getByRole('button',{name:'Подтвердить удаление заново',exact:true}).click();await expect(dialog).toHaveCount(0);expect(deletes).toBe(2);expect(urls[0]).toBe(urls[1]);}
});

test('lost committed DELETE then real GET503 stays unresolved until explicit GET404',async({page})=>{
 await board(page);const dialog=await confirm(page);let deletes=0;
 await page.route(`**/api/tasks/${id}?*`,async route=>{if(route.request().method()==='DELETE'){deletes++;await route.fetch();fixture('corrupt');await route.abort('failed');}else await route.continue();});
 await dialog.getByRole('button',{name:'Удалить',exact:true}).click();await expect(dialog.getByText('Сверка не удалась.',{exact:false})).toBeVisible();await expect(dialog.getByRole('button',{name:'Удалить',exact:true})).toHaveCount(0);await expect(page.locator(`[data-task-id="${id}"]`)).toHaveCount(1);
 await dialog.getByRole('button',{name:'Отмена',exact:true}).click();await expect(page.getByRole('button',{name:'Переместить задачу: Задача 00',exact:true})).toBeDisabled();fixture('restore');await page.locator(`[data-task-id="${id}"]`).click();await expect(page.getByRole('dialog').getByText('Задача уже отсутствует',{exact:true})).toBeVisible();await expect(page.getByRole('dialog').getByRole('button',{name:'Удалить',exact:true})).toHaveCount(0);await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByRole('button',{name:'Продолжить удаление: Задача 00',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Повторить сверку',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(deletes).toBe(1);expect(fixture('snapshot').tasks).toHaveLength(29);expect(fixture('snapshot').retired).toEqual([id]);
});

test('pending deletion blocks only same ID, keeps board until ACK, duplicate is suppressed',async({page})=>{
 await board(page);const dialog=await confirm(page);let deletes=0,release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),seen=new Promise<void>(r=>entered=r);
 await page.route(`**/api/tasks/${id}?*`,async route=>{if(route.request().method()==='DELETE'){deletes++;entered();await gate;await route.fulfill({response:await route.fetch()});}else await route.continue();});
 await dialog.getByRole('button',{name:'Удалить',exact:true}).evaluate(b=>{(b as HTMLButtonElement).click();(b as HTMLButtonElement).click();});await seen;await expect(page.locator(`[data-task-id="${id}"]`)).toHaveCount(1);expect(fixture('snapshot').retired).toEqual([]);await dialog.getByRole('button',{name:'Отмена',exact:true}).click();
 await page.locator('[data-task-id="00000000-0000-4000-8000-000000000001"]').click();await expect(page.getByRole('dialog').getByRole('button',{name:'Удалить',exact:true})).toBeEnabled();await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();release();await expect(page.locator(`[data-task-id="${id}"]`)).toHaveCount(0);expect(deletes).toBe(1);expect(fixture('snapshot').tasks).toHaveLength(29);
});

test('independent edit draft survives confirmed deletion',async({page})=>{
 await board(page);await page.locator(`[data-task-id="${id}"]`).click();await page.getByRole('dialog').getByRole('button',{name:'Редактировать',exact:true}).click();let dialog=page.getByRole('dialog');await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Сохранённый черновик');await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await dialog.getByRole('button',{name:'Сохранить черновик и закрыть',exact:true}).click();
 dialog=await confirm(page);await dialog.getByRole('button',{name:'Удалить',exact:true}).click();await expect(dialog).toHaveCount(0);await page.getByRole('button',{name:'Продолжить редактирование: Сохранённый черновик',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('Название (обязательно)',{exact:true})).toHaveValue('Сохранённый черновик');expect(fixture('snapshot').retired).toContain(id);
});

test('lost POST -> delete in second tab -> new server -> explicit original POST is retired, draft preserved',async({page,context})=>{
 fixture('empty');await page.goto('/');await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();await expect(page.getByText('Создайте первую задачу')).toBeVisible();await page.getByRole('button',{name:'Создать задачу',exact:true}).click();const create=page.getByRole('dialog',{name:'Создание задачи'});await create.getByLabel('Название (обязательно)',{exact:true}).fill('Исходное намерение');
 const bodies:string[]=[];let freshId='';
 await page.route('**/api/tasks',async route=>{if(route.request().method()==='POST'){bodies.push(route.request().postData()!);freshId=route.request().postDataJSON().id;if(bodies.length===1){await route.fetch();await route.abort('failed');}else await route.continue();}else await route.continue();});
 await create.getByRole('button',{name:'Создать',exact:true}).click();await expect(create.getByRole('region',{name:'Сведения на сервере'})).toBeVisible();await create.getByLabel('Название (обязательно)',{exact:true}).fill('Отдельный новый черновик');
 const other=await context.newPage();await other.goto('/');await expect(other.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();await expect(other.locator('[data-task-id]')).toHaveCount(1);const deletion=await confirm(other,freshId);await deletion.getByRole('button',{name:'Удалить',exact:true}).click();await expect(deletion).toHaveCount(0);
 fixture('restart');await create.getByRole('button',{name:'Сверить состояние',exact:true}).click();await expect(create.getByRole('button',{name:'Повторить исходную отправку',exact:true})).toBeVisible();await create.getByRole('button',{name:'Повторить исходную отправку',exact:true}).click();await expect(create.getByText('Старое намерение завершено.',{exact:false})).toBeVisible();
 expect(bodies).toHaveLength(2);expect(bodies[1]).toBe(bodies[0]);await expect(create.getByLabel('Название (обязательно)',{exact:true})).toHaveValue('Отдельный новый черновик');expect(fixture('snapshot')).toEqual({tasks:[],retired:[freshId]});await other.close();
});

test('cancel after conflict releases delete guard and leaves current task untouched',async({page,request})=>{
 await board(page);const dialog=await confirm(page);await request.patch('/api/tasks/'+id,{data:{version:1,title:'Сохранить актуальную'}});await dialog.getByRole('button',{name:'Удалить',exact:true}).click();await expect(dialog.getByRole('button',{name:'Подтвердить удаление заново',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Отмена',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(fixture('snapshot').retired).toEqual([]);await expect(page.getByRole('button',{name:'Переместить задачу: Сохранить актуальную',exact:true})).toBeEnabled();await page.locator(`[data-task-id="${id}"]`).click();await expect(page.getByRole('dialog').getByRole('button',{name:'Редактировать',exact:true})).toBeEnabled();
});

test('maximum version can be deleted and empty column receives focus',async({page,request})=>{
 fixture('empty');await request.post('/api/tasks',{data:{id,title:'Единственная'}});fixture('max_first');await page.goto('/');await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();await expect(page.locator('[data-task-id]')).toHaveCount(1);const dialog=await confirm(page);await dialog.getByRole('button',{name:'Удалить',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.locator('[data-status="todo"] h2')).toBeFocused();expect(fixture('snapshot')).toEqual({tasks:[],retired:[id]});
});

for(const width of [390,1440])for(const dark of [false,true])test(`delete accessibility ${width} dark=${dark}`,async({browser},info)=>{
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:width===390});const page=await context.newPage();await page.addInitScript(d=>localStorage.setItem('taskflow-theme',d?'dark':'light'),dark);await board(page);
 const card=page.locator(`[data-task-id="${id}"]`);if(width===390)await card.tap();else{await card.focus();await page.keyboard.press('Enter');}
 const view=page.getByRole('dialog'),button=view.getByRole('button',{name:'Удалить',exact:true});if(width===390)await button.tap();else{await button.focus();await page.keyboard.press('Enter');}
 const dialog=page.getByRole('dialog',{name:'Удаление задачи'});await expect(dialog.getByRole('button',{name:'Отмена',exact:true})).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(dialog.getByRole('button',{name:'Закрыть',exact:true})).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(dialog.getByRole('button',{name:'Удалить',exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(dialog.getByRole('button',{name:'Закрыть',exact:true})).toBeFocused();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('delete.png')});
 await page.keyboard.press('Escape');await expect(card).toBeFocused();expect(fixture('snapshot').tasks).toHaveLength(30);await context.close();
});
