import { expect, test } from '@playwright/test';

import { currentTokyoMonth } from '@kobako/db';

import { monthPickerPopover, openMonthPicker, pickMonthInGrid } from './month-picker';

const month = currentTokyoMonth();
const previousYear = Number(month.slice(0, 4)) - 1;
/** 1年前の3月（年を1つ戻してから選ぶ月）。 */
const target = `${previousYear}-03`;

test.describe('in-app month picker', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const calls: string[] = [];
      Object.defineProperty(window, 'showPickerCalls', { value: calls, configurable: true });
      HTMLInputElement.prototype.showPicker = function showPicker(this: HTMLInputElement) {
        calls.push(this.type);
      };
    });
    await page.goto(`/transactions?month=${month}&type=expense`);
    await page.getByText('条件を変更する', { exact: true }).click();
    // 月欄の表示ボタンはハイドレーション後の effect で現れます。
    await expect(page.locator('[data-slot="month-picker-display"]')).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    expect(await page.evaluate(() => Reflect.get(window, 'showPickerCalls'))).toEqual([]);
  });

  test('picks a month from the header grid after moving back a year', async ({
    page,
    isMobile,
  }) => {
    const headerMonth = page.locator('[data-slot="month-switcher-label"]');
    await expect(headerMonth).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(headerMonth).toHaveAttribute('aria-expanded', 'false');
    await openMonthPicker(page, headerMonth, isMobile);
    await expect(headerMonth).toHaveAttribute('aria-expanded', 'true');

    const popover = monthPickerPopover(page);
    const year = popover.locator('[data-slot="month-picker-year"]');
    await expect(year).toHaveText(`${month.slice(0, 4)}年`);
    const current = popover.locator(`[data-slot="month-picker-month"][data-value="${month}"]`);
    await expect(current).toHaveAttribute('aria-pressed', 'true');
    await expect(current).toBeFocused();
    const box = await current.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);

    const previous = popover.getByRole('button', { name: '前の年' });
    if (isMobile) await previous.tap();
    else await previous.click();
    await expect(year).toHaveText(`${previousYear}年`);
    await expect(popover.locator('[aria-pressed="true"]')).toHaveCount(0);

    await pickMonthInGrid(page, target, isMobile);
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === '/transactions' &&
        url.searchParams.get('month') === target &&
        url.searchParams.get('type') === 'expense',
    );
    await expect(headerMonth).toHaveText(`${previousYear}年3月`);
  });

  test('picks a month in the filter and submits it with the form', async ({ page, isMobile }) => {
    const display = page.locator('[data-slot="month-picker-display"]');
    const hidden = page.locator('[data-slot="filter-form"] input[type="hidden"][name="month"]');
    await expect(hidden).toHaveValue(month);
    await openMonthPicker(page, display, isMobile);
    await pickMonthInGrid(page, target, isMobile);
    await expect(display).toHaveText(`${previousYear}/03`);
    await expect(hidden).toHaveValue(target);
    await expect(page).toHaveURL((url) => url.searchParams.get('month') === month);

    const apply = page.getByRole('button', { name: '適用', exact: true });
    if (isMobile) await apply.tap();
    else await apply.click();
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get('month') === target && url.searchParams.get('type') === 'expense',
    );
  });

  test('closes on an outside tap and on Escape without picking', async ({ page, isMobile }) => {
    const headerMonth = page.locator('[data-slot="month-switcher-label"]');
    const popover = monthPickerPopover(page);
    const startUrl = page.url();

    await openMonthPicker(page, headerMonth, isMobile);
    const heading = page.locator('main h1').first();
    if (isMobile) await heading.tap();
    else await heading.click();
    await expect(popover).toHaveCount(0);
    await expect(headerMonth).toHaveAttribute('aria-expanded', 'false');

    await openMonthPicker(page, headerMonth, isMobile);
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    await expect(headerMonth).toBeFocused();

    // 表示部をもう一度押しても閉じます。
    await openMonthPicker(page, headerMonth, isMobile);
    if (isMobile) await headerMonth.tap();
    else await headerMonth.click();
    await expect(popover).toHaveCount(0);
    expect(page.url()).toBe(startUrl);
  });
});
