import { test, expect } from './fixtures';
import { fixture } from '../support/backend.mjs';

test.beforeEach(() => { fixture('seed'); });
test.afterEach(() => { fixture('restore'); });
async function board(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();
}

test('real SQLite: 30 tasks, columns/counts, full GET, safe text, focus and reload order',async ({page,request}) => {
  await board(page);
  await expect(page.locator('[data-task-id]')).toHaveCount(30);
  for(const status of ['todo','in_progress','done']) await expect(page.locator(`[data-status="${status}"] .column-count`)).toHaveText('10');
  const before=await page.locator('[data-status="todo"] [data-task-id]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-task-id')));
  const response=await request.get('/api/tasks');
  const list=await response.json();
  expect(before).toEqual(list.items.filter((t:{status:string})=>t.status==='todo').map((t:{id:string})=>t.id));
  const first=page.getByRole('button',{name:'Открыть задачу: Задача 00',exact:true});
  await expect(first.getByText('Описание сокращено · Открыть полностью')).toBeVisible();
  await first.focus(); await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('heading',{name:'Задача 00'})).toBeVisible();
  await expect(dialog.getByText('Полный текст',{exact:false})).toContainText('длинное описание 😀');
  await page.keyboard.press('Escape'); await expect(first).toBeFocused();
  await page.getByRole('button',{name:'Открыть задачу: Задача 01',exact:true}).click();
  await expect(dialog.getByText('<img src=x onerror="window.injected=true">',{exact:true})).toBeVisible();
  expect(await dialog.locator('img').count()).toBe(0);
  await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.reload(); await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();
  await expect(page.locator('[data-task-id]')).toHaveCount(30);
  expect(await page.locator('[data-status="todo"] [data-task-id]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-task-id')))).toEqual(before);
});

test('loading is not empty, then a confirmed empty real database is shown',async ({page}) => {
  fixture('empty');
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/tasks',async route=>{ await gate; await route.continue(); });
  await board(page);
  await expect(page.getByText('Загружаем задачи')).toBeVisible();
  await expect(page.getByText('Создайте первую задачу')).toHaveCount(0);
  release();
  await expect(page.getByText('Создайте первую задачу')).toBeVisible();
  await expect(page.getByText('Здесь пока нет задач')).toHaveCount(3);
});

