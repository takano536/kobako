import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import {
  DEFAULT_HOUSEHOLD_ID,
  assertSafeTestDatabaseTarget,
  createDatabaseClient,
  initializeDefaultLedger,
  monthRange,
  shiftMonth,
  verifySafeTestDatabaseConnection,
  type DatabaseClient,
} from '@kobako/db';

const E2E_MARKER_PREFIX = 'e2e:';
const SENTINEL_MIN_YEAR = 9000;
const SENTINEL_MAX_YEAR = 9997;
const SENTINEL_CLEANUP_END_YEAR = SENTINEL_MAX_YEAR + 2;
const SENTINEL_MONTH_COUNT = (SENTINEL_MAX_YEAR - SENTINEL_MIN_YEAR + 1) * 12;
const runId = randomUUID();
const runMarkerPrefix = `${E2E_MARKER_PREFIX}${runId}:`;

let databaseClient: DatabaseClient | undefined;
let month = '';
let monthLabel = '';
let nextMonth = '';
let nextMonthLabel = '';

function labelForMonth(value: string): string {
  const [year, monthNumber] = value.split('-');
  return `${year}年${Number(monthNumber)}月`;
}

function markerFor(testName: string): string {
  return `${runMarkerPrefix}${testName}`;
}

async function monthIsEmpty(client: DatabaseClient, value: string): Promise<boolean> {
  const range = monthRange(value);
  const rows = await client.sql`
    select 1
    from transactions
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and occurred_on >= ${range.start}
      and occurred_on < ${range.endExclusive}
    limit 1
  `;
  return rows.length === 0;
}

async function chooseEmptyMonthPair(client: DatabaseClient): Promise<[string, string]> {
  const runOffset = Number(
    BigInt(`0x${runId.replaceAll('-', '').slice(0, 12)}`) % BigInt(SENTINEL_MONTH_COUNT),
  );
  for (let offset = 0; offset < SENTINEL_MONTH_COUNT; offset += 1) {
    const candidateIndex = (runOffset + offset) % SENTINEL_MONTH_COUNT;
    const year = SENTINEL_MIN_YEAR + Math.floor(candidateIndex / 12);
    const monthNumber = (candidateIndex % 12) + 1;
    const candidate = `${year}-${String(monthNumber).padStart(2, '0')}`;
    const candidateNext = shiftMonth(candidate, 1);
    if ((await monthIsEmpty(client, candidate)) && (await monthIsEmpty(client, candidateNext))) {
      return [candidate, candidateNext];
    }
  }
  throw new Error(
    `No empty E2E sentinel month pair is available in ${SENTINEL_MIN_YEAR}-${SENTINEL_MAX_YEAR}; existing data was not deleted`,
  );
}

async function assertEmptyMonth(value: string): Promise<void> {
  if (!databaseClient || !(await monthIsEmpty(databaseClient, value))) {
    throw new Error(
      `E2E sentinel month ${value} is not empty; refusing to assert empty-month UI state`,
    );
  }
}

async function deleteRunTransactions(client: DatabaseClient): Promise<void> {
  if (
    !runMarkerPrefix.startsWith(E2E_MARKER_PREFIX) ||
    runMarkerPrefix.length <= E2E_MARKER_PREFIX.length
  ) {
    throw new Error('E2E cleanup marker is invalid');
  }
  await client.sql`
    delete from transactions
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and occurred_on >= ${`${SENTINEL_MIN_YEAR}-01-01`}
      and occurred_on < ${`${SENTINEL_CLEANUP_END_YEAR}-01-01`}
      and memo like ${`${runMarkerPrefix}%`}
  `;
}

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
    [month, nextMonth] = await chooseEmptyMonthPair(databaseClient);
    monthLabel = labelForMonth(month);
    nextMonthLabel = labelForMonth(nextMonth);
  } catch (error) {
    await databaseClient.close();
    databaseClient = undefined;
    throw error;
  }
});

test.afterAll(async () => {
  if (!databaseClient) {
    return;
  }
  try {
    const safeTestDatabase = assertSafeTestDatabaseTarget();
    await verifySafeTestDatabaseConnection(
      databaseClient.sql,
      safeTestDatabase.target,
      process.env.DATABASE_URL,
    );
    await deleteRunTransactions(databaseClient);
  } finally {
    await databaseClient.close();
    databaseClient = undefined;
  }
});

test.describe.configure({ mode: 'serial' });

test('shows an empty month and reflects an added expense in the list and overview total', async ({
  page,
}) => {
  await assertEmptyMonth(month);
  await page.goto(`/?month=${month}`);
  await expect(page.getByRole('heading', { name: monthLabel })).toBeVisible();
  await expect(page.getByText('まだ記録がありません')).toBeVisible();

  await page.getByRole('link', { name: '取引を登録', exact: true }).click();
  await expect(page.getByRole('heading', { name: '新規登録' })).toBeVisible();
  await page.getByLabel('金額（円）').fill('1,200');
  await page.getByLabel('日付').fill(`${month}-10`);
  await page.getByLabel('カテゴリ').selectOption({ label: '食費' });
  await page.getByLabel('メモ（任意）').fill(markerFor('expense'));
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(page.getByRole('link', { name: /支出.*1,200円/ })).toBeVisible();

  await page.goto(`/?month=${month}`);
  await expect(
    page.getByRole('group', { name: 'この月の支出' }).getByText('1,200円'),
  ).toBeVisible();
});

