import {test,expect} from './fixtures';
import {fixture} from '../support/backend.mjs';
import type {Page} from '@playwright/test';
const id='00000000-0000-4000-8000-000000000000';
test.beforeEach(()=>fixture('seed'));
test.afterEach(()=>fixture('restore'));
async function board(page:Page){await page.goto('/');await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();await expect(page.locator('[data-task-id]')).toHaveCount(30);}
async function edit(page:Page){await page.locator(`[data-task-id="${id}"]`).click();await page.getByRole('button',{name:'Редактировать',exact:true}).click();return page.getByRole('dialog',{name:'Редактирование задачи',exact:true});}
test('edits selected fields, clears date, no-op skips PATCH and reload preserves SQLite fields',async({page})=>{
 await board(page);let dialog=await edit(page);let patches=0;page.on('request',r=>{if(r.method()==='PATCH')patches++;});
 await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dialog).toHaveCount(0);expect(patches).toBe(0);
 dialog=await edit(page);await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('  Изменённая 😀  ');
 await dialog.getByLabel('Описание',{exact:true}).fill('');await dialog.getByLabel('Срок (необязательно)',{exact:true}).fill('');
 await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dialog).toHaveCount(0);
 const saved=fixture('snapshot').tasks.find(t=>t.id===id)!;expect(saved.title).toBe('Изменённая 😀');expect(saved.description).toBe('');expect(saved.due_date).toBeNull();expect(saved.version).toBe(2);expect(patches).toBe(1);
 await page.reload();await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();await expect(page.locator(`[data-task-id="${id}"]`)).toContainText('Изменённая 😀');
 expect(fixture('snapshot').tasks.find(t=>t.id===id)!.priority).toBe('low');
});

test('two tabs and a repeated conflict require explicit choices and preserve unselected server fields',async({page,context})=>{
 await board(page);const dialog=await edit(page);await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Мой заголовок');
 const other=await context.newPage();await board(other);const otherDialog=await edit(other);
 await otherDialog.getByLabel('Описание',{exact:true}).fill('Чужое описание');await otherDialog.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(otherDialog).toHaveCount(0);
 await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dialog.getByRole('region',{name:'Сравнение изменений'})).toBeVisible();
 expect(fixture('snapshot').tasks.find(t=>t.id===id)!.version).toBe(2);
 expect(fixture('snapshot').tasks.find(t=>t.id===id)!.title).toBe('Задача 00');
 // Actual second-tab PATCH after the first reconciliation causes another real 409.
 const again=await edit(other);await again.getByLabel('Приоритет',{exact:true}).selectOption('high');await again.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(again).toHaveCount(0);
 await dialog.getByLabel('Применить: Название (обязательно)',{exact:true}).check();await dialog.getByRole('button',{name:'Применить выбранные изменения',exact:true}).click();
 await expect(dialog.getByRole('region',{name:'Сравнение изменений'})).toContainText('Высокий');
 expect(fixture('snapshot').tasks.find(t=>t.id===id)!.version).toBe(3);
 await dialog.getByLabel('Применить: Название (обязательно)',{exact:true}).check();await dialog.getByRole('button',{name:'Применить выбранные изменения',exact:true}).click();await expect(dialog).toHaveCount(0);
 const task=fixture('snapshot').tasks.find(t=>t.id===id)!;expect(task.title).toBe('Мой заголовок');expect(task.description).toBe('Чужое описание');expect(task.priority).toBe('high');expect(task.version).toBe(4);
 await other.close();
});

test('dirty edit draft survives closing and viewing another task on the board',async({page})=>{
 await board(page);const dialog=await edit(page);await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Отдельный черновик');await page.keyboard.press('Escape');
 await expect(dialog.getByRole('button',{name:'Продолжить ввод',exact:true})).toBeFocused();await dialog.getByRole('button',{name:'Сохранить черновик и закрыть',exact:true}).click();
 await page.locator('[data-task-id="00000000-0000-4000-8000-000000000001"]').click();await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByRole('button',{name:'Продолжить редактирование: Отдельный черновик',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('Название (обязательно)',{exact:true})).toHaveValue('Отдельный черновик');
 expect(fixture('snapshot').tasks.find(t=>t.id===id)!.version).toBe(1);
});

test('external absence removes card and preserves draft with explicit transfer into creation only',async({page})=>{
 await board(page);const dialog=await edit(page);await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Не потерять');fixture('delete_first');
 await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dialog.getByText('Задача уже отсутствует.',{exact:false})).toBeVisible();
 await expect(page.locator(`[data-task-id="${id}"]`)).toHaveCount(0);expect(fixture('snapshot').tasks).toHaveLength(29);
 await dialog.getByRole('button',{name:'Перенести черновик в создание',exact:true}).click();const create=page.getByRole('dialog',{name:'Создание задачи'});await expect(create.getByLabel('Название (обязательно)',{exact:true})).toHaveValue('Не потерять');
 expect(fixture('snapshot').tasks).toHaveLength(29);expect(fixture('snapshot').retired).toContain(id);
});

