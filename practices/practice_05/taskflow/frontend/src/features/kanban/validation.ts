import { DETAIL_CODES, ERROR_STATUS, MAX_VERSION, PRIORITIES, STATUSES, type ApiError, type DetailCode, type ErrorCode, type Task, type TaskList } from './types';
const users = ['title', 'description', 'status', 'priority', 'due_date'];
const fields = ['id', ...users, 'created_at', 'updated_at', 'version'];
const ws = '\u0009\u000a\u000b\u000c\u000d\u0020\u0085\u00a0\u1680' + Array.from({length:11}, (_,i) => String.fromCodePoint(0x2000+i)).join('') + '\u2028\u2029\u202f\u205f\u3000';
const edge = new RegExp(`^[${ws}]+|[${ws}]+$`, 'gu');
export interface InputDetail { field: string; code: DetailCode }
export class InputError extends Error {
  constructor(readonly details: InputDetail[]) { super('Проверьте поля запроса'); }
}
export class ProtocolError extends Error {
  constructor() { super('Сервер вернул некорректный ответ'); }
}
export function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }
export function isVersion(v: unknown): v is number { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= MAX_VERSION; }
export function isUuid(v: unknown): v is string { return typeof v === 'string' && v.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v); }
export function hasInvalidUnicode(v: string): boolean { return [...v].some(ch => { const c = ch.codePointAt(0)!; return c >= 0xd800 && c <= 0xdfff; }); }
export function isCalendarDate(v: unknown): v is string {
  if (typeof v !== 'string' || v.length !== 10 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)) return false;
  const [y,m,d] = v.split('-').map(Number);
  if (y < 1 || y > 9999 || m < 1 || m > 12) return false;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return d >= 1 && d <= [31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1];
}
export function isTimestamp(v: unknown): v is string {
  return typeof v === 'string' && v.length === 27 && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/.test(v) && isCalendarDate(v.slice(0,10)) && Number(v.slice(11,13)) < 24 && Number(v.slice(14,16)) < 60 && Number(v.slice(17,19)) < 60;
}
function fieldError(field: string, v: unknown): DetailCode | undefined {
  if (field === 'due_date' && v === null) return;
  if (field === 'version') return isVersion(v) ? undefined : typeof v === 'number' && Number.isInteger(v) ? 'invalid_value' : 'invalid_type';
  if (typeof v !== 'string') return 'invalid_type';
  if (hasInvalidUnicode(v)) return 'invalid_unicode';
  if (field === 'title' || field === 'description') {
    const length = [...v].length;
    if (length < (field === 'title'?1:0) || length > (field === 'title'?200:5000)) return 'invalid_length';
    for (const ch of v) if ((ch.charCodeAt(0) < 32 || ch === '\x7f') && !(field === 'description' && '\n\r\t'.includes(ch))) return 'invalid_characters';
  } else if (field === 'id' && !isUuid(v)) return 'invalid_format';
  else if (field === 'due_date' && !isCalendarDate(v)) return 'invalid_date';
  else if (field === 'status' && !STATUSES.some(item => item === v)) return 'invalid_value';
  else if (field === 'priority' && !PRIORITIES.some(item => item === v)) return 'invalid_value';
}
export function validateInput(operation: 'create' | 'patch', input: unknown): Record<string, unknown> {
  if (!isRecord(input)) throw new InputError([{field:'$',code:'invalid_type'}]);
  const details: InputDetail[] = [], data: Record<string, unknown> = {};
  const allowed = [...users, operation === 'create'?'id':'version'];
  for (const field of operation === 'create'?['id','title']:['version']) if (!Object.hasOwn(input,field)) details.push({field,code:'missing'});
  for (const [field, original] of Object.entries(input)) {
    if (!allowed.includes(field)) { details.push({field,code:fields.includes(field)?'read_only':'unknown_field'}); continue; }
    const value = field === 'title' && typeof original === 'string' && !hasInvalidUnicode(original) ? original.replace(edge,'') : original;
    const code = fieldError(field,value);
    if (code) details.push({field,code}); else data[field] = value;
  }
  if (operation === 'patch' && details.length === 0 && !users.some(field => Object.hasOwn(input,field))) details.push({field:'$',code:'empty_update'});
  if (details.length) throw new InputError(details.sort((a,b) => a.field < b.field?-1:a.field > b.field?1:a.code < b.code?-1:a.code > b.code?1:0));
  return operation === 'create'?{description:'',status:'todo',priority:'medium',due_date:null,...data}:data;
}
function exact(v: Record<string, unknown>, keys: string[]): boolean { return Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k)); }
export function decodeTask(input: unknown): Task {
  if (!isRecord(input) || !exact(input,fields)) throw new ProtocolError();
  for (const field of ['id',...users,'version']) if (fieldError(field,input[field])) throw new ProtocolError();
  if ((input.title as string).replace(edge,'') !== input.title || !isTimestamp(input.created_at) || !isTimestamp(input.updated_at) || input.updated_at < input.created_at) throw new ProtocolError();
  return {...input} as unknown as Task;
}
export function decodeTaskList(input: unknown): TaskList {
  if (!isRecord(input) || !exact(input,['items','total']) || !Array.isArray(input.items) || !Number.isSafeInteger(input.total) || input.total !== input.items.length) throw new ProtocolError();
  const items = input.items.map(decodeTask), ids = new Set<string>();
  items.forEach((task,i) => {
    if (ids.has(task.id)) throw new ProtocolError(); ids.add(task.id);
    const prev = items[i-1];
    if (prev && (prev.created_at > task.created_at || (prev.created_at === task.created_at && prev.id > task.id))) throw new ProtocolError();
  });
  return {items,total:items.length};
}
export function decodeApiError(input: unknown, status: number): ApiError {
  if (!isRecord(input) || !exact(input,['error']) || !isRecord(input.error)) throw new ProtocolError();
  const e = input.error;
  if (!exact(e,['code','message','details']) || typeof e.code !== 'string' || !Object.hasOwn(ERROR_STATUS,e.code) || ERROR_STATUS[e.code as ErrorCode] !== status || typeof e.message !== 'string' || !Array.isArray(e.details)) throw new ProtocolError();
  const details = e.details.map(d => {
    if (!isRecord(d) || !exact(d,['field','code','message']) || typeof d.field !== 'string' || typeof d.message !== 'string' || !DETAIL_CODES.some(code => code === d.code)) throw new ProtocolError();
    return {field:d.field,code:d.code as DetailCode,message:d.message};
  });
  const conflicts = {version_conflict:['version','stale_version'],task_id_conflict:['id','id_conflict'],task_id_retired:['id','retired']};
  const expected = conflicts[e.code as keyof typeof conflicts];
  if (expected ? details.length !== 1 || details[0].field !== expected[0] || details[0].code !== expected[1] : e.code !== 'validation_error' && details.length !== 0) throw new ProtocolError();
  return {code:e.code as ErrorCode,message:e.message,details};
}
