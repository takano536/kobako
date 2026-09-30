import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  DEFAULT_HOUSEHOLD_ID,
  assertSafeTestDatabaseTarget,
  createDatabaseClient,
  initializeDefaultLedger,
  verifySafeTestDatabaseConnection,
  type DatabaseClient,
} from '@kobako/db';
import { MONEY_MANAGER_SOURCE } from '@kobako/db/money-manager';
import { buildMoneyManagerWorkbook } from '@kobako/db/test-fixtures';

import {
  E2E_MARKER_PREFIX,
  SENTINEL_CLEANUP_END_YEAR,
  SENTINEL_MIN_YEAR,
  assertEmptyMonth,
  chooseEmptyMonthPair,
  markerFor,
} from './e2e-safety';

const runId = randomUUID();
const runMarkerPrefix = `${E2E_MARKER_PREFIX}${runId}:`;
const screenshotsDirectory = resolve(process.cwd(), '.tmp/screenshots');

let databaseClient: DatabaseClient | undefined;
let temporaryDirectory = '';
let month = '';
let nextMonth = '';
let fixturePaths:
  | {
      valid: string;
      invalid: string;
      keyboard: string;
      mobile: string;
      multiMonth: string;
      wrongExtension: string;
      empty: string;
      large: string;
    }
  | undefined;
let fixtureHashes: string[] = [];

function database(): DatabaseClient {
  if (!databaseClient) {
    throw new Error('E2E database is not initialized');
  }
  return databaseClient;
}

