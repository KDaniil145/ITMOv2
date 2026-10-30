// Infrastructure smoke only: task endpoints do not exist in phase 1 yet.
import { test, expect } from '@playwright/test';

test('owned Vite proxies health to the owned backend', async ({ page, request }) => {
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok' });
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
});