test('lost PATCH response reconciles without automatic overwrite or claim of authorship',async({page})=>{
 await board(page);const dialog=await edit(page);let patches=0;
 await page.route(`**/api/tasks/${id}`,async route=>{if(route.request().method()==='PATCH'){patches++;const response=await route.fetch();expect(response.status()).toBe(200);await route.abort('failed');}else await route.continue();});
 await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Сохранён без ответа');await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(dialog.getByText('Состояние сверено.',{exact:false})).toBeVisible();await expect(dialog.getByRole('button',{name:'Применить выбранные изменения',exact:true})).toBeDisabled();
 expect(patches).toBe(1);expect(fixture('snapshot').tasks.find(t=>t.id===id)!.version).toBe(2);
 await dialog.getByRole('button',{name:'Принять актуальные данные',exact:true}).click();await expect(dialog).toHaveCount(0);expect(patches).toBe(1);
});

test('failed GET after lost PATCH blocks writes and keeps draft until explicit reconciliation',async({page})=>{
 await board(page);const dialog=await edit(page);let patches=0;
 await page.route(`**/api/tasks/${id}`,async route=>{if(route.request().method()==='PATCH'){patches++;await route.fetch();fixture('corrupt');await route.abort('failed');}else await route.continue();});
 await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Черновик при отказе');await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(dialog.getByText('Сверка не удалась.',{exact:false})).toBeVisible();await expect(dialog.getByRole('button',{name:'Сохранить',exact:true})).toHaveCount(0);await expect(dialog.getByLabel('Название (обязательно)',{exact:true})).toHaveValue('Черновик при отказе');
 fixture('restore');await dialog.getByRole('button',{name:'Повторить сверку',exact:true}).click();await expect(dialog.getByRole('region',{name:'Сравнение изменений'})).toBeVisible();expect(patches).toBe(1);expect(fixture('snapshot').tasks.find(t=>t.id===id)!.title).toBe('Черновик при отказе');
});

test('maximum version rejects real edit without retry but allows local no-op and read',async({page})=>{
 fixture('almost_max_first');await board(page);let dialog=await edit(page);await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Последнее изменение');await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dialog).toHaveCount(0);expect(fixture('snapshot').tasks.find(t=>t.id===id)!.version).toBe(9007199254740991);
 dialog=await edit(page);await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dialog).toHaveCount(0);
 dialog=await edit(page);await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Недоступное изменение');let patches=0;page.on('request',r=>{if(r.method()==='PATCH')patches++;});await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(dialog.getByText('Достигнут предел версии задачи. Изменения не сохранены',{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Сохранить',exact:true})).toHaveCount(0);expect(patches).toBe(1);expect(fixture('snapshot').tasks.find(t=>t.id===id)!.title).toBe('Последнее изменение');
});

test('late list cannot overwrite acknowledged PATCH and failed refresh retains confirmed change',async({page})=>{
 await board(page);const dialog=await edit(page);
 let release!:()=>void,seen!:()=>void;const gate=new Promise<void>(r=>release=r),captured=new Promise<void>(r=>seen=r);
 await page.route('**/api/tasks',async route=>{const response=await route.fetch();seen();await gate;await route.fulfill({response});});
 // Trigger list while dialog is closed, then resume the same draft.
 await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByRole('button',{name:'Обновить',exact:true}).click();await captured;
 await page.getByRole('button',{name:'Продолжить редактирование: Задача 00',exact:true}).click();const resumed=page.getByRole('dialog',{name:'Редактирование задачи'});
 await page.route('**/api/tasks',async route=>{await route.abort('failed');});
 await resumed.getByLabel('Название (обязательно)',{exact:true}).fill('Новее старого GET');await resumed.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(resumed).toHaveCount(0);release();
 await expect(page.locator(`[data-task-id="${id}"]`)).toContainText('Новее старого GET');await expect(page.getByRole('alert')).toContainText('устаревшими');expect(fixture('snapshot').tasks.find(t=>t.id===id)!.version).toBe(2);
});