function excelSerial(monthValue: string, day: number): string {
  const [yearText, monthText] = monthValue.split('-');
  const date = Date.UTC(Number(yearText), Number(monthText) - 1, day);
  const excelEpoch = Date.UTC(1899, 11, 31);
  const days = Math.floor((date - excelEpoch) / 86_400_000);
  const serial = days >= 60 ? days + 1 : days;
  return `${serial}.5`;
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function screenshotPath(name: string): string {
  return join(screenshotsDirectory, `import-${name}.png`);
}
async function screenshotState(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: screenshotPath(`${name}-desktop`), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: screenshotPath(`${name}-mobile`), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
}

async function runCounts(): Promise<{
  transactions: number;
  transfers: number;
  categories: number;
  accounts: number;
  imports: number;
}> {
  const client = database();
  const transactions = await client.sql<{ count: string }[]>`
    select count(*)::text as count
    from transactions
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and occurred_on >= ${`${SENTINEL_MIN_YEAR}-01-01`}
      and occurred_on < ${`${SENTINEL_CLEANUP_END_YEAR}-01-01`}
      and memo like ${`${runMarkerPrefix}%`}
  `;
  const transfers = await client.sql<{ count: string }[]>`
    select count(*)::text as count
    from transfers
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and occurred_on >= ${`${SENTINEL_MIN_YEAR}-01-01`}
      and occurred_on < ${`${SENTINEL_CLEANUP_END_YEAR}-01-01`}
      and memo like ${`${runMarkerPrefix}%`}
  `;
  const categories = await client.sql<{ count: string }[]>`
    select count(*)::text as count
    from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and name like ${`${runMarkerPrefix}%`}
  `;
  const accounts = await client.sql<{ count: string }[]>`
    select count(*)::text as count
    from accounts
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and name like ${`${runMarkerPrefix}%`}
  `;
  let imports = 0;
  for (const hash of fixtureHashes) {
    const rows = await client.sql<{ count: string }[]>`
      select count(*)::text as count
      from transaction_imports
      where household_id = ${DEFAULT_HOUSEHOLD_ID}
        and source = ${MONEY_MANAGER_SOURCE}
        and sha256 = ${hash}
    `;
    imports += Number(rows[0]?.count ?? '0');
  }
  return {
    transactions: Number(transactions[0]?.count ?? '0'),
    transfers: Number(transfers[0]?.count ?? '0'),
    categories: Number(categories[0]?.count ?? '0'),
    accounts: Number(accounts[0]?.count ?? '0'),
    imports,
  };
}

async function writeFixtures(): Promise<void> {
  const date = excelSerial(month, 5);
  const nextDate = excelSerial(month, 6);
  const validExpenseCategory = markerFor(runMarkerPrefix, 'category-expense');
  const validIncomeCategory = markerFor(runMarkerPrefix, 'category-income');
  const validBytes = buildMoneyManagerWorkbook({
    rows: [
      {
        dateSerial: date,
        account: markerFor(runMarkerPrefix, 'valid-expense-account'),
        category: validExpenseCategory,
        content: markerFor(runMarkerPrefix, 'valid-expense-content'),
        memo: markerFor(runMarkerPrefix, 'valid-expense-memo'),
        amount: '1234.0',
        type: '支出',
        currency: 'JPY',
      },
      {
        dateSerial: nextDate,
        account: markerFor(runMarkerPrefix, 'valid-income-account'),
        category: validIncomeCategory,
        content: markerFor(runMarkerPrefix, 'valid-income-content'),
        memo: markerFor(runMarkerPrefix, 'valid-income-memo'),
        amount: '5678.0',
        type: '収入',
        currency: 'JPY',
      },
      {
        dateSerial: nextDate,
        account: markerFor(runMarkerPrefix, 'valid-transfer-from'),
        category: markerFor(runMarkerPrefix, 'valid-transfer-to'),
        content: markerFor(runMarkerPrefix, 'valid-transfer-content'),
        memo: markerFor(runMarkerPrefix, 'valid-transfer-memo'),
        amount: '4321.0',
        type: '引き出し',
        currency: 'JPY',
      },
    ],
  });
  const keyboardBytes = buildMoneyManagerWorkbook({
    rows: [
      {
        dateSerial: date,
        category: markerFor(runMarkerPrefix, 'keyboard-expense-category'),
        content: markerFor(runMarkerPrefix, 'keyboard-expense-content'),
        memo: markerFor(runMarkerPrefix, 'keyboard-expense-memo'),
        amount: '2468.0',
        type: '支出',
        currency: 'JPY',
      },
      {
        dateSerial: nextDate,
        category: markerFor(runMarkerPrefix, 'keyboard-income-category'),
        content: markerFor(runMarkerPrefix, 'keyboard-income-content'),
        memo: markerFor(runMarkerPrefix, 'keyboard-income-memo'),
        amount: '1357.0',
        type: '収入',
        currency: 'JPY',
      },
    ],
  });
  const mobileBytes = buildMoneyManagerWorkbook({
    rows: [
      {
        dateSerial: date,
        category: markerFor(runMarkerPrefix, 'mobile-category'),
        content: markerFor(runMarkerPrefix, 'mobile-content'),
        memo: markerFor(runMarkerPrefix, 'mobile-memo'),
        amount: '987.0',
        type: '支出',
        currency: 'JPY',
      },
    ],
  });
  const multiMonthBytes = buildMoneyManagerWorkbook({
    rows: [
      {
        dateSerial: excelSerial(month, 7),
        category: markerFor(runMarkerPrefix, 'multi-old-category'),
        content: markerFor(runMarkerPrefix, 'multi-old-content'),
        memo: markerFor(runMarkerPrefix, 'multi-old-memo'),
        amount: '111.0',
        type: '支出',
        currency: 'JPY',
      },
      {
        dateSerial: excelSerial(nextMonth, 7),
        category: markerFor(runMarkerPrefix, 'multi-new-category'),
        content: markerFor(runMarkerPrefix, 'multi-new-content'),
        memo: markerFor(runMarkerPrefix, 'multi-new-memo'),
        amount: '222.0',
        type: '収入',
        currency: 'JPY',
      },
    ],
  });
  const invalidBytes = buildMoneyManagerWorkbook({
    rows: [
      {
        dateSerial: date,
        account: 'みずうみ銀行',
        category: '食費',
        content: '食材',
        memo: '週末の買い物',
        amount: '4800.0',
        type: '支出',
        currency: 'JPY',
      },
      {
        dateSerial: date,
        account: 'こもれび信金',
        category: '日用品',
        content: '文房具',
        amount: '12.5',
        type: '支出',
        currency: 'JPY',
      },
      {
        dateSerial: nextDate,
        account: 'さいふ',
        category: 'さいふ',
        content: '資産を移動',
        amount: '1500.0',
        type: '引き出し',
        currency: 'JPY',
      },
      {
        dateSerial: nextDate,
        account: 'みずうみ銀行',
        content: '移動先なし',
        amount: '2500.0',
        type: '引き出し',
        currency: 'JPY',
      },
      {
        dateSerial: nextDate,
        account: 'みずうみ銀行',
        category: 'こもれび信金',
        content: '家計用資金',
        amount: '3210.0',
        type: '引き出し',
        currency: 'JPY',
      },
    ],
  });

  const paths = {
    valid: join(temporaryDirectory, 'valid.xlsx'),
    invalid: join(temporaryDirectory, 'invalid.xlsx'),
    keyboard: join(temporaryDirectory, 'keyboard.xlsx'),
    mobile: join(temporaryDirectory, 'mobile.xlsx'),
    multiMonth: join(temporaryDirectory, 'multi-month.xlsx'),
    wrongExtension: join(temporaryDirectory, 'wrong-extension.txt'),
    empty: join(temporaryDirectory, 'empty.xlsx'),
    large: join(temporaryDirectory, 'large.xlsx'),
  };
  const largeBytes = new Uint8Array(5 * 1024 * 1024 + 1);
  await Promise.all([
    writeFile(paths.valid, validBytes),
    writeFile(paths.invalid, invalidBytes),
    writeFile(paths.keyboard, keyboardBytes),
    writeFile(paths.mobile, mobileBytes),
    writeFile(paths.multiMonth, multiMonthBytes),
    writeFile(paths.wrongExtension, 'not an Excel file'),
    writeFile(paths.empty, new Uint8Array()),
    writeFile(paths.large, largeBytes),
  ]);
  fixturePaths = paths;
  fixtureHashes = [validBytes, invalidBytes, keyboardBytes, mobileBytes, multiMonthBytes].map(
    hashBytes,
  );
}

async function uploadAndPreview(page: Page, path: string): Promise<void> {
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(path);
  await expect(page.getByRole('heading', { name: '取り込み内容を確認' })).toBeVisible();
}

async function tabUntil(page: Page, target: Locator): Promise<void> {
  for (let count = 0; count < 24; count += 1) {
    if (await target.evaluate((element: Element) => element === document.activeElement)) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error('Keyboard navigation did not reach the expected control');
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function deleteRunData(client: DatabaseClient): Promise<void> {
  if (
    !runMarkerPrefix.startsWith(E2E_MARKER_PREFIX) ||
    runMarkerPrefix.length <= E2E_MARKER_PREFIX.length ||
    fixtureHashes.some((hash) => !/^[a-f\d]{64}$/i.test(hash))
  ) {
    throw new Error('E2E cleanup marker or hash is invalid');
  }
  await client.sql`
    delete from transfers
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and occurred_on >= ${`${SENTINEL_MIN_YEAR}-01-01`}
      and occurred_on < ${`${SENTINEL_CLEANUP_END_YEAR}-01-01`}
      and memo like ${`${runMarkerPrefix}%`}
  `;
  await client.sql`
    delete from transactions
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and occurred_on >= ${`${SENTINEL_MIN_YEAR}-01-01`}
      and occurred_on < ${`${SENTINEL_CLEANUP_END_YEAR}-01-01`}
      and memo like ${`${runMarkerPrefix}%`}
  `;
  for (const hash of fixtureHashes) {
    await client.sql`
      delete from transaction_imports
      where household_id = ${DEFAULT_HOUSEHOLD_ID}
        and source = ${MONEY_MANAGER_SOURCE}
        and sha256 = ${hash}
    `;
  }
  await client.sql`
    delete from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and name like ${`${runMarkerPrefix}%`}
  `;
  await client.sql`
    delete from accounts
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and name like ${`${runMarkerPrefix}%`}
  `;
}

test.beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'kobako-money-manager-e2e-'));
  await mkdir(screenshotsDirectory, { recursive: true });
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
    await assertEmptyMonth(databaseClient, month);
    await assertEmptyMonth(databaseClient, nextMonth);
    await writeFixtures();
  } catch (error) {
    await databaseClient.close();
    databaseClient = undefined;
    await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = '';
    throw error;
  }
});

