import { test, expect } from './fixtures';
import { fixture } from '../support/backend.mjs';
import { INTENT_KEY } from '../../src/features/kanban/creationIntent';
test.beforeEach(()=>{fixture('empty');});
test.afterEach(()=>{fixture('restore');});
async function board(page:import('@playwright/test').Page) {
  await page.goto('/'); await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();
  await expect(page.getByText('Создайте первую задачу')).toBeVisible();
}
async function form(page:import('@playwright/test').Page) {
  await page.getByRole('button',{name:'Создать задачу',exact:true}).click();
  return page.getByRole('dialog',{name:'Создание задачи',exact:true});
}
test('creates in every status with real POST, survives reload and has no duplicate after double submit',async ({page,request})=>{
  await board(page);
  for(const status of ['todo','in_progress','done']) {
    await expect(page.getByRole('button',{name:'Создать задачу',exact:true})).toBeEnabled();
    const dialog=await form(page);
    await expect(dialog.getByLabel('Название (обязательно)',{exact:true})).toBeFocused();
    await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('  Новая '+status+' 😀  ');
    await dialog.getByLabel('Описание',{exact:true}).fill('  Текст\n😀  ');
    await dialog.getByLabel('Статус',{exact:true}).selectOption(status);
    await dialog.getByLabel('Приоритет',{exact:true}).selectOption('high');
    await dialog.getByLabel('Срок (необязательно)',{exact:true}).fill('0001-01-01');
    await dialog.getByRole('button',{name:'Создать',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(`[data-status="${status}"]`).getByRole('button',{name:`Открыть задачу: Новая ${status} 😀`,exact:true})).toBeVisible();
  }
  const list=await (await request.get('/api/tasks')).json();
  expect(list.total).toBe(3);
  expect(fixture('snapshot').tasks).toEqual(list.items);
  expect(new Set(list.items.map((t:{id:string})=>t.id)).size).toBe(3);
  for(const task of list.items){expect(task.description).toBe('  Текст\n😀  ');expect(task.due_date).toBe('0001-01-01');expect(task.version).toBe(1);}
  await page.reload(); await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();
  await expect(page.locator('[data-task-id]')).toHaveCount(3);
});

test('client and real server validation preserve fields and focus in form order',async ({page})=>{
  await board(page); const dialog=await form(page);
  await dialog.getByLabel('Срок (необязательно)',{exact:true}).fill('2025-02-29');
  await dialog.getByRole('button',{name:'Создать',exact:true}).click();
  await expect(dialog.getByLabel('Название (обязательно)',{exact:true})).toBeFocused();
  await expect(dialog.getByLabel('Срок (необязательно)',{exact:true})).toHaveValue('2025-02-29');
  expect(fixture('snapshot').tasks).toHaveLength(0);
  await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Сохранённый черновик 😀');
  await dialog.getByLabel('Срок (необязательно)',{exact:true}).fill('2024-02-29');
  await page.route('**/api/tasks',async route=>{
    if(route.request().method()==='POST') {
      const body=route.request().postDataJSON();
      await route.continue({postData:JSON.stringify({...body,title:'',due_date:'bad'})});
    } else await route.continue();
  });
  await dialog.getByRole('button',{name:'Создать',exact:true}).click();
  await expect(dialog.getByText('Сервер отклонил запрос.',{exact:false})).toBeVisible();
  await expect(dialog.getByLabel('Название (обязательно)',{exact:true})).toBeFocused();
  await expect(dialog.getByLabel('Название (обязательно)',{exact:true})).toHaveValue('Сохранённый черновик 😀');
  expect(fixture('snapshot').tasks).toHaveLength(0);
});

test('dirty Escape and explicit discard preserve a draft while using the board',async ({page})=>{
  await board(page); let dialog=await form(page);
  await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Мой черновик');
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('button',{name:'Продолжить ввод',exact:true})).toBeFocused();
  await dialog.getByRole('button',{name:'Сохранить черновик и закрыть',exact:true}).click();
  dialog=await form(page);
  await expect(dialog.getByLabel('Название (обязательно)',{exact:true})).toHaveValue('Мой черновик');
  await dialog.getByRole('button',{name:'Отмена',exact:true}).click();
  await dialog.getByRole('button',{name:'Отбросить черновик',exact:true}).click();
  dialog=await form(page); await expect(dialog.getByLabel('Название (обязательно)',{exact:true})).toHaveValue('');
  expect(fixture('snapshot').tasks).toHaveLength(0);
});

