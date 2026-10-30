import { test, expect } from '@playwright/test';

test('pure TypeScript runner works without browser or servers', () => {
  expect(new Set(['unit', 'e2e']).size).toBe(2);
});