test.afterAll(async () => {
  if (databaseClient) {
    try {
      const safeTestDatabase = assertSafeTestDatabaseTarget();
      await verifySafeTestDatabaseConnection(
        databaseClient.sql,
        safeTestDatabase.target,
        process.env.DATABASE_URL,
      );
      await deleteRunData(databaseClient);
    } finally {
      await databaseClient.close();
      databaseClient = undefined;
    }
  }
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = '';
  }
});

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('navigates from transactions to the import screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/transactions');
  await page.getByRole('link', { name: '取り込む' }).click();
  await expect(page).toHaveURL(/\/transactions\/import$/);
  await expect(page.getByRole('heading', { name: 'らくな家計簿から引っ越す' })).toBeVisible();
  await screenshotState(page, 'e2e-empty');
});
test('rejects unsupported, empty, and oversized files before preview', async ({ page }) => {
  const paths = fixturePaths;
  if (!paths) {
    throw new Error('E2E fixtures are not initialized');
  }
  await page.goto('/transactions/import');
  const input = page.locator('input[type="file"]');

  await input.setInputFiles(paths.wrongExtension);
  await expect(page.locator('.import-file-error')).toHaveText(
    'Excelファイル（.xlsx）を選んでください。',
  );
  await expect(page.locator('.import-file-card-icon')).toHaveText('FILE');
  await screenshotState(page, 'e2e-selected');

  await input.setInputFiles(paths.empty);
  await expect(page.locator('.import-file-error')).toHaveText(
    'ファイルが空です。内容のある.xlsxを選んでください。',
  );

  await input.setInputFiles(paths.large);
  await expect(page.locator('.import-file-error')).toHaveText(
    'ファイルが大きすぎます。5 MiB以下の.xlsxを選んでください。',
  );
});

