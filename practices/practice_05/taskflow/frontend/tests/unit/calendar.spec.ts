import {test,expect} from '@playwright/test';
import {isOverdue,localDay} from '../../src/features/kanban/calendar';
test('calendar comparison keeps yesterday/today/tomorrow and done semantics without UTC conversion',()=>{
 for(const [due,expected] of [['2024-02-28',true],['2024-02-29',false],['2024-03-01',false]] as const){
  expect(isOverdue({due_date:due,status:'todo'},'2024-02-29')).toBe(expected);
  expect(isOverdue({due_date:due,status:'done'},'2024-02-29')).toBe(false);
 }
 expect(isOverdue({due_date:null,status:'todo'},'2024-02-29')).toBe(false);
 expect(isOverdue({due_date:'0001-01-01',status:'in_progress'},'9999-12-31')).toBe(true);
 expect(isOverdue({due_date:'9999-12-31',status:'todo'},'9999-12-31')).toBe(false);
});
test('local day supports years below 100 without Date constructor year remapping',()=>{
 const date=new Date(0);date.setFullYear(1,0,1);date.setHours(23,59,59,0);expect(localDay(date)).toBe('0001-01-01');
 date.setFullYear(9999,11,31);expect(localDay(date)).toBe('9999-12-31');
});