test('lost POST reply after real commit: GET200 review, no automatic retry, resolve without duplicate',async ({page})=>{
  await board(page); const dialog=await form(page); let posts=0;
  await page.route('**/api/tasks',async route=>{
    if(route.request().method()==='POST') {posts++; await route.fetch(); await route.abort('failed');}
    else await route.continue();
  });
  await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Ответ потерян');
  await dialog.getByRole('button',{name:'Создать',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Принять задачу с сервера',exact:true})).toBeVisible();
  expect(fixture('snapshot').tasks).toHaveLength(1); expect(posts).toBe(1);
  await expect(dialog.getByRole('button',{name:'Повторить исходную отправку',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Принять задачу с сервера',exact:true}).click();
  await expect(dialog).toHaveCount(0); expect(posts).toBe(1);
  expect(await page.evaluate(key=>sessionStorage.getItem(key),INTENT_KEY)).toBeNull();
  expect(fixture('snapshot').tasks[0].title).toBe('Ответ потерян');
});

test('GET404 explicit retry uses exact original UUID/body, keeping a changed draft separate',async ({page})=>{
  await board(page); let dialog=await form(page); const bodies:string[]=[];
  await page.route('**/api/tasks',async route=>{
    if(route.request().method()==='POST') {
      bodies.push(route.request().postData()!);
      if(bodies.length===1) {await route.abort('failed');return;}
    }
    await route.continue();
  });
  await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Первоначальная задача');
  await dialog.getByRole('button',{name:'Создать',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Повторить исходную отправку',exact:true})).toBeVisible();
  expect(fixture('snapshot').tasks).toHaveLength(0);
  await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Изменённый черновик');
  await dialog.getByRole('button',{name:'Повторить исходную отправку',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
  expect(fixture('snapshot').tasks.map(t=>t.title)).toEqual(['Первоначальная задача']);
  dialog=await form(page); await expect(dialog.getByLabel('Название (обязательно)',{exact:true})).toHaveValue('Изменённый черновик');
});

test('reload restores intention but sends nothing automatically, then permits verified original retry',async ({page})=>{
  await board(page); let dialog=await form(page); const bodies:string[]=[];
  await page.route('**/api/tasks',async route=>{
    if(route.request().method()==='POST') {bodies.push(route.request().postData()!);if(bodies.length===1){await route.abort('failed');return;}}
    await route.continue();
  });
  await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Перезагрузка');
  await dialog.getByRole('button',{name:'Создать',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Повторить исходную отправку',exact:true})).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();
  await expect(page.getByText('Незавершённое создание.',{exact:false})).toBeVisible();
  expect(bodies).toHaveLength(1);
  await page.getByRole('button',{name:'Продолжить создание',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Создание задачи',exact:true});
  await expect(dialog.getByLabel('Название (обязательно)',{exact:true})).toHaveValue('Перезагрузка');
  await expect(dialog.getByRole('button',{name:'Повторить исходную отправку',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Сверить состояние',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Повторить исходную отправку',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Повторить исходную отправку',exact:true}).click();
  await expect(dialog).toHaveCount(0); expect(bodies[1]).toBe(bodies[0]);
  expect(fixture('snapshot').tasks).toHaveLength(1);
});

test('failed reconciliation blocks resend; real storage recovery allows GET review only',async ({page})=>{
  await board(page); const dialog=await form(page); let posts=0;
  await page.route('**/api/tasks',async route=>{
    if(route.request().method()==='POST'){posts++;await route.fetch();fixture('corrupt');await route.abort('failed');}
    else await route.continue();
  });
  await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Сверка недоступна');
  await dialog.getByRole('button',{name:'Создать',exact:true}).click();
  await expect(dialog.getByText('Сверка не удалась.',{exact:false})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Повторить исходную отправку',exact:true})).toHaveCount(0);
  fixture('restore'); await dialog.getByRole('button',{name:'Сверить состояние',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Принять задачу с сервера',exact:true})).toBeVisible();
  expect(posts).toBe(1); expect(fixture('snapshot').tasks).toHaveLength(1);
});

test('late original retry after fixture retirement never resurrects or invents a UUID',async ({page})=>{
  await board(page); const dialog=await form(page); const bodies:string[]=[];
  await page.route('**/api/tasks',async route=>{
    if(route.request().method()==='POST') {
      bodies.push(route.request().postData()!);
      if(bodies.length===1){await route.fetch();fixture('retire',JSON.parse(bodies[0]).id);await route.abort('failed');return;}
    }
    await route.continue();
  });
  await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Не воскрешать');
  await dialog.getByRole('button',{name:'Создать',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Повторить исходную отправку',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Повторить исходную отправку',exact:true}).click();
  await expect(dialog.getByText('Старое намерение завершено.',{exact:false})).toBeVisible();
  await expect(dialog.getByLabel('Название (обязательно)',{exact:true})).toHaveValue('Не воскрешать');
  expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
  expect(fixture('snapshot')).toMatchObject({tasks:[],retired:[JSON.parse(bodies[0]).id]});
  expect(await page.evaluate(key=>sessionStorage.getItem(key),INTENT_KEY)).toBeNull();
});

test('task_id_conflict/GET200 shows existing values without overwriting and preserves distinct draft',async ({page})=>{
  await board(page); const dialog=await form(page); let posts=0;
  await page.route('**/api/tasks',async route=>{
    if(route.request().method()==='POST'){posts++;fixture('id_conflict',route.request().postDataJSON().id);}
    await route.continue();
  });
  await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Мой замысел');
  await dialog.getByRole('button',{name:'Создать',exact:true}).click();
  await expect(dialog.getByRole('region',{name:'Сведения на сервере'}).getByText('Существующая задача',{exact:true})).toBeVisible();
  await expect(dialog.getByLabel('Название (обязательно)',{exact:true})).toHaveValue('Мой замысел');
  await dialog.getByRole('button',{name:'Принять задачу с сервера',exact:true}).click();
  expect(posts).toBe(1); expect(fixture('snapshot').tasks[0].title).toBe('Существующая задача');
  const reopened=await form(page); await expect(reopened.getByLabel('Название (обязательно)',{exact:true})).toHaveValue('Мой замысел');
});

test('session storage failure uses memory and warns while lost reply is reconciled',async ({page})=>{
  await page.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new Error('blocked');};Storage.prototype.setItem=()=>{throw new Error('blocked');};Storage.prototype.removeItem=()=>{throw new Error('blocked');};});
  await board(page); const dialog=await form(page);
  await expect(dialog.getByText('только в памяти',{exact:false})).toBeVisible();
  await page.route('**/api/tasks',async route=>{if(route.request().method()==='POST'){await route.fetch();await route.abort('failed');}else await route.continue();});
  await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Память вкладки');
  await dialog.getByRole('button',{name:'Создать',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Принять задачу с сервера',exact:true})).toBeVisible();
  expect(fixture('snapshot').tasks).toHaveLength(1);
});

test('acknowledged creation stays confirmed when following list refresh fails',async ({page})=>{
  await board(page); const dialog=await form(page); let created=false;
  await page.route('**/api/tasks',async route=>{
    if(route.request().method()==='POST'){const response=await route.fetch();created=true;await route.fulfill({response});}
    else if(created) await route.abort('failed');else await route.continue();
  });
  await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Подтверждённая');
  await dialog.getByRole('button',{name:'Создать',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Задача создана.',{exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Данные могут быть устаревшими');
  await expect(page.getByRole('button',{name:'Открыть задачу: Подтверждённая',exact:true})).toBeVisible();
  expect(fixture('snapshot').tasks.map(t=>t.title)).toEqual(['Подтверждённая']);
});

test('a second unknown reply requires a fresh GET before another original retry',async ({page})=>{
  await board(page); const dialog=await form(page); const bodies:string[]=[]; let reads=0,release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/tasks',async route=>{
    if(route.request().method()==='POST'){bodies.push(route.request().postData()!);if(bodies.length<3){await route.abort('failed');return;}}
    await route.continue();
  });
  await page.route('**/api/tasks/*',async route=>{if(route.request().method()==='GET'){reads++;if(reads===2)await gate;}await route.continue();});
  await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Повторная неизвестность');
  await dialog.getByRole('button',{name:'Создать',exact:true}).click();
  await dialog.getByRole('button',{name:'Повторить исходную отправку',exact:true}).click();
  await expect(dialog.getByText('Сверяем состояние задачи.',{exact:false})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Повторить исходную отправку',exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'Сверить состояние',exact:true})).toBeDisabled();
  expect(bodies).toHaveLength(2); expect(reads).toBe(2); expect(fixture('snapshot').tasks).toHaveLength(0);
  release(); await dialog.getByRole('button',{name:'Повторить исходную отправку',exact:true}).click();
  await expect(dialog).toHaveCount(0); expect(bodies).toHaveLength(3);
  expect(new Set(bodies).size).toBe(1); expect(fixture('snapshot').tasks).toHaveLength(1);
});

test('pending creation does not block other tasks or the board and inserts at exact order',async ({page})=>{
  fixture('seed');fixture('future_tasks');
  await page.goto('/');await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();
  await expect(page.locator('[data-task-id]')).toHaveCount(30);
  const dialog=await form(page);let delivery!:()=>void,refresh!:()=>void,committed!:()=>void,posts=0,created=false;
  const deliveryGate=new Promise<void>(resolve=>{delivery=resolve;}),refreshGate=new Promise<void>(resolve=>{refresh=resolve;}),commitGate=new Promise<void>(resolve=>{committed=resolve;});
  await page.route('**/api/tasks',async route=>{
    if(route.request().method()==='POST'){posts++;const response=await route.fetch();created=true;committed();await deliveryGate;await route.fulfill({response});}
    else if(created){await refreshGate;await route.continue();}else await route.continue();
  });
  await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('До старых карточек');
  await dialog.getByRole('button',{name:'Создать',exact:true}).click();await commitGate;
  await expect(page.locator('[data-task-id]')).toHaveCount(30);expect(fixture('snapshot').tasks).toHaveLength(31);
  await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
  await dialog.getByRole('button',{name:'Сохранить черновик и закрыть',exact:true}).click();
  await page.getByRole('button',{name:'Открыть задачу: Задача 00',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('heading',{name:'Задача 00'})).toBeVisible();await page.keyboard.press('Escape');
  await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();
  expect(posts).toBe(1);delivery();
  await expect(page.locator('[data-task-id]')).toHaveCount(31);
  await expect(page.locator('[data-status="todo"] [data-task-id]').first()).toHaveAccessibleName('Открыть задачу: До старых карточек');
  refresh();
  await expect(page.getByText('Обновляем задачи',{exact:true})).toHaveCount(0);
  expect(posts).toBe(1);
});

for(const width of [390,1440])for(const dark of [false,true]){
  test(`creation form accessibility and theme ${width}/${dark}`,async ({page},testInfo)=>{
    await page.setViewportSize({width,height:900});await board(page);
    if(dark)await page.getByRole('button',{name:'Тёмная тема',exact:false}).click();
    const dialog=await form(page);
    await expect(dialog.getByLabel('Название (обязательно)',{exact:true})).toBeFocused();
    await page.keyboard.press('Tab');await expect(dialog.getByLabel('Описание',{exact:true})).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('😀'.repeat(201));
    await dialog.getByRole('button',{name:'Создать',exact:true}).click();
    await expect(dialog.getByLabel('Название (обязательно)',{exact:true})).toBeFocused();
    await expect(dialog.getByText('Название должно содержать от 1 до 200 кодовых точек.',{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath('create.png')});
    await page.keyboard.press('Escape');await expect(dialog.getByRole('button',{name:'Продолжить ввод',exact:true})).toBeFocused();
    await dialog.getByRole('button',{name:'Отбросить черновик',exact:true}).click();
    await expect(page.getByRole('button',{name:'Создать задачу',exact:true})).toBeFocused();
    expect(fixture('snapshot').tasks).toHaveLength(0);
  });
}

test('actual POST503 stays unknown, marks snapshot stale and retries only after restored GET404',async ({page})=>{
  await board(page);const dialog=await form(page);const bodies:string[]=[];
  page.on('request',request=>{if(request.method()==='POST' && request.url().endsWith('/api/tasks'))bodies.push(request.postData()!);});
  fixture('corrupt');
  await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Не считаем 503 откатом');
  await dialog.getByRole('button',{name:'Создать',exact:true}).click();
  await expect(dialog.getByText('Сверка не удалась.',{exact:false})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Повторить исходную отправку',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
  await dialog.getByRole('button',{name:'Сохранить черновик и закрыть',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Данные могут быть устаревшими');
  fixture('restore');expect(fixture('snapshot').tasks).toHaveLength(0);
  await page.getByRole('button',{name:'Продолжить создание',exact:true}).click();
  await dialog.getByRole('button',{name:'Сверить состояние',exact:true}).click();
  await dialog.getByRole('button',{name:'Повторить исходную отправку',exact:true}).click();
  await expect(dialog).toHaveCount(0);expect(bodies).toHaveLength(2);expect(bodies[0]).toBe(bodies[1]);
  expect(fixture('snapshot').tasks).toHaveLength(1);
});
