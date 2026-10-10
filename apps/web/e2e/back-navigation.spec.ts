import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import {
  DEFAULT_HOUSEHOLD_ID,
  assertSafeTestDatabaseTarget,
  createDatabaseClient,
  initializeDefaultLedger,
  verifySafeTestDatabaseConnection,
  type DatabaseClient,
} from '@kobako/db';
import { chooseEmptyMonthPair } from './e2e-safety';

const runId = randomUUID();
const runMarkerPrefix = `e2e:${runId}:heading-back:`;
const transactionMarker = `${runMarkerPrefix}transaction`;
const transferMarker = `${runMarkerPrefix}transfer`;
const accountPrefix = `${runMarkerPrefix}account`;

let databaseClient: DatabaseClient | undefined;
let month = '';
let nextMonth = '';
let categoryId = 0;
let accountId = 0;
let secondAccountId = 0;
let transactionId = 0;
let transferId = 0;

async function cleanupFixtures(): Promise<void> {
  if (!databaseClient) return;
  await databaseClient.sql`
    delete from transfers
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and memo in (${transferMarker})
  `;
  await databaseClient.sql`
    delete from transactions
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and memo in (${transactionMarker})
  `;
  await databaseClient.sql`
    delete from accounts
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and name like ${`${accountPrefix}%`}
  `;
}

async function expectPath(page: Page, path: string): Promise<void> {
  await expect(page).toHaveURL(path);
}

async function expectHeadingBack(
  page: Page,
  path: string,
  title: string,
  label: string,
  href: string,
): Promise<void> {
  await page.goto(path);
  const heading = page.getByRole('heading', { name: title, level: 1 });
  const titleLink = page.getByRole('link', { name: `${title} — ${label}`, exact: true });
  await expect(heading).toBeVisible();
  await expect(titleLink).toHaveAttribute('href', href);
  await expect(page.getByRole('link', { name: label, exact: true })).toHaveCount(0);
  await expect(titleLink.locator('.page-header-back-chevron')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  await page.waitForLoadState('networkidle');
  await titleLink.getByText(title, { exact: true }).click();
  await expectPath(page, href);

  await page.goto(path);
  const chevronLink = page.getByRole('link', { name: `${title} — ${label}`, exact: true });
  await expect(chevronLink).toBeVisible();
  await chevronLink.locator('.page-header-back-chevron').click();
  await expectPath(page, href);

  await page.goto(path);
  const keyboardLink = page.getByRole('link', { name: `${title} — ${label}`, exact: true });
  await expect(keyboardLink).toBeVisible();
  await keyboardLink.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(keyboardLink).toBeFocused();
  await expect(keyboardLink).toHaveCSS('outline-style', 'solid');
  await expect(keyboardLink).toHaveCSS('outline-width', '3px');
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
    [month, nextMonth] = await chooseEmptyMonthPair(databaseClient, runId);

    const categoryRows = await databaseClient.sql<{ id: number }[]>`
      select id
      from categories
      where household_id = ${DEFAULT_HOUSEHOLD_ID} and type = 'expense'
      order by id
      limit 1
    `;
    categoryId = Number(categoryRows[0]?.id);
    if (!Number.isSafeInteger(categoryId))
      throw new Error('heading navigation category is missing');

    const accountRows = await databaseClient.sql<{ id: number }[]>`
      insert into accounts (household_id, name, kind, status, sort_order)
      values
        (${DEFAULT_HOUSEHOLD_ID}, ${`${accountPrefix}-one`}, 'bank', 'active', 10),
        (${DEFAULT_HOUSEHOLD_ID}, ${`${accountPrefix}-two`}, 'other', 'active', 11)
      returning id
    `;
    accountId = Number(accountRows[0]?.id);
    secondAccountId = Number(accountRows[1]?.id);
    if (!Number.isSafeInteger(accountId) || !Number.isSafeInteger(secondAccountId)) {
      throw new Error('heading navigation accounts were not created');
    }

    const transactionRows = await databaseClient.sql<{ id: number }[]>`
      insert into transactions (
        household_id, type, amount, occurred_on, category_id, account_id, memo
      )
      values (
        ${DEFAULT_HOUSEHOLD_ID}, 'expense', 123, ${`${nextMonth}-15`},
        ${categoryId}, ${accountId}, ${transactionMarker}
      )
      returning id
    `;
    transactionId = Number(transactionRows[0]?.id);
    if (!Number.isSafeInteger(transactionId))
      throw new Error('heading navigation transaction was not created');

    const transferRows = await databaseClient.sql<{ id: number }[]>`
      insert into transfers (
        household_id, from_account_id, to_account_id, amount, occurred_on, memo
      )
      values (
        ${DEFAULT_HOUSEHOLD_ID}, ${accountId}, ${secondAccountId}, 456,
        ${`${nextMonth}-16`}, ${transferMarker}
      )
      returning id
    `;
    transferId = Number(transferRows[0]?.id);
    if (!Number.isSafeInteger(transferId))
      throw new Error('heading navigation transfer was not created');
  } catch (error) {
    await databaseClient.close();
    databaseClient = undefined;
    throw error;
  }
});

