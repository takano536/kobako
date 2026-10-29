import { expect, test } from '@playwright/test';

test.describe('固定費', () => {
  test('一覧に代表的な固定費と集計を表示する', async ({ page }) => {
    await page.goto('/fixed-costs');
    await expect(page.getByRole('heading', { name: '固定費' })).toBeVisible();
    await expect(page.getByText('月額目安')).toBeVisible();
    await expect(page.getByText('112,460円')).toBeVisible();
    await expect(page.getByText('年額')).toBeVisible();
    await expect(page.getByText('1,349,516円')).toBeVisible();
    await expect(page.getByText('家賃')).toBeVisible();
    await expect(page.getByText('Amazon Prime')).toBeVisible();
  });
});
