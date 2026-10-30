import {test,expect} from './fixtures';
import {fixture} from './support/backend';
test.beforeEach(()=>fixture('seed'));test.afterEach(()=>fixture('restore'));
for(const width of [390,1440])for(const dark of [false,true])test(`single-board start, theme and five reloads ${width}/${dark}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.addInitScript(()=>{requestAnimationFrame(()=>{(window as unknown as Record<string,unknown>).firstTheme=document.documentElement.dataset.theme;});});
 await page.goto('/');await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();await expect(page.locator('[data-task-id]')).toHaveCount(30);await expect(page.locator('nav')).toHaveCount(0);await expect(page.getByText('Скоро',{exact:true})).toHaveCount(0);await expect(page.getByText('Обзор',{exact:true})).toHaveCount(0);await expect(page.getByText('Календарь',{exact:true})).toHaveCount(0);await expect(page.getByText('Проекты',{exact:true})).toHaveCount(0);
 for(let i=0;i<(dark?1:2);i++)await page.getByRole('button',{name:'Тёмная тема',exact:false}).click();expect(await page.evaluate(()=>localStorage.getItem('taskflow-theme'))).toBe(dark?'dark':'light');await expect(page.getByText('API доступен',{exact:false})).toBeVisible();
 for(let i=0;i<5;i++){await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme',dark?'dark':'light');await expect.poll(()=>page.evaluate(()=>(window as unknown as Record<string,unknown>).firstTheme)).toBe(dark?'dark':'light');await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();await expect(page.locator('[data-task-id]')).toHaveCount(30);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const targets=await page.locator('.kanban button:not([disabled])').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).map(n=>({name:n.getAttribute('aria-label')||n.textContent,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));for(const target of targets){expect(target.width,target.name||'target').toBeGreaterThanOrEqual(44);expect(target.height,target.name||'target').toBeGreaterThanOrEqual(44);}
 await page.screenshot({path:info.outputPath('board.png')});
});
test('theme storage unavailable still allows switching on the only screen',async({page})=>{
 await page.addInitScript(()=>{const get=Storage.prototype.getItem,set=Storage.prototype.setItem;Storage.prototype.getItem=function(key){if(key==='taskflow-theme')throw new Error('blocked');return get.call(this,key);};Storage.prototype.setItem=function(key,value){if(key==='taskflow-theme')throw new Error('blocked');return set.call(this,key,value);};});
 await page.goto('/');await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();await page.getByRole('button',{name:'Тёмная тема',exact:false}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(page.locator('[data-task-id]')).toHaveCount(30);
});

test('conflict checkbox targets meet 44px minimum and visible form text meets contrast',async({page},info)=>{
 await page.goto('/');await expect(page.getByRole('heading',{name:'Доска задач',exact:true})).toBeVisible();await page.locator('[data-task-id="00000000-0000-4000-8000-000000000000"]').click();await page.getByRole('dialog').getByRole('button',{name:'Редактировать',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Название (обязательно)',{exact:true}).fill('Моё');fixture('rename_first');await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(dialog.getByRole('region',{name:'Сравнение изменений'})).toBeVisible();
 const box=await dialog.getByLabel('Применить: Название (обязательно)',{exact:true}).evaluate(node=>{const target=node.closest('label')!;const r=target.getBoundingClientRect();return {width:r.width,height:r.height};});expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
 // Measure actual CSS colours on controls and hints; this is not a screen reader test.
 for(const theme of ['light','dark']){
  await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  const ratios=await dialog.locator('button, input:not([type="checkbox"]),select,textarea,.field-hint,.edit-difference p').evaluateAll(nodes=>{
   const rgb=(s:string)=>s.match(/[\d.]+/g)!.slice(0,3).map(Number);
   const lum=(c:number[])=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
   return nodes.filter(n=>n.getClientRects().length).map(n=>{const style=getComputedStyle(n);let parent:Element|null=n,bg='';while(parent){const c=getComputedStyle(parent).backgroundColor;if(c!=='rgba(0, 0, 0, 0)'&&c!=='transparent'){bg=c;break;}parent=parent.parentElement;}const [a,b]=[lum(rgb(style.color)),lum(rgb(bg))].sort((x,y)=>y-x);return {text:n.textContent?.slice(0,50),ratio:(a+.05)/(b+.05)};});
  });
  for(const ratio of ratios)expect(ratio.ratio,`${theme} ${ratio.text}`).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({path:info.outputPath(`conflict-${theme}.png`)});
 }
});