test.afterAll(async () => {
  if (!databaseClient) return;
  try {
    const safeTestDatabase = assertSafeTestDatabaseTarget();
    await verifySafeTestDatabaseConnection(
      databaseClient.sql,
      safeTestDatabase.target,
      process.env.DATABASE_URL,
    );
    await cleanupFixtures();
  } finally {
    await databaseClient.close();
    databaseClient = undefined;
  }
});

test('uses one accessible title back link for every child screen', async ({ page }) => {
  const validAccountReturn = `/transactions?account=${accountId}&month=${month}&type=expense&category=${categoryId}`;
  const cases = [
    {
      path: `/accounts/new?month=${month}`,
      title: '資産を登録',
      label: '残高へ戻る',
      href: `/balances?month=${month}`,
    },
    {
      path: `/accounts/${accountId}/edit?return=${encodeURIComponent(validAccountReturn)}`,
      title: '資産設定',
      label: '取引一覧へ戻る',
      href: validAccountReturn,
    },
    {
      path: `/transactions/new?month=${month}`,
      title: '新規登録',
      label: '取引一覧へ戻る',
      href: `/transactions?month=${month}`,
    },
    {
      path: `/transactions/${transactionId}/edit?month=${month}`,
      title: '取引を編集',
      label: '一覧へ戻る',
      href: `/transactions?month=${month}`,
    },
    {
      path: `/transactions/transfers/${transferId}/edit?month=${month}`,
      title: '取引を編集',
      label: '一覧へ戻る',
      href: `/transactions?month=${month}`,
    },
    {
      path: `/transactions/import?month=${month}`,
      title: 'らくな家計簿から引っ越す',
      label: '取引一覧へ戻る',
      href: `/transactions?month=${month}`,
    },
    {
      path: '/transactions/2147483648/edit',
      title: '取引が見つかりません',
      label: '取引一覧へ戻る',
      href: '/transactions',
    },
  ] as const;

  for (const target of cases) {
    await expectHeadingBack(page, target.path, target.title, target.label, target.href);
  }
});

test('uses the occurred month when an edit screen has no valid query month', async ({ page }) => {
  for (const path of [
    `/transactions/${transactionId}/edit`,
    `/transactions/${transactionId}/edit?month=not-a-month`,
    `/transactions/transfers/${transferId}/edit`,
    `/transactions/transfers/${transferId}/edit?month=not-a-month`,
  ]) {
    await page.goto(path);
    await expect(page.locator('.page-header-title-link')).toHaveAttribute(
      'href',
      `/transactions?month=${nextMonth}`,
    );
  }
});

test('rejects unsafe or mismatched asset return targets', async ({ page }) => {
  const fallback = `/transactions?account=${accountId}&month=all`;
  for (const returnTarget of [
    'https://example.com/transactions?account=1&month=2026-01',
    `/transactions?account=${secondAccountId}&month=${month}`,
    `/transactions?month=${month}`,
    '/settings',
  ]) {
    await page.goto(`/accounts/${accountId}/edit?return=${encodeURIComponent(returnTarget)}`);
    await expect(page.locator('.page-header-title-link')).toHaveAttribute('href', fallback);
  }
});

test('does not add heading back links to top-level screens', async ({ page }) => {
  for (const path of [
    `/?month=${month}`,
    `/transactions?month=${month}`,
    `/balances?month=${month}`,
    '/settings',
  ]) {
    await page.goto(path);
    await expect(page.locator('.page-header-title-link')).toHaveCount(0);
  }
});

test('wraps the long import title without horizontal overflow at narrow width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 220, height: 844 });
  await page.goto(`/transactions/import?month=${month}`);
  const titleLink = page.getByRole('link', {
    name: 'らくな家計簿から引っ越す — 取引一覧へ戻る',
    exact: true,
  });
  const metrics = await titleLink.evaluate((element) => {
    const title = element.querySelector<HTMLElement>('.heading-title');
    const chevron = element.querySelector<HTMLElement>('.page-header-back-chevron');
    if (!title || !chevron) throw new Error('heading back-link parts are missing');
    const titleRect = title.getBoundingClientRect();
    const chevronRect = chevron.getBoundingClientRect();
    return {
      titleHeight: titleRect.height,
      titleTop: titleRect.top,
      chevronTop: chevronRect.top,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  expect(metrics.titleHeight).toBeGreaterThan(40);
  expect(metrics.chevronTop).toBeLessThanOrEqual(metrics.titleTop + 8);
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
});
