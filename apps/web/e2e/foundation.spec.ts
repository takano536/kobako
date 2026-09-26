import { expect, test } from '@playwright/test';

test('foundation page and health endpoints are available', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'kobako' })).toBeVisible();

  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({ status: 'ok' });

  const databaseHealth = await request.get('/api/health/db');
  expect(databaseHealth.ok()).toBe(true);
  expect(await databaseHealth.json()).toEqual({ status: 'ok' });
});