test('adds income and updates the difference, then edits and deletes a transaction', async ({
  page,
}) => {
  await page.goto(`/transactions/new?month=${month}`);
  await page.getByText('収入', { exact: true }).click();
  await page.getByLabel('金額（円）').fill('5,000');
  await page.getByLabel('日付').fill(`${month}-20`);
  await page.getByLabel('カテゴリ').selectOption({ label: '給与' });
  await page.getByLabel('メモ（任意）').fill(markerFor('income'));
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await page.goto(`/?month=${month}`);
  await expect(page.getByRole('group', { name: '収入' }).getByText('5,000円')).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'この月の支出' }).getByText('1,200円'),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: '収支差額' }).getByText('3,800円')).toBeVisible();

  await page.goto(`/transactions?month=${month}`);
  await page.getByRole('link', { name: /10日/ }).click();
  await page.getByLabel('金額（円）').fill('2,000');
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(page.getByRole('link', { name: /支出.*2,000円/ })).toBeVisible();

  await page.getByRole('link', { name: /10日/ }).click();
  await page.getByLabel('この取引を削除することを確認しました').check();
  await page.getByRole('button', { name: '削除する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(page.getByRole('link', { name: /支出.*2,000円/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /収入.*5,000円/ })).toBeVisible();
});

test('isolates months: a transaction in one month never appears in another', async ({ page }) => {
  await assertEmptyMonth(nextMonth);
  await page.goto(`/transactions/new?month=${nextMonth}`);
  await page.getByLabel('金額（円）').fill('700');
  await page.getByLabel('日付').fill(`${nextMonth}-05`);
  await page.getByLabel('カテゴリ').selectOption({ label: '日用品' });
  await page.getByLabel('メモ（任意）').fill(markerFor('next-month'));
  await page.getByRole('button', { name: '登録する' }).click();

  await page.goto(`/?month=${month}`);
  await expect(page.getByText('700円')).toHaveCount(0);
  await expect(page.getByRole('group', { name: '収入' }).getByText('5,000円')).toBeVisible();

  await page.goto(`/transactions?month=${month}`);
  await expect(page.getByRole('link', { name: /700円/ })).toHaveCount(0);

  await page.goto(`/?month=${nextMonth}`);
  await expect(page.getByRole('heading', { name: nextMonthLabel })).toBeVisible();
  await expect(page.getByRole('group', { name: 'この月の支出' }).getByText('700円')).toBeVisible();
  await expect(page.getByRole('group', { name: '収入' }).getByText('0円')).toBeVisible();

  await page.goto(`/transactions?month=${nextMonth}`);
  const rows = page.getByRole('list', { name: '取引' }).getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('700円');

  await page.goto(`/?month=${month}`);
  await page.getByRole('link', { name: '翌月 ›' }).click();
  await expect(page.getByRole('heading', { name: nextMonthLabel })).toBeVisible();
});

test('filters transactions with a native GET form when JavaScript is disabled', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(`/transactions?month=${month}`);
    await page.getByText('条件を変更する', { exact: true }).click();
    await page.getByRole('combobox', { name: '種別' }).selectOption('income');
    await page.getByRole('button', { name: '適用' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}.*type=income`));
    await expect(page.getByText(`${monthLabel}・収入・すべてのカテゴリ`)).toBeVisible();
    await expect(page.getByRole('link', { name: /収入.*円/ })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('shows a Japanese validation error and keeps the entered amount with aria-invalid', async ({
  page,
}) => {
  await page.goto('/transactions/new');
  const amountField = page.getByLabel('金額（円）');
  await amountField.fill('0');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: '入力内容を確認してください。' }),
  ).toContainText('入力内容を確認してください。');
  await expect(amountField).toHaveValue('0');
  await expect(amountField).toHaveAttribute('aria-invalid', 'true');
});

test('rejects an invalid amount server-side when JavaScript is disabled', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto('/transactions/new');
    await page.getByLabel('金額（円）').fill('0');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: '入力内容を確認してください。' }),
    ).toContainText('入力内容を確認してください。');
  } finally {
    await context.close();
  }
});

test('treats non-int4 transaction ids as not found', async ({ request }) => {
  for (const id of ['2147483648', '007']) {
    const response = await request.get(`/transactions/${id}/edit`);
    expect(response.status()).toBe(404);
  }
});

test('health endpoints are available', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'kobako 家計ノート ホーム' })).toBeVisible();

  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({ status: 'ok' });

  const databaseHealth = await request.get('/api/health/db');
  expect(databaseHealth.ok()).toBe(true);
  expect(await databaseHealth.json()).toEqual({ status: 'ok' });
});