test('actual SQLite failure: initial error/retry and stale snapshot/recovery, health stays available',async ({page}) => {
  fixture('corrupt');
  await board(page);
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить задачи');
  await expect(page.locator('[data-task-id]')).toHaveCount(0);
  await expect(page.getByText('API доступен',{exact:false})).toBeVisible();
  fixture('restore'); await page.getByRole('button',{name:'Повторить',exact:true}).click();
  await expect(page.locator('[data-task-id]')).toHaveCount(30);
  fixture('corrupt'); await page.getByRole('button',{name:'Обновить',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Данные могут быть устаревшими');
  await expect(page.locator('[data-task-id]')).toHaveCount(30);
  fixture('restore'); await page.getByRole('button',{name:'Повторить',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('404 full GET removes stale card and restores focus to next card',async ({page}) => {
  await board(page); await expect(page.locator('[data-task-id]')).toHaveCount(30);
  fixture('delete_first');
  await page.getByRole('button',{name:'Открыть задачу: Задача 00',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Задача уже отсутствует');
  await expect(page.locator('[data-task-id]')).toHaveCount(29);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Открыть задачу: Задача 03',exact:true})).toBeFocused();
});

test('invalid Task is rejected as a whole snapshot, never silently filtered',async ({page}) => {
  await board(page); await expect(page.locator('[data-task-id]')).toHaveCount(30);
  fixture('invalid_task'); await page.getByRole('button',{name:'Обновить',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('невозможно корректно отобразить');
  await expect(page.locator('[data-task-id]')).toHaveCount(30);
  fixture('seed'); await page.getByRole('button',{name:'Повторить',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for(const width of [390,1440]) for(const dark of [false,true]) {
  test(`layout, theme and keyboard at ${width}/${dark?'dark':'light'}`,async ({page},testInfo) => {
    await page.setViewportSize({width,height:900});
    await board(page); await expect(page.locator('[data-task-id]')).toHaveCount(30);
    if(dark) await page.getByRole('button',{name:'Тёмная тема',exact:false}).click();
    expect(await page.locator('html').getAttribute('data-theme')).toBe(dark?'dark':'light');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    const positions=await page.locator('[data-status]').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y};}));
    if(width===1440) expect(new Set(positions.map(p=>p.y)).size).toBe(1);
    else expect(positions[1].y).toBeGreaterThan(positions[0].y);
    const contrast=await page.locator('#board-title,.task-title,.task-description,.task-meta,.task-shortened,.column-heading h2,.column-count,.board-button').evaluateAll(nodes=>nodes.map(node=>{
      const style=getComputedStyle(node);
      let parent:Element|null=node,bg='';
      while(parent){bg=getComputedStyle(parent).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)' && bg!=='transparent')break;parent=parent.parentElement;}
      const channels=(color:string)=>color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;});
      const luminance=(color:string)=>{const [r,g,b]=channels(color);return .2126*r+.7152*g+.0722*b;};
      const a=luminance(style.color),b=luminance(bg);
      return {text:node.textContent?.slice(0,30),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),large:parseFloat(style.fontSize)>=24 || (parseFloat(style.fontSize)>=18.66 && parseInt(style.fontWeight)>=700)};
    }));
    for(const sample of contrast) expect(sample.ratio,JSON.stringify(sample)).toBeGreaterThanOrEqual(sample.large?3:4.5);
    const targets=await page.locator('.kanban button').evaluateAll(nodes=>nodes.map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));
    for(const target of targets){expect(target.w).toBeGreaterThanOrEqual(44);expect(target.h).toBeGreaterThanOrEqual(44);}
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:testInfo.outputPath('board.png'),fullPage:false});
    const first=page.locator('[data-task-id]').first();
    await first.focus(); await page.keyboard.press('Enter');
    const dialog=page.getByRole('dialog'); await expect(dialog.getByRole('button',{name:'Закрыть',exact:true})).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate(n=>n.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape'); await expect(first).toBeFocused();
    await page.reload(); expect(await page.locator('html').getAttribute('data-theme')).toBe(dark?'dark':'light');
    await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();
    await expect(page.locator('[data-task-id]')).toHaveCount(30);
  });
}

test('late real list response cannot overwrite a fresher full GET',async ({page}) => {
  await board(page); await expect(page.locator('[data-task-id]')).toHaveCount(30);
  let release!:()=>void, fetched!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const captured=new Promise<void>(resolve=>{fetched=resolve;});
  await page.route('**/api/tasks',async route=>{
    const response=await route.fetch(); // Capture the real old server snapshot.
    fetched(); await gate; await route.fulfill({response});
  },{times:1});
  await page.getByRole('button',{name:'Обновить',exact:true}).click(); await captured;
  fixture('rename_first');
  await page.getByRole('button',{name:'Открыть задачу: Задача 00',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('heading',{name:'Актуальное название'})).toBeVisible();
  release(); await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Открыть задачу: Актуальное название',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Открыть задачу: Задача 00',exact:true})).toHaveCount(0);
});

test('theme stays usable when preference storage fails',async ({page}) => {
  await page.addInitScript(()=>{
    Storage.prototype.getItem=()=>{throw new Error('unavailable');};
    Storage.prototype.setItem=()=>{throw new Error('unavailable');};
  });
  await board(page); await expect(page.locator('[data-task-id]')).toHaveCount(30);
  const before=await page.locator('html').getAttribute('data-theme');
  await page.getByRole('button',{name:'Тёмная тема',exact:false}).click();
  expect(await page.locator('html').getAttribute('data-theme')).not.toBe(before);
});

test.describe('touch mode',()=>{
  test.use({hasTouch:true,isMobile:true,viewport:{width:390,height:844}});
  test('read actions work with touch and the mobile dialog fits the viewport',async ({page},testInfo)=>{
    await page.goto('/'); await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();
    await expect(page.locator('[data-task-id]')).toHaveCount(30);
    const first=page.locator('[data-task-id]').first(); await first.tap();
    const dialog=page.getByRole('dialog');
    await expect(dialog.getByRole('heading',{name:'Задача 00'})).toBeVisible();
    const bounds=await dialog.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(358);
    expect(bounds!.height).toBeLessThanOrEqual(812);
    await page.screenshot({path:testInfo.outputPath('dialog.png')});
    await dialog.getByRole('button',{name:'Закрыть',exact:true}).tap();
    await expect(first).toBeFocused();
    await expect(page.locator('[data-task-id]')).toHaveCount(30);
  });
});

test('full GET has separate loading/error/retry states and keeps confirmed board',async ({page})=>{
  await board(page); await expect(page.locator('[data-task-id]')).toHaveCount(30);
  const id='00000000-0000-4000-8000-000000000000';
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/tasks/${id}`,async route=>{await gate;await route.continue();},{times:1});
  const first=page.getByRole('button',{name:'Открыть задачу: Задача 00',exact:true});
  await first.click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByText('Загружаем задачу',{exact:true})).toBeVisible();
  fixture('corrupt'); release();
  await expect(dialog.getByRole('alert')).toContainText('хранилище временно недоступно');
  await expect(page.locator('[data-task-id]')).toHaveCount(30);
  fixture('restore'); await dialog.getByRole('button',{name:'Повторить загрузку задачи',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Задача 00'})).toBeVisible();
  await page.keyboard.press('Escape'); await expect(first).toBeFocused();
});
