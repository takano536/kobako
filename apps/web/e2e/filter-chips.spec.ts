import { randomUUID } from 'node:crypto';

import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  DEFAULT_HOUSEHOLD_ID,
  assertSafeTestDatabaseTarget,
  createDatabaseClient,
  currentTokyoMonth,
  initializeDefaultLedger,
  verifySafeTestDatabaseConnection,
  type DatabaseClient,
} from '@kobako/db';

const month = currentTokyoMonth();
const accountName = `チップテスト口座-${randomUUID().slice(0, 8)}`;
let databaseClient: DatabaseClient | undefined;
let accountId = 0;
let expenseCategoryId = 0;

function filterChip(page: Page, kind: string): Locator {
  return page.locator(`[data-slot="filter-chip"][data-filter="${kind}"]`);
}
async function activate(locator: Locator, isMobile: boolean): Promise<void> {
  if (isMobile) await locator.tap();
  else await locator.click();
}

test.describe.configure({ mode: 'serial' });

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
    const accounts = await databaseClient.sql<{ id: number }[]>`
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
    accountId = Number(accounts[0]?.id);
    const categories = await databaseClient.sql<{ id: number }[]>`
      select id
      from categories
      where household_id = ${DEFAULT_HOUSEHOLD_ID} and type = 'expense' and name = '食費'
      limit 1
    `;
    expenseCategoryId = Number(categories[0]?.id);
    if (!accountId || !expenseCategoryId) throw new Error('filter chip fixtures were not created');
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

test('combines chips and clears every filter while retaining the month', async ({
  page,
  isMobile,
}) => {
  await page.goto(`/transactions?month=${month}`);
  const typeChip = filterChip(page, 'type');
  await activate(typeChip.getByRole('button', { name: '種別', exact: true }), isMobile);
  await activate(
    page
      .getByRole('menu', { name: '種別' })
      .getByRole('menuitemradio', { name: '支出', exact: true }),
    isMobile,
  );

  const origin = page.locator('[data-slot="filter-chip"][data-filter="origin"]');
  await activate(origin, isMobile);
  const accountChip = filterChip(page, 'account');
  const accountTrigger = accountChip.getByRole('button', { name: '資産', exact: true });
  await activate(accountTrigger, isMobile);
  const accountItem = page
    .getByRole('menu', { name: '資産' })
    .getByRole('menuitemradio', { name: new RegExp(`^${accountName}\\s`) });
  await expect(accountItem).toBeVisible();
  await activate(accountItem, isMobile);

  await expect(page.getByRole('heading', { name: '条件に合う記録がありません' })).toBeVisible();
  await expect(page.locator('[data-slot="filter-clear"]')).toBeVisible();
  await activate(page.locator('[data-slot="filter-clear"]'), isMobile);
  await expect(page).toHaveURL(`/transactions?month=${month}`);
});

test('shows the active asset chip and clears only that asset filter', async ({
  page,
  isMobile,
}) => {
  await page.goto(`/transactions?month=${month}&account=${accountId}`);
  const accountChip = filterChip(page, 'account');
  await expect(accountChip).toHaveAttribute('data-active', 'true');
  await expect(
    accountChip.getByRole('button', { name: `資産 ${accountName}`, exact: true }),
  ).toBeVisible();
  await activate(
    accountChip.getByRole('button', { name: '資産の条件を外す', exact: true }),
    isMobile,
  );
  await expect(page).toHaveURL(`/transactions?month=${month}`);
});

test('supports keyboard menu selection and focus restoration', async ({ page, isMobile }) => {
  await page.goto(`/transactions?month=${month}`);
  const trigger = filterChip(page, 'type').getByRole('button', { name: '種別', exact: true });
  await trigger.focus();
  await trigger.press('Enter');
  const menu = page.getByRole('menu', { name: '種別' });
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('menuitemradio').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(
    (url) => url.searchParams.get('month') === month && url.searchParams.get('type') === 'expense',
  );
  await expect(
    filterChip(page, 'type').getByRole('button', { name: '種別 支出', exact: true }),
  ).toBeFocused();

  await page.keyboard.press('Enter');
  const unchangedUrl = page.url();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(unchangedUrl);
  await expect(menu).toHaveCount(0);
  await expect(
    filterChip(page, 'type').getByRole('button', { name: '種別 支出', exact: true }),
  ).toBeFocused();

  await filterChip(page, 'type')
    .getByRole('button', { name: '種別 支出', exact: true })
    .press('Enter');
  await activate(page.getByRole('heading', { level: 1, name: /取引/ }), isMobile);
  await expect(menu).toHaveCount(0);
});

test('keeps the chip row compact on a narrow viewport', async ({ page, isMobile }) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto(
    `/transactions?month=${month}&type=expense&category=${expenseCategoryId}&account=${accountId}&origin=api`,
  );
  const row = page.locator('[data-slot="filter-chips"]');
  const chips = row.locator('[data-slot="filter-chip"]');
  await expect(chips).toHaveCount(4);
  const metrics = await chips.evaluateAll((elements) => {
    const rects = elements.map((element) => element.getBoundingClientRect());
    return {
      heights: rects.map((rect) => rect.height),
      lines: new Set(rects.map((rect) => Math.round(rect.top))).size,
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(metrics.heights.every((height) => height >= 36)).toBe(true);
  expect(metrics.lines).toBeLessThanOrEqual(2);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth);

  await activate(row.locator('[data-slot="filter-chip-trigger"]').first(), isMobile);
  await expect(page.getByRole('menu', { name: '種別' })).toBeVisible();
  const openMetrics = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(openMetrics.scrollWidth).toBeLessThanOrEqual(openMetrics.viewportWidth);
});

test('disables the category chip for transfer filters', async ({ page }) => {
  await page.goto(`/transactions?month=${month}&type=transfer`);
  const categoryTrigger = filterChip(page, 'category').getByRole('button', { name: 'カテゴリ' });
  await expect(categoryTrigger).toBeDisabled();
  await expect(categoryTrigger).toHaveAccessibleDescription('振替にはカテゴリがありません');
});
