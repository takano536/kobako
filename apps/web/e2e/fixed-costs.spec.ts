import { expect, test } from '@playwright/test';

test.describe('固定費', () => {
  test('一覧に代表的な固定費と集計を表示する', async ({ page }) => {
    await page.goto('/fixed-costs');
    await expect(page.getByRole('heading', { name: /^固定費\d+件$/ })).toBeVisible();
    await expect(page.getByText('月あたり')).toBeVisible();
    await expect(page.getByText('112,460円')).toBeVisible();
    await expect(page.getByText('年間')).toBeVisible();
    await expect(page.getByText('1,349,516円')).toBeVisible();
    await expect(page.getByText('家賃')).toBeVisible();
    await expect(page.getByText('Amazon Prime')).toBeVisible();
  });

  test('登録・編集・削除、絞り込み、グルーピングを保持する', async ({ page }) => {
    await page.goto('/fixed-costs');
    await page.getByRole('link', { name: '固定費を登録' }).click();
    await page.getByLabel('名称').fill('E2E固定費');
    await page.getByLabel('金額（円）').fill('1234');
    await page.getByLabel('カテゴリ').selectOption({ label: '娯楽' });
    await page.getByLabel('資産').selectOption({ label: '生活費口座' });
    await page.getByLabel('開始月').fill('2026-01');
    await page.getByLabel('発生日').fill('20');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page).toHaveURL(/\/fixed-costs$/);
    await expect(page.getByRole('link', { name: /E2E固定費/ }).first()).toBeVisible();

    await page.getByRole('link', { name: /E2E固定費/ }).click();
    await page.getByLabel('金額（円）').fill('4321');
    await page.getByRole('button', { name: '保存する' }).click();
    await expect(page).toHaveURL(/\/fixed-costs$/);
    await expect(page.getByText('4,321円')).toBeVisible();

    await page.getByRole('button', { name: '頻度', exact: true }).click();
    await page.getByRole('menuitemradio', { name: '1年ごと' }).click();
    await expect(page.getByText('Amazon Prime')).toBeVisible();
    await expect(page.getByText('E2E固定費')).not.toBeVisible();
    await page.getByRole('button', { name: '条件をクリア' }).click();
    await page.getByRole('button', { name: 'グループ', exact: true }).click();
    await page.getByRole('menuitemradio', { name: '頻度別' }).click();
    await expect(page.getByRole('button', { name: /グループ: 頻度別/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('kobako-fixed-cost-group')))
      .toBe('frequency');
    await page.reload();
    await expect(page.getByRole('button', { name: /グループ: 頻度別/ })).toBeVisible();

    await page.getByRole('button', { name: 'カテゴリ', exact: true }).click();
    await page.getByRole('menuitemradio', { name: '娯楽' }).click();
    await expect(page.getByText('Netflix')).toBeVisible();
    await expect(page.getByText('家賃')).not.toBeVisible();
    await page.getByRole('button', { name: /カテゴリ: 娯楽/ }).click();
    await page.getByRole('menuitemradio', { name: 'すべて' }).click();
    await page.getByRole('link', { name: /E2E固定費/ }).click();
    await page.getByRole('button', { name: '削除' }).click();
    await expect(page).toHaveURL(/\/fixed-costs$/);
    await expect(page.getByText('E2E固定費')).not.toBeVisible();
  });

  test('モバイル幅で横 overflow を発生させない', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/fixed-costs');
    await expect(page.getByRole('heading', { name: /^固定費\d+件$/ })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
