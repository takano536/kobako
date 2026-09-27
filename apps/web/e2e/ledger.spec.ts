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
  await page.getByLabel('金額').fill('1,200');
  await page.locator('input[name="occurredOn"]').fill(`${month}-10`);
  await page.getByLabel('カテゴリ').selectOption({ label: '食費' });
  await page.getByLabel('メモ（任意）').fill(markerFor('expense'));
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(page.getByRole('link', { name: /支出.*1,200円/ })).toBeVisible();
  await page.goto(`/?month=${month}`);
  await expect(
    page.getByRole('group', { name: 'この月の支出' }).getByText('1,200円'),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: '収支差額' }).locator('dd')).toHaveText(
    'マイナス−1,200円',
  );
});

test('adds income and updates the difference, then edits and deletes a transaction', async ({
  page,
}) => {
  await page.goto(`/transactions/new?month=${month}`);
  await page.getByText('収入', { exact: true }).click();
  await page.getByLabel('金額').fill('5,000');
  await page.locator('input[name="occurredOn"]').fill(`${month}-20`);
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
  await page.getByLabel('金額').fill('2,000');
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(page.getByRole('link', { name: /支出.*2,000円/ })).toBeVisible();

  await page.getByRole('link', { name: /10日/ }).click();
  await page.getByRole('button', { name: '削除する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(page.getByRole('link', { name: /支出.*2,000円/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /収入.*5,000円/ })).toBeVisible();
});

test('preselects an unknown category when editing its transaction', async ({ page }) => {
  if (!databaseClient) {
    throw new Error('database client is not initialized');
  }

  const categoryRows = await databaseClient.sql`
    select id
    from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and type = 'expense'
      and name = '不明なカテゴリ'
    limit 1
  `;
  let categoryId: number;
  let createdCategory = false;
  const existingCategoryId = categoryRows[0]?.id;
  if (existingCategoryId !== undefined) {
    categoryId = Number(existingCategoryId);
  } else {
    const insertedCategories = await databaseClient.sql`
      insert into categories (household_id, type, name, sort_order)
      values (${DEFAULT_HOUSEHOLD_ID}, 'expense', '不明なカテゴリ', 95)
      returning id
    `;
    categoryId = Number(insertedCategories[0]?.id);
    createdCategory = true;
  }
  if (!Number.isInteger(categoryId)) {
    throw new Error('unknown category fixture was not created');
  }

  const memo = markerFor('unknown-category-edit');
  const insertedTransactions = await databaseClient.sql`
    insert into transactions (household_id, type, amount, occurred_on, category_id, memo)
    values (${DEFAULT_HOUSEHOLD_ID}, 'expense', 450, ${`${month}-25`}, ${categoryId}, ${memo})
    returning id
  `;
  const transactionId = Number(insertedTransactions[0]?.id);
  if (!Number.isInteger(transactionId)) {
    throw new Error('unknown category transaction fixture was not created');
  }

  try {
    await page.goto(`/transactions/${transactionId}/edit`);
    const categorySelect = page.getByLabel('カテゴリ');
    await expect(categorySelect).toHaveValue(String(categoryId));
    await expect(categorySelect.locator('option:checked')).toHaveText('不明なカテゴリ');
    await expect(page.getByLabel('メモ（任意）')).toHaveValue(memo);
  } finally {
    await databaseClient.sql`delete from transactions where id = ${transactionId}`;
    if (createdCategory) {
      await databaseClient.sql`delete from categories where id = ${categoryId}`;
    }
  }
});

test('isolates months: a transaction in one month never appears in another', async ({ page }) => {
  await assertEmptyMonth(nextMonth);
  await page.goto(`/transactions/new?month=${nextMonth}`);
  await page.getByLabel('金額').fill('700');
  await page.locator('input[name="occurredOn"]').fill(`${nextMonth}-05`);
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
  const context = await browser.newContext({
    javaScriptEnabled: false,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });
  const page = await context.newPage();
  try {
    await page.goto(`/transactions?month=${month}`);
    await expect(page.getByText('すべての種別・すべてのカテゴリ')).toBeVisible();
    await page.getByText('条件を変更する', { exact: true }).click();
    await page.getByRole('combobox', { name: '種別' }).selectOption('income');
    await page.getByRole('button', { name: '適用' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}.*type=income`));
    await expect(page.getByText('収入・すべてのカテゴリ')).toBeVisible();
    await expect(page.getByRole('link', { name: /収入.*円/ })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('saves and displays zero and negative amounts', async ({ page }) => {
  await page.goto(`/transactions/new?month=${month}`);
  await page.getByLabel('金額').fill('0');
  await page.locator('input[name="occurredOn"]').fill(`${month}-26`);
  await page.getByLabel('カテゴリ').selectOption({ label: '食費' });
  await page.getByLabel('メモ（任意）').fill(markerFor('zero'));
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(page.getByRole('link', { name: /支出.*0円/ })).toBeVisible();

  await page.goto(`/transactions/new?month=${month}`);
  await page.getByLabel('金額').fill('-1200');
  await page.locator('input[name="occurredOn"]').fill(`${month}-27`);
  await page.getByLabel('カテゴリ').selectOption({ label: '食費' });
  await page.getByLabel('メモ（任意）').fill(markerFor('negative'));
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(page.getByRole('link', { name: /支出.*＋1,200円/ })).toBeVisible();
});

test('strips non-numeric characters from the amount field and keeps value controls full width', async ({
  page,
}) => {
  await page.goto(`/transactions/new?month=${month}`);
  const amount = page.getByLabel('金額');
  await amount.fill('1,200');
  await expect(amount).toHaveValue('1200');
  await amount.fill('１２ａ３');
  await expect(amount).toHaveValue('123');
  await amount.fill('−１，２００');
  await expect(amount).toHaveValue('-1200');

  for (const selector of [
    '.amount-line .field-value',
    '.category-field .field-value',
    '.date-field .field-value',
    '.memo-field .field-value',
  ]) {
    const valueBox = await page.locator(selector).boundingBox();
    const controlBox = await page
      .locator(
        `${selector} > input, ${selector} > select, ${selector} > textarea, ${selector} .date-picker-display`,
      )
      .first()
      .boundingBox();
    if (!valueBox || !controlBox) {
      throw new Error(`value control is not measurable: ${selector}`);
    }
    expect(controlBox.width).toBeCloseTo(valueBox.width, 1);
  }
});

test('shows server amount errors in the fallback dialog without changing row height', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    for (const [invalidAmount, expectedMessage] of [
      ['1.5', '金額は整数で入力してください。'],
      ['1000000000', '金額は999,999,999円以下で入力してください。'],
    ] as const) {
      await page.goto(`/transactions/new?month=${month}`);
      const amount = page.getByLabel('金額');
      const row = page.locator('.amount-field');
      await amount.fill('100');
      const validBox = await row.boundingBox();
      if (!validBox) {
        throw new Error('amount row is not measurable');
      }
      await amount.fill(invalidAmount);
      await page.getByRole('button', { name: '登録する' }).click();
      const dialog = page.locator('dialog[open]');
      await expect(dialog).toContainText(expectedMessage);
      await expect(page.locator('#transaction-amount-error')).toHaveClass(/sr-only/);
      await expect(amount).toHaveAttribute('aria-invalid', 'true');
      await expect(row).toHaveClass(/has-error/);
      const errorBox = await row.boundingBox();
      if (!errorBox) {
        throw new Error('amount error row is not measurable');
      }
      expect(errorBox.height).toBe(validBox.height);
    }
  } finally {
    await context.close();
  }
});

test('opens an error dialog and restores focus without changing invalid row height', async ({
  page,
}) => {
  await page.goto(`/transactions/new?month=${month}`);
  const amount = page.getByLabel('金額');
  const row = page.locator('.amount-field');
  const validBox = await row.boundingBox();
  if (!validBox) {
    throw new Error('amount row is not measurable');
  }
  await amount.fill('1000000000');
  await page.getByRole('button', { name: '登録する' }).click();

  const dialog = page.getByRole('dialog', { name: '入力内容を確認してください' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('金額は999,999,999円以下で入力してください。');
  await expect(page.locator('#transaction-amount-error')).toHaveClass(/sr-only/);
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  await expect(row).toHaveClass(/has-error/);
  const errorColor = await row.evaluate((element) => getComputedStyle(element).borderBottomColor);
  expect(errorColor).toBe('rgb(138, 91, 91)');
  const errorBox = await row.boundingBox();
  if (!errorBox) {
    throw new Error('amount error row is not measurable');
  }
  expect(errorBox.height).toBe(validBox.height);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(amount).toBeFocused();

  await page.getByRole('button', { name: '登録する' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '閉じる' }).click();
  await expect(dialog).toBeHidden();
  await expect(amount).toBeFocused();
});

test('formats date and month controls independently of browser locale', async ({ browser }) => {
  const context = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'Asia/Tokyo',
  });
  const page = await context.newPage();
  const day = `${month}-27`;
  const initialDate = `${month.replace('-', '/')}/01`;
  const expectedDate = `${month.replace('-', '/')}/27`;
  const expectedMonth = month.replace('-', '/');
  try {
    await page.goto(`/transactions/new?month=${month}`);
    const dateInput = page.locator('input[type="date"][name="occurredOn"]');
    await expect(page.locator('.date-picker-display')).toContainText(initialDate);
    await dateInput.fill(day);
    await expect(page.locator('.date-picker-display')).toContainText(expectedDate);
    await page.getByLabel('金額').fill('321');
    await page.getByLabel('カテゴリ').selectOption({ label: '食費' });
    await page.getByLabel('メモ（任意）').fill(markerFor('locale-date'));
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));

    await page.getByText('条件を変更する', { exact: true }).click();
    await expect(page.locator('.month-picker-display')).toHaveText(expectedMonth);
    const monthInput = page.locator('input[type="month"][name="month"]');
    await monthInput.fill(month);
    await expect(monthInput).toHaveValue(month);
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
