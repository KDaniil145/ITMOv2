import { test as base, expect } from '@playwright/test';

// Future Kanban E2E must import this fixture. Health alone is not task readiness.
export const test = base.extend<{ tasksReady: void }>({
  tasksReady: [async ({ request }, use) => {
    const response = await request.get('/api/tasks');
    expect(response.status(), 'Task API must be ready; health is insufficient').toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.total).toBe(body.items.length);
    await use();
  }, { auto: true }],
});
export { expect };