for(const width of [390,1440])for(const dark of [false,true])test(`edit accessibility ${width} dark=${dark}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.addInitScript(d=>localStorage.setItem('taskflow-theme',d?'dark':'light'),dark);
 await board(page);const dialog=await edit(page);await expect(dialog.getByLabel('Название (обязательно)',{exact:true})).toBeFocused();
 await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('😀'.repeat(201));await dialog.getByLabel('Срок (необязательно)',{exact:true}).fill('2025-02-29');await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(dialog.getByLabel('Название (обязательно)',{exact:true})).toBeFocused();await expect(dialog.getByLabel('Срок (необязательно)',{exact:true})).toHaveAttribute('aria-invalid','true');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('edit.png')});
 await page.keyboard.press('Escape');await dialog.getByRole('button',{name:'Отбросить черновик',exact:true}).click();await expect(page.locator(`[data-task-id="${id}"]`)).toBeFocused();
 expect(fixture('snapshot').tasks.find(t=>t.id===id)!.version).toBe(1);
});

test('local midnight refreshes overdue without a write; done suppresses it',async({page,request})=>{
 await page.clock.install({time:new Date('2026-10-30T20:59:50Z')});
 await request.patch('/api/tasks/'+id,{data:{version:1,due_date:'2026-10-30'}});
 await board(page);const card=page.locator(`[data-task-id="${id}"]`);
 // Test uses the browser's actual timezone rather than assuming the host timezone.
 const day=await page.evaluate(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});
 const task=fixture('snapshot').tasks.find(t=>t.id===id)!;
 if(day==='2026-10-30')await expect(card.getByText('Просрочено',{exact:true})).toHaveCount(0);
 const tomorrow=await page.evaluate(()=>{const d=new Date();d.setHours(24,0,1,0);return d.getTime();});
 await page.clock.fastForward(tomorrow- await page.evaluate(()=>Date.now()));await expect(card.getByText('Просрочено',{exact:true})).toBeVisible();
 const before=fixture('snapshot').tasks.find(t=>t.id===id)!;expect(before.version).toBe(task.version);
 await request.patch('/api/tasks/'+id,{data:{version:before.version,status:'done'}});await page.getByRole('button',{name:'Обновить',exact:true}).click();await expect(page.locator(`[data-task-id="${id}"]`).getByText('Просрочено',{exact:true})).toHaveCount(0);
});

test('visibility and focus recheck changed timezone without changing the persisted task',async({page,context,request})=>{
 const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setTimezoneOverride',{timezoneId:'UTC'});
 await page.clock.install({time:new Date('2026-10-30T12:00:00Z')});
 await request.patch('/api/tasks/'+id,{data:{version:1,due_date:'2026-10-30'}});await board(page);
 const overdue=page.locator(`[data-task-id="${id}"]`).getByText('Просрочено',{exact:true});await expect(overdue).toHaveCount(0);
 await cdp.send('Emulation.setTimezoneOverride',{timezoneId:'Pacific/Kiritimati'});await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await expect(overdue).toBeVisible();
 await cdp.send('Emulation.setTimezoneOverride',{timezoneId:'UTC'});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(overdue).toHaveCount(0);
 await cdp.send('Emulation.setTimezoneOverride',{timezoneId:'Pacific/Kiritimati'});await page.clock.fastForward(60001);await expect(overdue).toBeVisible();
 expect(fixture('snapshot').tasks.find(t=>t.id===id)!.version).toBe(2);await cdp.detach();
});

test('pending edit blocks only its duplicate write and preserves separately changed draft',async({page})=>{
 await board(page);const dialog=await edit(page);let sent=0,release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(r=>release=r),seen=new Promise<void>(r=>entered=r);
 await page.route(`**/api/tasks/${id}`,async route=>{if(route.request().method()==='PATCH'){sent++;entered();await gate;const response=await route.fetch();await route.fulfill({response});}else await route.continue();});
 await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Первое изменение');
 await dialog.getByRole('button',{name:'Сохранить',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});await seen;
 await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Отдельный новый черновик');await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await dialog.getByRole('button',{name:'Сохранить черновик и закрыть',exact:true}).click();
 await page.locator('[data-task-id="00000000-0000-4000-8000-000000000001"]').click();await expect(page.getByRole('dialog')).toContainText('Задача 01');await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).click();expect(sent).toBe(1);expect(fixture('snapshot').tasks.find(t=>t.id===id)!.version).toBe(1);
 release();await expect(page.locator(`[data-task-id="${id}"]`)).toContainText('Первое изменение');await page.getByRole('button',{name:'Продолжить редактирование: Отдельный новый черновик',exact:true}).click();
 await expect(page.getByRole('dialog').getByLabel('Название (обязательно)',{exact:true})).toHaveValue('Отдельный новый черновик');expect(fixture('snapshot').tasks.find(t=>t.id===id)!.version).toBe(2);expect(sent).toBe(1);
});

test('edited leap date and status persist; done and return recompute overdue and focus follows card',async({page})=>{
 await board(page);let dialog=await edit(page);await dialog.getByLabel('Срок (необязательно)',{exact:true}).fill('2024-02-29');await dialog.getByLabel('Статус',{exact:true}).selectOption('done');await dialog.getByLabel('Приоритет',{exact:true}).selectOption('high');await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dialog).toHaveCount(0);
 let card=page.locator(`[data-task-id="${id}"]`);await expect(card).toBeFocused();await expect(page.locator('[data-status="done"]').locator(`[data-task-id="${id}"]`)).toBeVisible();await expect(card.getByText('Просрочено',{exact:true})).toHaveCount(0);
 await page.reload();await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();card=page.locator(`[data-task-id="${id}"]`);await expect(card).toContainText('29.02.2024');dialog=await edit(page);await dialog.getByLabel('Статус',{exact:true}).selectOption('todo');await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(card.getByText('Просрочено',{exact:true})).toBeVisible();
 const task=fixture('snapshot').tasks.find(t=>t.id===id)!;expect(task.due_date).toBe('2024-02-29');expect(task.priority).toBe('high');expect(task.version).toBe(3);expect(task.created_at).toBe('2026-10-30T00:00:00.000000Z');
});

test('real server field validation preserves edit draft and focuses first form field',async({page})=>{
 await board(page);const dialog=await edit(page);await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Сохранить мой ввод');
 await page.route(`**/api/tasks/${id}`,async route=>{if(route.request().method()==='PATCH'){const body=route.request().postDataJSON();await route.continue({postData:JSON.stringify({...body,title:'',due_date:'bad'})});}else await route.continue();});
 await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dialog.getByText('Сервер отклонил запрос.',{exact:false})).toBeVisible();await expect(dialog.getByLabel('Название (обязательно)',{exact:true})).toBeFocused();await expect(dialog.getByLabel('Название (обязательно)',{exact:true})).toHaveValue('Сохранить мой ввод');await expect(dialog.getByLabel('Срок (необязательно)',{exact:true})).toHaveAttribute('aria-invalid','true');
 expect(fixture('snapshot').tasks.find(t=>t.id===id)!.version).toBe(1);
});

test('network failure before PATCH commit requires fresh GET and an explicit chosen update',async({page})=>{
 await board(page);const dialog=await edit(page);let sent=0;
 await page.route(`**/api/tasks/${id}`,async route=>{if(route.request().method()==='PATCH'&&++sent===1)await route.abort('failed');else await route.continue();});
 await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Явное применение');await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dialog.getByRole('region',{name:'Сравнение изменений'})).toBeVisible();expect(fixture('snapshot').tasks.find(t=>t.id===id)!.version).toBe(1);expect(sent).toBe(1);
 await dialog.getByLabel('Применить: Название (обязательно)',{exact:true}).check();await dialog.getByRole('button',{name:'Применить выбранные изменения',exact:true}).click();await expect(dialog).toHaveCount(0);expect(sent).toBe(2);expect(fixture('snapshot').tasks.find(t=>t.id===id)!.title).toBe('Явное применение');expect(fixture('snapshot').tasks.find(t=>t.id===id)!.version).toBe(2);
});
