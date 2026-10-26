import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import {
  DEFAULT_HOUSEHOLD_ID,
  assertSafeTestDatabaseTarget,
  createDatabaseClient,
  currentTokyoMonth,
  initializeDefaultLedger,
  verifySafeTestDatabaseConnection,
  type DatabaseClient,
} from '@kobako/db';

import { monthPickerPopover, openMonthPicker, pickMonthInGrid } from './month-picker';

const month = currentTokyoMonth();
const previousYear = Number(month.slice(0, 4)) - 1;
/** 1年前の3月（年を1つ戻してから選ぶ月）。 */
const target = `${previousYear}-03`;
const accountName = `月選択テスト口座-${randomUUID().slice(0, 8)}`;

let databaseClient: DatabaseClient | undefined;
let accountId = 0;

test.describe('in-app month picker', () => {
  test.beforeAll(async () => {
    const safeTestDatabase = assertSafeTestDatabaseTarget();
    databaseClient = createDatabaseClient(safeTestDatabase.url);
    try {
      await verifySafeTestDatabaseConnection(
        databaseClient.sql,
        safeTestDatabase.target,
        process.env.DATABASE_URL,
      );
      await initializeDefaultLedger(databaseClient.db);
      const rows = await databaseClient.sql<{ id: number }[]>`
        insert into accounts (household_id, name, kind, asset_category_id)
        values (
          ${DEFAULT_HOUSEHOLD_ID},
          ${accountName},
          'bank',
          (select id from asset_categories
           where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'bank')
        )
        returning id
      `;
      accountId = Number(rows[0]?.id);
      if (!accountId) throw new Error('month picker account fixture was not created');
    } catch (error) {
      await databaseClient.close();
      databaseClient = undefined;
      throw error;
    }
  });

  test.afterAll(async () => {
    if (!databaseClient) return;
    try {
      await databaseClient.sql`delete from accounts where id = ${accountId}`;
    } finally {
      await databaseClient.close();
      databaseClient = undefined;
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const calls: string[] = [];
      Object.defineProperty(window, 'showPickerCalls', { value: calls, configurable: true });
      HTMLInputElement.prototype.showPicker = function showPicker(this: HTMLInputElement) {
        calls.push(this.type);
      };
    });
    await page.goto(`/transactions?month=${month}&type=expense`);
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

  test('toggles the header month grid once per tap on the month label', async ({
    page,
    isMobile,
  }) => {
    const headerMonth = page.locator('[data-slot="month-switcher-label"]');
    const popover = monthPickerPopover(page);
    await openMonthPicker(page, headerMonth, isMobile);
    await expect(headerMonth).toHaveAttribute('aria-expanded', 'true');
    if (isMobile) await headerMonth.tap();
    else await headerMonth.click();
    await expect(popover).toHaveCount(0);
    await expect(headerMonth).toHaveAttribute('aria-expanded', 'false');
  });

  test('offers 全期間 only for an account filter and keeps it when selected', async ({
    page,
    isMobile,
  }) => {
    const headerMonth = page.locator('[data-slot="month-switcher-label"]');
    await page.goto(`/transactions?month=${month}&account=${accountId}`);
    await openMonthPicker(page, headerMonth, isMobile);
    const popover = monthPickerPopover(page);
    const all = popover.locator('[data-slot="month-picker-all"]');
    await expect(all).toBeVisible();
    await expect(popover.locator('button').first()).toHaveAttribute(
      'data-slot',
      'month-picker-all',
    );
    if (isMobile) await all.tap();
    else await all.click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === '/transactions' &&
        url.searchParams.get('month') === 'all' &&
        url.searchParams.get('account') === String(accountId),
    );
    await expect(page.getByText('全期間', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '月で絞り込む' })).toBeVisible();

    await page.goto(`/transactions?month=${month}`);
    await openMonthPicker(page, page.locator('[data-slot="month-switcher-label"]'), isMobile);
    await expect(monthPickerPopover(page).locator('[data-slot="month-picker-all"]')).toHaveCount(0);
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
