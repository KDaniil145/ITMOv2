import { test, expect } from '@playwright/test';
import { validateInput, decodeTask, decodeTaskList } from '../../src/features/kanban/validation';

const id = '8b28fe8b-7a58-4c84-a733-1135f31237fe';
const task = { id, title: 'Задача', description: '', status: 'todo', priority: 'medium', due_date: null,
  created_at: '0001-01-01T00:00:00.000001Z', updated_at: '0001-01-01T00:00:00.000002Z', version: 2 };
const ws = '\u0009\u000a\u000b\u000c\u000d\u0020\u0085\u00a0\u1680' +
  Array.from({ length: 11 }, (_, i) => String.fromCodePoint(0x2000 + i)).join('') + '\u2028\u2029\u202f\u205f\u3000';

test('defaults, exact trim, codepoints and omission agree with backend', () => {
  expect(validateInput('create', { id, title: ws + 'e\u0301 😀' + ws })).toEqual({ id, title: 'e\u0301 😀',
    description: '', status: 'todo', priority: 'medium', due_date: null });
  expect(validateInput('patch', { version: 1, due_date: null })).toEqual({ version: 1, due_date: null });
  expect(validateInput('patch', { version: 1, description: '' })).toEqual({ version: 1, description: '' });
  expect(validateInput('create', { id, title: '\ufeffA  e\u0301' }).title).toBe('\ufeffA  e\u0301');
  expect(validateInput('create', { id, title: '😀'.repeat(200), description: '😀'.repeat(5000) }).title).toBe('😀'.repeat(200));
});

for (const [field, value, code] of [
  ['title', '', 'invalid_length'], ['title', '😀'.repeat(201), 'invalid_length'],
  ['title', '\ud800' + 'x'.repeat(201), 'invalid_unicode'], ['title', 'x'.repeat(201) + '\tY', 'invalid_length'],
  ['title', 'x\ty', 'invalid_characters'], ['description', '\x00', 'invalid_characters'],
  ['description', 'x'.repeat(5001), 'invalid_length'], ['description', '\udfff', 'invalid_unicode'],
  ['title', null, 'invalid_type'], ['priority', 'Medium', 'invalid_value'], ['status', 'TODO', 'invalid_value'],
  ['due_date', '', 'invalid_date'], ['due_date', '0000-01-01', 'invalid_date'],
  ['due_date', '2025-02-29', 'invalid_date'], ['due_date', '1900-02-29', 'invalid_date'],
  ['due_date', '2024-2-01', 'invalid_date'], ['due_date', '２０２４-01-01', 'invalid_date'],
  ['due_date', '2024-01-01T00:00:00Z', 'invalid_date'], ['due_date', '\ud800', 'invalid_unicode'],
  ['id', id.toUpperCase(), 'invalid_format'], ['id', id.replace('-4c84', '-1c84'), 'invalid_format'],
  ['id', id.replace('-a733', '-7733'), 'invalid_format'], ['version', null, 'read_only'],
  ['unknown', null, 'unknown_field'],
] as const) {
  test(`create rejects ${field}/${code}/${String(value).slice(0, 20)}`, () => {
    try { validateInput('create', { id, title: 'x', [field]: value }); throw new Error('accepted invalid input'); }
    catch (error) { expect(error).toMatchObject({ details: expect.arrayContaining([expect.objectContaining({ field, code })]) }); }
  });
}
for (const field of ['title', 'description', 'status', 'priority', 'due_date', 'id']) {
  test(`strict JSON types for ${field}`, () => {
    for (const value of [true, 7, 1.5, [], {}]) expect(() => validateInput('create', { id, title: 'x', [field]: value })).toThrow();
  });
}
for (const date of ['0001-01-01', '9999-12-31', '2000-02-29', '2024-02-29', '1900-02-28']) {
  test(`calendar accepts ${date} without JS Date conversion`, () => {
    expect(validateInput('create', { id, title: 'x', due_date: date }).due_date).toBe(date);
  });
}
for (const [data, details] of [
  [{}, [{ field: 'version', code: 'missing' }]],
  [{ version: 'abc' }, [{ field: 'version', code: 'invalid_type' }]],
  [{ version: 1 }, [{ field: '$', code: 'empty_update' }]],
  [{ version: 1, id: null }, [{ field: 'id', code: 'read_only' }]],
  [{ version: 1, unknown: 123 }, [{ field: 'unknown', code: 'unknown_field' }]],
] as const) {
  test(`PATCH error priority ${JSON.stringify(data)}`, () => {
    try { validateInput('patch', data); throw new Error('accepted invalid patch'); }
    catch (error) { expect(error).toMatchObject({ details }); }
  });
}

test('strict safe versions and controls match backend', () => {
  for (const version of [true, 1.1, '1', null, 0, -1, 9007199254740992]) {
    expect(() => validateInput('patch', { version, title: 'x' })).toThrow();
  }
  for (const version of [1, 9007199254740991]) expect(validateInput('patch', { version, title: 'x' }).version).toBe(version);
  for (let c = 0; c <= 127; c++) if (c < 32 || c === 127) {
    const control = String.fromCharCode(c);
    expect(() => validateInput('create', { id, title: 'x' + control + 'x' })).toThrow();
    if ('\t\r\n'.includes(control)) expect(validateInput('create', { id, title: 'x', description: control }).description).toBe(control);
    else expect(() => validateInput('create', { id, title: 'x', description: control })).toThrow();
  }
});

test('Task decoder requires all nine fields and preserves microseconds', () => {
  expect(decodeTask(task)).toEqual(task);
  for (const field of Object.keys(task)) {
    const incomplete: Record<string, unknown> = { ...task }; delete incomplete[field];
    expect(() => decodeTask(incomplete)).toThrow();
  }
  for (const bad of [null, [], { ...task, extra: 1 }, { ...task, version: true }, { ...task, due_date: '' },
    { ...task, title: ' x ' }, { ...task, created_at: '2024-01-01T00:00:00.123Z' },
    { ...task, created_at: '2024-02-30T00:00:00.123456Z' },
    { ...task, created_at: '2024-01-01T00:00:00.123456+00:00' },
    { ...task, updated_at: '0001-01-01T00:00:00.000000Z' }]) expect(() => decodeTask(bad)).toThrow();
  expect(decodeTask({ ...task, created_at: '9999-12-31T23:59:59.999998Z', updated_at: '9999-12-31T23:59:59.999999Z' }).created_at).toContain('999998');
});

test('list decoder never filters invalid cards or truncates timestamp precision', () => {
  const second = { ...task, id: id.replace('37fe', '37ff'), created_at: task.updated_at };
  const list = { items: [task, second], total: 2 };
  expect(decodeTaskList(list)).toEqual(list);
  expect(decodeTaskList({ items: [], total: 0 })).toEqual({ items: [], total: 0 });
  for (const bad of [{ ...list, total: 1 }, { ...list, total: '2' }, { ...list, items: [task, {}] },
    { items: [task, task], total: 2 }, { items: [second, task], total: 2 }]) expect(() => decodeTaskList(bad)).toThrow();
});

test('calendar, UUID and UTC formats reject trailing newline and invalid clock', () => {
  for (const input of [{id:id+'\n',title:'x'},{id,title:'x',due_date:'2024-01-01\n'}]) expect(()=>validateInput('create',input)).toThrow();
  for (const time of ['2024-01-01T24:00:00.000001Z','2024-01-01T00:60:00.000001Z','2024-01-01T00:00:00.000001Z\n']) expect(()=>decodeTask({...task,created_at:time})).toThrow();
});