test('previews a valid workbook without database writes', async ({ page }) => {
  const paths = fixturePaths;
  if (!paths) {
    throw new Error('E2E fixtures are not initialized');
  }
  await page.goto('/transactions/import');
  await expect(page.getByRole('heading', { name: 'らくな家計簿から引っ越す' })).toBeVisible();
  expect(await runCounts()).toEqual({
    transactions: 0,
    transfers: 0,
    categories: 0,
    accounts: 0,
    imports: 0,
  });
  await uploadAndPreview(page, paths.valid);
  await expect(
    page.getByText(markerFor(runMarkerPrefix, 'category-expense'), { exact: false }).first(),
  ).toBeVisible();
  await expect(page.locator('.import-transaction-row.kind-transfer')).toBeVisible();
  await expect(page.getByText('全3件のうち3件を表示', { exact: true })).toBeVisible();
  expect(await runCounts()).toEqual({
    transactions: 0,
    transfers: 0,
    categories: 0,
    accounts: 0,
    imports: 0,
  });
  await screenshotState(page, 'e2e-preview');
});
test('confirms the import and shows the rows in the ledger and overview', async ({ page }) => {
  const paths = fixturePaths;
  if (!paths) {
    throw new Error('E2E fixtures are not initialized');
  }
  await page.goto('/transactions/import');
  await uploadAndPreview(page, paths.valid);
  const confirmButton = page.getByRole('button', { name: '3件を取り込む' });
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  await expect(page.getByRole('heading', { name: '取り込みました' })).toBeVisible();
  await expect(page.locator('.import-success-period')).toHaveText(
    /\d{4}年\d+月\d+日〜\d{4}年\d+月\d+日/,
  );
  await screenshotState(page, 'e2e-success');
  expect(await runCounts()).toEqual({
    transactions: 2,
    transfers: 1,
    categories: 2,
    accounts: 4,
    imports: 1,
  });

  await page.getByRole('link', { name: '取引一覧へ', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}$`));
  await expect(
    page.getByText(markerFor(runMarkerPrefix, 'category-expense'), { exact: true }),
  ).toBeVisible();
  const transferRow = page.locator('.transaction-transfer');
  await expect(transferRow).toContainText(markerFor(runMarkerPrefix, 'valid-transfer-from'));
  await expect(transferRow).toContainText(markerFor(runMarkerPrefix, 'valid-transfer-to'));
  await expect(
    page.locator('.transaction-memo').filter({
      hasText: markerFor(runMarkerPrefix, 'valid-expense-memo'),
    }),
  ).toBeVisible();
  await page.goto(`/?month=${month}`);
  await expect(
    page.getByRole('group', { name: 'この月の支出' }).getByText('1,234円', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('group', { name: '収入' }).getByText('5,678円', { exact: true }),
  ).toBeVisible();
});

test('warns on re-import and disables confirmation without new rows', async ({ page }) => {
  const paths = fixturePaths;
  if (!paths) {
    throw new Error('E2E fixtures are not initialized');
  }
  await page.goto('/transactions/import');
  await uploadAndPreview(page, paths.valid);
  await expect(
    page.getByRole('heading', { name: /このファイルは.+に取り込み済みです/ }),
  ).toBeVisible();
  await expect(page.getByText('同じファイルは重複して取り込めません。')).toBeVisible();
  await expect(page.getByRole('link', { name: '取引一覧で確認する' })).toBeVisible();
  await expect(page.getByRole('button', { name: '別のファイルを選ぶ' })).toBeVisible();
  await screenshotState(page, 'e2e-duplicate');
  expect(await runCounts()).toEqual({
    transactions: 2,
    transfers: 1,
    categories: 2,
    accounts: 4,
    imports: 1,
  });
});

test('shows row-numbered errors while keeping transfers as importable rows', async ({ page }) => {
  const paths = fixturePaths;
  if (!paths) {
    throw new Error('E2E fixtures are not initialized');
  }
  await page.goto('/transactions/import');
  await uploadAndPreview(page, paths.invalid);
  await expect(page.getByText('3行目', { exact: true })).toBeVisible();
  await expect(page.getByText('金額「12.5」を読み取れません。', { exact: true })).toBeVisible();
  await expect(
    page.getByText('移動元と移動先が同じ「さいふ」です。', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('移動先の資産がありません。', { exact: true })).toBeVisible();
  await expect(page.locator('.import-transaction-row.kind-transfer')).toBeVisible();
  const confirmButton = page.getByRole('button', { name: /件を取り込む$/ });
  await expect(confirmButton).toBeDisabled();
  await screenshotState(page, 'e2e-error');
  expect(await runCounts()).toEqual({
    transactions: 2,
    transfers: 1,
    categories: 2,
    accounts: 4,
    imports: 1,
  });
});

test('supports keyboard-only preview, confirm, and file-selection reset', async ({ page }) => {
  const paths = fixturePaths;
  if (!paths) {
    throw new Error('E2E fixtures are not initialized');
  }
  await page.goto('/transactions/import');
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(paths.keyboard);
  await expect(page.getByRole('heading', { name: '取り込み内容を確認' })).toBeFocused();

  const confirmButton = page.getByRole('button', { name: '2件を取り込む' });
  await tabUntil(page, confirmButton);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '取り込みました' })).toBeFocused();

  const anotherFileButton = page.getByRole('button', { name: '別のファイルを取り込む' });
  await tabUntil(page, anotherFileButton);
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();

  await input.setInputFiles(paths.invalid);
  await expect(page.getByRole('heading', { name: '取り込み内容を確認' })).toBeFocused();
  const backButton = page.getByRole('button', { name: 'ファイルを選び直す' });
  await tabUntil(page, backButton);
  await page.keyboard.press('Space');
  await expect(input).toBeFocused();
});

test('keeps preview and error states within a 390px viewport', async ({ page }) => {
  const paths = fixturePaths;
  if (!paths) {
    throw new Error('E2E fixtures are not initialized');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/transactions/import');
  await uploadAndPreview(page, paths.mobile);
  await assertNoHorizontalOverflow(page);

  await page.goto('/transactions/import');
  await uploadAndPreview(page, paths.invalid);
  await assertNoHorizontalOverflow(page);
  await expect(page.getByText('3行目', { exact: true })).toBeVisible();
});
test('opens the latest imported month after a multi-month import', async ({ page }) => {
  const paths = fixturePaths;
  if (!paths) {
    throw new Error('E2E fixtures are not initialized');
  }
  await page.goto('/transactions/import');
  await uploadAndPreview(page, paths.multiMonth);
  await page.getByRole('button', { name: '2件を取り込む' }).click();
  await expect(page.getByRole('heading', { name: '取り込みました' })).toBeVisible();
  await page.getByRole('link', { name: '取引一覧へ', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${nextMonth}$`));
});

test('previews and confirms through the fallback form when JavaScript is disabled', async ({
  browser,
}) => {
  const paths = fixturePaths;
  if (!paths) {
    throw new Error('E2E fixtures are not initialized');
  }
  const context = await browser.newContext({
    javaScriptEnabled: false,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });
  const page = await context.newPage();
  try {
    await page.goto('/transactions/import');
    const input = page.locator('input[type="file"]');
    await input.setInputFiles(paths.mobile);
    await page.getByRole('button', { name: 'ファイルを読み込む' }).click();
    await expect(page.getByRole('heading', { name: '取り込み内容を確認' })).toBeVisible();
    await expect(page.getByText('全1件のうち1件を表示', { exact: true })).toBeVisible();

    await input.setInputFiles(paths.mobile);
    await page.getByRole('button', { name: '1件を取り込む' }).click();
    await expect(page.getByRole('heading', { name: '取り込みました' })).toBeVisible();
  } finally {
    await context.close();
  }
});
