import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import {
  DEFAULT_HOUSEHOLD_ID,
  currentTokyoMonth,
  assertSafeTestDatabaseTarget,
  createDatabaseClient,
  initializeDefaultLedger,
  verifySafeTestDatabaseConnection,
  type DatabaseClient,
} from '@kobako/db';
import {
  E2E_MARKER_PREFIX,
  SENTINEL_CLEANUP_END_YEAR,
  SENTINEL_MIN_YEAR,
  assertCleanupMarker,
  assertEmptyMonth as assertEmptyMonthInDatabase,
  chooseEmptyMonthPair,
  labelForMonth,
  markerFor as markerForPrefix,
} from './e2e-safety';
import {
  assertDeleteAndSaveAligned,
  assertDeleteModalGeometry,
  assertDeleteModalInteraction,
  type ModalViewport,
} from './delete-modal-helpers';
import { openMonthPicker, pickMonthInGrid } from './month-picker';
import { selectFieldOption } from './select-field-helpers';

const runId = randomUUID();
const runMarkerPrefix = `${E2E_MARKER_PREFIX}${runId}:`;

let databaseClient: DatabaseClient | undefined;
let month = '';
let nextMonth = '';
let nextMonthLabel = '';

function markerFor(testName: string): string {
  return markerForPrefix(runMarkerPrefix, testName);
}
async function assertEmptyMonth(value: string): Promise<void> {
  if (!databaseClient) {
    throw new Error(`E2E sentinel month ${value} cannot be checked without a database`);
  }
  await assertEmptyMonthInDatabase(databaseClient, value);
}

async function deleteRunTransactions(client: DatabaseClient): Promise<void> {
  assertCleanupMarker(runMarkerPrefix);
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
    [month, nextMonth] = await chooseEmptyMonthPair(databaseClient, runId);
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
  await expect(page.getByRole('heading', { name: '概要' })).toBeVisible();
  await expect(page.getByText('まだ記録がありません')).toBeVisible();

  await page.getByRole('link', { name: '取引を登録', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '取引を登録' })).toBeVisible();
  await page.getByLabel('金額').fill('1,200');
  await page.locator('input[name="occurredOn"]').fill(`${month}-10`);
  await selectFieldOption(page.locator('#transaction-category-expense'), { label: '食費' });
  await page.getByLabel('メモ（任意）').fill(markerFor('expense'));
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(page.getByRole('link', { name: /支出.*1,200円/ })).toBeVisible();
  await page.goto(`/?month=${month}`);
  await expect(
    page.getByRole('group', { name: 'この月の支出' }).locator('[data-slot="lead-amount"]'),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: '収支差額' }).locator('dd')).toHaveText(
    'マイナス−1,200円',
  );
});

test('blocks submit when an enhanced required select is empty', async ({ page }) => {
  await page.goto(`/transactions/new?month=${month}`);
  const category = page.locator('#transaction-category-expense');
  await expect(category).toHaveAttribute('aria-haspopup', 'menu');
  await category.click();
  await page
    .locator('[data-slot="select-field-menu"]:visible')
    .getByRole('menuitemradio')
    .first()
    .click();
  await page.getByLabel('金額').fill('1,200');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(/\/transactions\/new\?/);
  await expect(category).toHaveAttribute('aria-invalid', 'true');
});

test('keeps the selected month across global navigation and browser history', async ({ page }) => {
  if (!databaseClient) {
    throw new Error('database client is not initialized');
  }
  const categoryRows = await databaseClient.sql<{ id: string }[]>`
    select id
    from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and type = 'expense'
      and name = '食費'
    limit 1
  `;
  const categoryId = categoryRows[0]?.id;
  if (!categoryId) {
    throw new Error('navigation category fixture was not found');
  }
  const [month, nextMonth] = await chooseEmptyMonthPair(databaseClient, runId);
  const currentMarker = markerFor('navigation-current');
  const nextMarker = markerFor('navigation-next');
  const createMarker = markerFor('navigation-create');
  const expectOverview = async (expectedMonth: string, expectedAmount: string) => {
    await expect(page.locator('[data-slot="month-switcher-label"]')).toHaveText(
      labelForMonth(expectedMonth),
    );
    await expect(
      page.getByRole('group', { name: 'この月の支出' }).locator('[data-slot="lead-amount"]'),
    ).toContainText(expectedAmount);
  };
  try {
    await databaseClient.sql`
      insert into transactions (household_id, type, amount, occurred_on, category_id, memo)
      values
        (${DEFAULT_HOUSEHOLD_ID}, 'expense', 321, ${`${month}-21`}, ${categoryId}, ${currentMarker}),
        (${DEFAULT_HOUSEHOLD_ID}, 'expense', 654, ${`${nextMonth}-21`}, ${categoryId}, ${nextMarker})
    `;

    await page.goto(`/?month=${month}`);
    await expectOverview(month, '321円');
    await page.getByRole('link', { name: '取引', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}$`));
    await expect(page.getByText(currentMarker, { exact: true })).toBeVisible();
    await expect(page.getByText(nextMarker, { exact: true })).toHaveCount(0);

    await page.getByRole('link', { name: '概要', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/\\?month=${month}$`));
    await expectOverview(month, '321円');

    await page.getByRole('link', { name: '翌月', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/\\?month=${nextMonth}$`));
    await expectOverview(nextMonth, '654円');
    await page.getByRole('link', { name: '取引', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${nextMonth}$`));
    await expect(page.getByText(nextMarker, { exact: true })).toBeVisible();
    await expect(page.getByText(currentMarker, { exact: true })).toHaveCount(0);

    await page.getByRole('link', { name: '概要', exact: true }).click();
    await expectOverview(nextMonth, '654円');
    await page.getByRole('link', { name: '残高', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/balances\\?month=${nextMonth}$`));
    await page.getByRole('link', { name: '資産を登録', exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/accounts/new\\?month=${nextMonth}$`));
    await page.getByRole('button', { name: '資産を登録 — 戻る', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/balances\\?month=${nextMonth}$`));
    await page.getByRole('link', { name: '取引', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${nextMonth}$`));
    await expect(page.getByText(nextMarker, { exact: true })).toBeVisible();
    await page.getByRole('link', { name: '取引を登録', exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/transactions/new\\?month=${nextMonth}$`));
    await page.getByLabel('金額').fill('111');
    await page.locator('input[name="occurredOn"]').fill(`${nextMonth}-22`);
    await selectFieldOption(page.locator('#transaction-category-expense'), { label: '食費' });
    await page.getByLabel('メモ（任意）').fill(createMarker);
    await page.getByRole('button', { name: '登録する', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${nextMonth}$`));
    const createdRow = page
      .locator('[data-slot="transaction-link"]')
      .filter({ hasText: createMarker });
    await expect(createdRow).toHaveCount(1);
    await createdRow.click();
    await expect(page).toHaveURL(new RegExp(`/transactions/\\d+/edit\\?month=${nextMonth}$`));
    await page.getByLabel('金額').fill('222');
    await page.getByRole('button', { name: '変更を保存', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${nextMonth}$`));
    await expect(
      page.locator('[data-slot="transaction-link"]').filter({ hasText: createMarker }),
    ).toContainText('222円');
    await page.getByRole('link', { name: '概要', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/\\?month=${nextMonth}$`));
    await expectOverview(nextMonth, '876円');
    await page.getByRole('link', { name: '取引', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${nextMonth}$`));

    await page.getByRole('link', { name: '設定', exact: true }).click();
    await expect(page).toHaveURL('/settings');
    await page.getByRole('link', { name: '取り込む' }).click();
    await expect(page).toHaveURL(/\/settings\/import$/);
    await expect(page.getByRole('link', { name: '設定', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page
      .getByRole('link', { name: 'らくな家計簿から引っ越す — 設定へ戻る', exact: true })
      .click();
    await expect(page).toHaveURL('/settings');
    await page.goto(`/transactions?month=${nextMonth}`);

    await page.getByRole('link', { name: 'kobako 家計ノート ホーム' }).click();
    await expect(page).toHaveURL(new RegExp(`/\\?month=${nextMonth}$`));
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/\\?month=${nextMonth}$`));
    await expectOverview(nextMonth, '876円');
    await page.getByRole('link', { name: '取引', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${nextMonth}$`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/\\?month=${nextMonth}$`));
    await expectOverview(nextMonth, '876円');
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${nextMonth}$`));
    await expect(page.getByText(nextMarker, { exact: true })).toBeVisible();
  } finally {
    await databaseClient.sql`
      delete from transactions
      where household_id = ${DEFAULT_HOUSEHOLD_ID}
        and (memo = ${currentMarker} or memo = ${nextMarker} or memo = ${createMarker})
    `;
  }
});
test('keeps the selected month through transaction edit navigation, save, and cancel', async ({
  page,
}) => {
  if (!databaseClient) {
    throw new Error('database client is not initialized');
  }
  const categoryRows = await databaseClient.sql<{ id: string }[]>`
    select id
    from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and type = 'expense'
      and name = '食費'
    limit 1
  `;
  const categoryId = categoryRows[0]?.id;
  if (!categoryId) {
    throw new Error('edit navigation category fixture was not found');
  }
  const selectedMarker = markerFor('edit-navigation-selected');
  const otherMonthMarker = markerFor('edit-navigation-other-month');
  const selectedRows = await databaseClient.sql<{ id: number }[]>`
    insert into transactions (household_id, type, amount, occurred_on, category_id, memo)
    values
      (${DEFAULT_HOUSEHOLD_ID}, 'expense', 4321, ${`${month}-28`}, ${categoryId}, ${selectedMarker}),
      (${DEFAULT_HOUSEHOLD_ID}, 'expense', 6543, ${`${nextMonth}-28`}, ${categoryId}, ${otherMonthMarker})
    returning id
  `;
  const selectedTransactionId = Number(selectedRows[0]?.id);
  if (!Number.isInteger(selectedTransactionId)) {
    throw new Error('edit navigation transaction fixture was not created');
  }

  const expectSelectedList = async (amount: string) => {
    await expect(
      page.locator('[data-slot="transaction-link"]').filter({ hasText: selectedMarker }),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-slot="transaction-link"]').filter({ hasText: otherMonthMarker }),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-slot="transaction-link"]').filter({ hasText: selectedMarker }),
    ).toContainText(amount);
  };
  const expectSelectedOverview = async (amount: string) => {
    await expect(page.getByRole('link', { name: new RegExp(`支出.*${amount}`) })).toBeVisible();
    await expect(page.getByRole('link', { name: /支出.*6,543円/ })).toHaveCount(0);
  };
  const editUrl = new RegExp(`/transactions/${selectedTransactionId}/edit\\?month=${month}$`);
  const overviewUrl = new RegExp(`/\\?month=${month}$`);
  const listUrl = new RegExp(`/transactions\\?month=${month}$`);

  try {
    await page.goto(`/transactions?month=${month}`);
    await expectSelectedList('4,321円');

    await page
      .locator('[data-slot="transaction-link"]')
      .filter({ hasText: selectedMarker })
      .click();
    await expect(page).toHaveURL(editUrl);
    await expect(page.getByLabel('メモ（任意）')).toHaveValue(selectedMarker);
    await expect(
      page.getByRole('button', { name: '取引を編集 — 戻る', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '取引を編集 — 戻る', exact: true }).click();
    await expect(page).toHaveURL(listUrl);
    await expectSelectedList('4,321円');
    await page
      .locator('[data-slot="transaction-link"]')
      .filter({ hasText: selectedMarker })
      .click();
    await expect(page).toHaveURL(editUrl);

    await page.getByRole('button', { name: '取引を編集 — 戻る', exact: true }).click();
    await page.getByRole('link', { name: '概要', exact: true }).click();
    await expect(page).toHaveURL(overviewUrl);
    await expectSelectedOverview('4,321円');

    await page.getByRole('link', { name: '取引', exact: true }).click();
    await expect(page).toHaveURL(listUrl);
    await expectSelectedList('4,321円');
    await page
      .locator('[data-slot="transaction-link"]')
      .filter({ hasText: selectedMarker })
      .click();
    await expect(page).toHaveURL(editUrl);

    await page.getByRole('button', { name: '取引を編集 — 戻る', exact: true }).click();
    await page.getByRole('link', { name: 'kobako 家計ノート ホーム' }).click();
    await expect(page).toHaveURL(overviewUrl);
    await expectSelectedOverview('4,321円');

    await page.getByRole('link', { name: '取引', exact: true }).click();
    await expect(page).toHaveURL(listUrl);
    await page
      .locator('[data-slot="transaction-link"]')
      .filter({ hasText: selectedMarker })
      .click();
    await expect(page).toHaveURL(editUrl);
    await page.getByLabel('金額').fill('9876');
    await page.getByRole('button', { name: '変更を保存', exact: true }).click();
    await expect(page).toHaveURL(listUrl);
    await expectSelectedList('9,876円');

    await page
      .locator('[data-slot="transaction-link"]')
      .filter({ hasText: selectedMarker })
      .click();
    await expect(page).toHaveURL(editUrl);
    await page.locator('[data-slot="delete-confirm"] > summary').click();
    await expect(page.getByText('この取引を削除しますか？')).toBeVisible();
    await expect(page.getByRole('link', { name: 'キャンセル' })).toHaveAttribute(
      'href',
      `/transactions/${selectedTransactionId}/edit?month=${month}`,
    );
    await page.getByRole('link', { name: 'キャンセル' }).click();
    await expect(page).toHaveURL(editUrl);
    await expect(page.getByLabel('金額')).toHaveValue('9876');
    await expect(page.getByLabel('メモ（任意）')).toHaveValue(selectedMarker);

    await page.getByRole('button', { name: '取引を編集 — 戻る', exact: true }).click();
    await page.getByRole('link', { name: '概要', exact: true }).click();
    await expect(page).toHaveURL(overviewUrl);
    await expectSelectedOverview('9,876円');
  } finally {
    await databaseClient.sql`
      delete from transactions
      where household_id = ${DEFAULT_HOUSEHOLD_ID}
        and (memo = ${selectedMarker} or memo = ${otherMonthMarker})
    `;
  }
});

test('falls back for invalid or absent month URLs without carrying a bogus month', async ({
  page,
}) => {
  const currentMonth = currentTokyoMonth();
  const expectMonthlessLinks = async () => {
    await expect(page.getByRole('link', { name: '概要', exact: true })).toHaveAttribute(
      'href',
      '/',
    );
    await expect(page.getByRole('link', { name: '取引', exact: true })).toHaveAttribute(
      'href',
      '/transactions',
    );
    await expect(page.getByRole('link', { name: '残高', exact: true })).toHaveAttribute(
      'href',
      '/balances',
    );
    await expect(page.getByRole('link', { name: 'kobako 家計ノート ホーム' })).toHaveAttribute(
      'href',
      '/',
    );
  };

  for (const path of ['/?month=2024-13', '/']) {
    await page.goto(path);
    await expect(page.locator('[data-slot="month-switcher-label"]')).toHaveText(
      labelForMonth(currentMonth),
    );
    await expectMonthlessLinks();
  }
  await page.goto('/transactions?month=bad');
  await expect(page.locator('[data-slot="month-switcher-label"]')).toHaveText(
    labelForMonth(currentMonth),
  );
  await expectMonthlessLinks();
});
test('centers transaction detail blocks in the list and overview', async ({ page }) => {
  if (!databaseClient) {
    throw new Error('database client is not initialized');
  }

  const categoryNames = {
    short: '食費テスト',
    long: `${markerFor('vertical-category')} 長いカテゴリ名折返し確認`,
  };
  const accountNames = {
    short: 'Suica試験',
    long: `${markerFor('vertical-long')} とても長い資産名を折り返して確認する口座`,
    fromShort: 'Wallet試験',
    toShort: 'Bank試験',
    fromLong: `${markerFor('vertical-from-long')} とても長い振替元資産名を折り返して確認`,
    toLong: `${markerFor('vertical-to-long')} とても長い振替先資産名を折り返して確認`,
  };
  const accountRows = await databaseClient.sql`
    insert into accounts (household_id, name, kind, asset_category_id)
    values
      (
        ${DEFAULT_HOUSEHOLD_ID},
        ${accountNames.short},
        'cash',
        (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'cash')
      ),
      (
        ${DEFAULT_HOUSEHOLD_ID},
        ${accountNames.long},
        'bank',
        (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'bank')
      ),
      (
        ${DEFAULT_HOUSEHOLD_ID},
        ${accountNames.fromShort},
        'bank',
        (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'bank')
      ),
      (
        ${DEFAULT_HOUSEHOLD_ID},
        ${accountNames.toShort},
        'bank',
        (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'bank')
      ),
      (
        ${DEFAULT_HOUSEHOLD_ID},
        ${accountNames.fromLong},
        'bank',
        (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'bank')
      ),
      (
        ${DEFAULT_HOUSEHOLD_ID},
        ${accountNames.toLong},
        'bank',
        (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'bank')
      )
    returning id, name
  `;
  const accountIds = new Map(accountRows.map((row) => [row.name, Number(row.id)]));
  const categoryRows = await databaseClient.sql`
    insert into categories (household_id, type, name, sort_order)
    values
      (${DEFAULT_HOUSEHOLD_ID}, 'expense', ${categoryNames.short}, 97),
      (${DEFAULT_HOUSEHOLD_ID}, 'expense', ${categoryNames.long}, 98)
    returning id, name
  `;
  const categoryIds = new Map(categoryRows.map((row) => [row.name, Number(row.id)]));
  if (
    categoryIds.size !== Object.keys(categoryNames).length ||
    accountIds.size !== Object.keys(accountNames).length
  ) {
    throw new Error('vertical-centering fixtures were not created');
  }
  const categoryIdFor = (name: string): number => {
    const id = categoryIds.get(name);
    if (id === undefined || !Number.isInteger(id)) {
      throw new Error(`vertical-centering category fixture is missing: ${name}`);
    }
    return id;
  };
  const accountIdFor = (name: string): number => {
    const id = accountIds.get(name);
    if (id === undefined || !Number.isInteger(id)) {
      throw new Error(`vertical-centering account fixture is missing: ${name}`);
    }
    return id;
  };

  const transactionRows = await databaseClient.sql`
    insert into transactions (
      household_id, type, amount, occurred_on, category_id, account_id, memo
    )
    values
      (
        ${DEFAULT_HOUSEHOLD_ID},
        'expense',
        1000,
        ${`${month}-10`},
        ${categoryIdFor(categoryNames.short)},
        ${accountIdFor(accountNames.short)},
        ''
      ),
      (
        ${DEFAULT_HOUSEHOLD_ID},
        'expense',
        2000,
        ${`${month}-11`},
        ${categoryIdFor(categoryNames.long)},
        ${accountIdFor(accountNames.long)},
        ''
      ),
      (
        ${DEFAULT_HOUSEHOLD_ID},
        'expense',
        3000,
        ${`${month}-12`},
        ${categoryIdFor(categoryNames.short)},
        ${accountIdFor(accountNames.short)},
        ${`${markerFor('vertical-memo')} ${'折り返し確認用の長いメモ '.repeat(5)}`}
      ),
      (
        ${DEFAULT_HOUSEHOLD_ID},
        'expense',
        4000,
        ${`${month}-17`},
        ${categoryIdFor(categoryNames.long)},
        ${accountIdFor(accountNames.long)},
        ${`${markerFor('vertical-long-memo')} ${'長い口座名と一緒に折り返すメモ '.repeat(5)}`}
      ),
      (
        ${DEFAULT_HOUSEHOLD_ID},
        'expense',
        5000,
        ${`${month}-18`},
        ${categoryIdFor(categoryNames.short)},
        ${accountIdFor(accountNames.short)},
        ''
      )
    returning id
  `;
  const transferRows = await databaseClient.sql`
    insert into transfers (
      household_id, from_account_id, to_account_id, amount, occurred_on, memo
    )
    values
      (
        ${DEFAULT_HOUSEHOLD_ID},
        ${accountIdFor(accountNames.fromShort)},
        ${accountIdFor(accountNames.toShort)},
        4000,
        ${`${month}-13`},
        ''
      ),
      (
        ${DEFAULT_HOUSEHOLD_ID},
        ${accountIdFor(accountNames.fromShort)},
        ${accountIdFor(accountNames.toShort)},
        5000,
        ${`${month}-14`},
        ${`${markerFor('vertical-transfer-memo')} ${'折り返し確認用の長い振替メモ '.repeat(5)}`}
      ),
      (
        ${DEFAULT_HOUSEHOLD_ID},
        ${accountIdFor(accountNames.fromLong)},
        ${accountIdFor(accountNames.toLong)},
        6000,
        ${`${month}-15`},
        ''
      ),
      (
        ${DEFAULT_HOUSEHOLD_ID},
        ${accountIdFor(accountNames.fromLong)},
        ${accountIdFor(accountNames.toLong)},
        7000,
        ${`${month}-16`},
        ${`${markerFor('vertical-transfer-long-memo')} ${'折り返し確認用の長い振替メモ '.repeat(5)}`}
      )
    returning id
  `;
  const transactionIds = transactionRows.map((row) => Number(row.id));
  const transferIds = transferRows.map((row) => Number(row.id));

  const assertCenteredRows = async (
    path: string,
    expectedRowCount: number,
    expectedTransferCount: number,
  ) => {
    await page.goto(path);
    const rowSelector = [
      ...transactionIds.map(
        (id) => `[data-slot="transaction-link"][href^="/transactions/${id}/edit"]`,
      ),
      ...transferIds.map(
        (id) => `[data-slot="transaction-link"][href^="/transactions/transfers/${id}/edit"]`,
      ),
    ].join(',');
    const rows = page.locator(rowSelector);
    await expect(rows).toHaveCount(expectedRowCount);
    await expect(rows.locator('[data-slot="transaction-main-transfer"]')).toHaveCount(
      expectedTransferCount,
    );
    const geometries = await rows.evaluateAll((elements) =>
      elements.map((row) => {
        const box = (selector: string) => {
          const element = row.querySelector<HTMLElement>(selector);
          const bounds = element?.getBoundingClientRect();
          return bounds
            ? {
                center: bounds.y + bounds.height / 2,
                height: bounds.height,
              }
            : undefined;
        };
        const rowBounds = row.getBoundingClientRect();
        return {
          row: {
            center: rowBounds.y + rowBounds.height / 2,
            height: rowBounds.height,
          },
          main: box('[data-slot="transaction-main"], [data-slot="transaction-main-transfer"]'),
          category: box('[data-slot="transaction-category"]'),
          dot: box('[data-slot="category-dot"]'),
          amount: box('[data-slot="record-amount"]'),
          affordance: box('[data-slot="row-affordance"]'),
        };
      }),
    );
    for (const geometry of geometries) {
      expect(geometry.row).toBeDefined();
      expect(geometry.main).toBeDefined();
      expect(geometry.category).toBeDefined();
      expect(geometry.dot).toBeDefined();
      expect(geometry.amount).toBeDefined();
      // One CSS pixel accommodates fractional layout rounding without hiding a real offset.
      expect(Math.abs(geometry.main!.center - geometry.category!.center)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.main!.center - geometry.dot!.center)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.main!.center - geometry.amount!.center)).toBeLessThanOrEqual(1);
      if (geometry.affordance) {
        expect(Math.abs(geometry.main!.center - geometry.affordance.center)).toBeLessThanOrEqual(1);
      }
    }
    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  };

  try {
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
      await assertCenteredRows(`/transactions?month=${month}`, 9, 4);
      await assertCenteredRows(`/?month=${month}`, 5, 0);
    }
  } finally {
    await databaseClient.sql`delete from transfers where id = any(${transferIds})`;
    await databaseClient.sql`delete from transactions where id = any(${transactionIds})`;
    await databaseClient.sql`delete from categories where id = any(${[...categoryIds.values()]})`;
    await databaseClient.sql`delete from accounts where id = any(${[...accountIds.values()]})`;
  }
});

test('keeps shared chrome aligned across viewports and wraps long content', async ({ page }) => {
  if (!databaseClient) {
    throw new Error('database client is not initialized');
  }

  const categoryName = `長いカテゴリ名-${runId}-折り返し確認用`;
  const memo = `${markerFor('layout-long')} / ${'長いメモ '.repeat(24)}`;
  const accountName = `${markerFor('layout-account')} / 銀行`;
  const accountRows = await databaseClient.sql`
    insert into accounts (household_id, name, kind, asset_category_id)
    values (${DEFAULT_HOUSEHOLD_ID}, ${accountName}, 'bank', (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'bank'))
    returning id
  `;
  const accountId = Number(accountRows[0]?.id);
  if (!Number.isInteger(accountId)) {
    throw new Error('long layout account fixture was not created');
  }
  const categoryRows = await databaseClient.sql`
    insert into categories (household_id, type, name, sort_order)
    values (${DEFAULT_HOUSEHOLD_ID}, 'expense', ${categoryName}, 98)
    returning id
  `;
  const categoryId = Number(categoryRows[0]?.id);
  if (!Number.isInteger(categoryId)) {
    throw new Error('long layout category fixture was not created');
  }
  const transactionRows = await databaseClient.sql`
    insert into transactions (household_id, type, amount, occurred_on, category_id, account_id, memo)
    values (
      ${DEFAULT_HOUSEHOLD_ID},
      'expense',
      999999999,
      ${`${month}-17`},
      ${categoryId},
      ${accountId},
      ${memo}
    )
    returning id
  `;
  const transactionId = Number(transactionRows[0]?.id);
  if (!Number.isInteger(transactionId)) {
    throw new Error('long layout transaction fixture was not created');
  }

  const measure = async (selector: string) =>
    page.locator(selector).evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    });
  const assertNoHorizontalOverflow = async () => {
    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  };
  const assertShellGeometry = (
    geometry: { x: number; y: number; width: number },
    viewportWidth: number,
    gutter: number,
    maxWidth: number,
    expectedY: number,
  ) => {
    const expectedWidth = Math.min(viewportWidth - gutter * 2, maxWidth);
    expect(geometry.x).toBeCloseTo((viewportWidth - expectedWidth) / 2, 0);
    expect(geometry.width).toBeCloseTo(expectedWidth, 0);
    expect(geometry.y).toBeCloseTo(expectedY, 0);
  };

  try {
    for (const { width, height } of [
      { width: 320, height: 780 },
      { width: 360, height: 780 },
      { width: 390, height: 844 },
      { width: 414, height: 844 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto(`/?month=${month}`);
      await expect(page.getByRole('heading', { name: '概要' })).toBeVisible();
      const overviewRow = page.locator('[data-slot="transaction-row"]').filter({ hasText: memo });
      await expect(overviewRow).toHaveCount(1);
      await expect(overviewRow.locator('[data-slot="transaction-asset-name"]')).toHaveText(
        accountName,
      );
      await expect(overviewRow.locator('[data-slot="transaction-asset-category"]')).toHaveCount(0);
      await expect(overviewRow.locator('[data-slot="transaction-asset-name"]')).not.toHaveText(
        categoryName,
      );
      await expect(overviewRow.locator('[data-slot="transaction-memo"]')).toContainText(memo);
      const overviewColumns = await overviewRow
        .locator('[data-slot="transaction-link"]')
        .evaluate((row) => {
          const bounds = (selector: string) => {
            const element = row.querySelector<HTMLElement>(selector);
            const rect = element?.getBoundingClientRect();
            return rect ? { left: rect.left, right: rect.right } : undefined;
          };
          return {
            category: bounds('[data-slot="transaction-category"]'),
            assetName: bounds('[data-slot="transaction-asset-name"]'),
            memo: bounds('[data-slot="transaction-memo"]'),
            amount: bounds('[data-slot="record-amount"]'),
          };
        });
      const overviewList = await measure('[data-slot="recent-list"]');
      expect(overviewColumns.category).toBeDefined();
      expect(overviewColumns.assetName).toBeDefined();
      expect(overviewColumns.memo).toBeDefined();
      expect(overviewColumns.amount).toBeDefined();
      expect(overviewColumns.assetName!.left).toBeGreaterThan(overviewColumns.category!.right);
      expect(overviewColumns.assetName!.left).toBeCloseTo(overviewColumns.memo!.left, 1);
      expect(overviewColumns.amount!.right).toBeCloseTo(overviewList.x + overviewList.width, 1);
      const overviewShell = await measure('[data-slot="page-shell"]');
      const overviewMonth = await measure('[data-slot="month-switcher"]');
      const overviewChevron = await measure('[data-slot="month-switcher"] svg >> nth=0');
      const overviewSummary = page.locator('[role="group"][aria-labelledby="expense-label"]');
      await expect(overviewSummary).toHaveCount(1);
      await expect(overviewSummary.locator('[data-slot="lead-amount"]')).toHaveCount(1);
      await expect(overviewSummary.locator('dl[aria-label] > div')).toHaveCount(2);
      await assertNoHorizontalOverflow();

      await page.goto(`/transactions?month=${month}`);
      await expect(page.getByRole('heading', { name: /取引/ })).toBeVisible();
      const transactionShell = await measure('[data-slot="page-shell"]');
      const transactionHeadingStyles = await page
        .locator('[data-slot="page-header"] h1')
        .evaluate((h1) => {
          const style = getComputedStyle(h1);
          return {
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            letterSpacing: style.letterSpacing,
          };
        });
      const transactionFabMetrics = await page
        .locator('a[aria-label="取引を登録"]')
        .evaluate((link) => {
          const rect = link.getBoundingClientRect();
          return { right: rect.right, width: rect.width, height: rect.height };
        });
      const narrow = width <= 480;
      expect(transactionFabMetrics.width).toBeCloseTo(56, 0);
      expect(transactionFabMetrics.height).toBeCloseTo(56, 0);
      expect(transactionHeadingStyles).toEqual({
        fontSize: narrow ? '21px' : '23px',
        fontWeight: '500',
        lineHeight: narrow ? '24.15px' : '26.45px',
        letterSpacing: narrow ? '-0.63px' : '-0.69px',
      });
      expect(transactionFabMetrics.right).toBeCloseTo(
        narrow ? width - 16 : transactionShell.x + transactionShell.width,
        0,
      );
      const transactionsMonth = await measure('[data-slot="month-switcher"]');
      const transactionsChevron = await measure('[data-slot="month-switcher"] svg >> nth=0');
      assertShellGeometry(overviewShell, width, 16, 61 * 16, 84);
      assertShellGeometry(transactionShell, width, 16, 61 * 16, 84);
      expect(transactionShell.x).toBeCloseTo(overviewShell.x, 0);
      expect(transactionShell.y).toBeCloseTo(overviewShell.y, 0);
      expect(transactionShell.width).toBeCloseTo(overviewShell.width, 0);
      // The 44px arrow targets pad the chevrons inwards, so the row is pulled out by
      // that inset: the chevron lines up with the shell edge, the box starts before it.
      expect(transactionsChevron.x).toBeCloseTo(transactionShell.x, 0);
      expect(transactionsChevron.x).toBeCloseTo(overviewChevron.x, 0);
      expect(transactionsMonth.x).toBeCloseTo(transactionShell.x - 16, 0);
      expect(transactionsMonth.y).toBeCloseTo(overviewMonth.y, 0);
      expect(transactionsMonth.width).toBeCloseTo(overviewMonth.width, 0);
      expect(transactionsMonth.width).toBeCloseTo(168, 0);
      await assertNoHorizontalOverflow();
      await expect(
        page.locator('[data-slot="transaction-memo"]').filter({ hasText: memo }),
      ).toBeVisible();
      const layoutRow = page.locator('[data-slot="transaction-link"]').filter({ hasText: memo });
      await expect(layoutRow.locator('[data-slot="transaction-asset-category"]')).toHaveCount(0);
      await expect(layoutRow.locator('[data-slot="record-amount"]')).toHaveText('−999,999,999円');
      const contentMetrics = await layoutRow
        .locator(
          '[data-slot="transaction-category"], [data-slot="transaction-asset-name"], [data-slot="transaction-memo"], [data-slot="record-amount"]',
        )
        .evaluateAll((elements) =>
          elements.map((element) => {
            const style = getComputedStyle(element);
            return {
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
              clientHeight: element.clientHeight,
              scrollHeight: element.scrollHeight,
              whiteSpace: style.whiteSpace,
              overflow: style.overflow,
            };
          }),
        );
      for (const metrics of contentMetrics) {
        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
        expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
        expect(metrics.whiteSpace).toBe('normal');
        expect(metrics.overflow).toBe('visible');
      }
      const detailGeometry = await layoutRow.evaluate((row) => {
        const rowBounds = row.getBoundingClientRect();
        const box = (selector: string) => {
          const element = row.querySelector<HTMLElement>(selector);
          const bounds = element?.getBoundingClientRect();
          return bounds
            ? {
                left: bounds.left,
                right: bounds.right,
                center: bounds.y + bounds.height / 2,
                height: bounds.height,
              }
            : undefined;
        };
        const category = box('[data-slot="transaction-category"]');
        const main = box('[data-slot="transaction-main"]');
        const memoBox = box('[data-slot="transaction-memo"]');
        const amount = box('[data-slot="record-amount"]');
        const assetName = box('[data-slot="transaction-asset-name"]');
        return {
          rowCenter: rowBounds.y + rowBounds.height / 2,
          category,
          main,
          memo: memoBox,
          amount,
          assetName,
        };
      });
      expect(detailGeometry.category).toBeDefined();
      expect(detailGeometry.assetName).toBeDefined();
      expect(detailGeometry.main).toBeDefined();
      expect(detailGeometry.memo).toBeDefined();
      expect(detailGeometry.amount).toBeDefined();
      expect(detailGeometry.assetName!.center).toBeDefined();
      expect(detailGeometry.assetName!.left).toBeCloseTo(detailGeometry.memo!.left, 1);
      expect(detailGeometry.assetName!.left).toBeGreaterThan(detailGeometry.category!.right);
      if (width > 320) {
        expect(
          Math.abs(detailGeometry.amount!.center - detailGeometry.rowCenter),
        ).toBeLessThanOrEqual(1);
      } else {
        expect(detailGeometry.amount!.height).toBeGreaterThan(0);
      }

      await page.goto(`/transactions?month=${month}&type=expense&category=${categoryId}`);
      await expect(
        page
          .locator('[data-slot="filter-chip"][data-filter="category"]')
          .getByRole('button', { name: `カテゴリ ${categoryName}`, exact: true }),
      ).toBeVisible();
      await assertNoHorizontalOverflow();
    }
    for (const width of [320, 360, 390, 414, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/transactions?month=${nextMonth}`);
      await expect(page.getByRole('heading', { name: 'この月はまだ空です' })).toBeVisible();
      const emptyDescription = page.locator('[data-slot="empty-state-description"]');
      await expect(emptyDescription).toHaveText('最初の取引を記録すると、ここに並びます。');
      const emptyMetrics = await emptyDescription.evaluate((description) => {
        const style = getComputedStyle(description);
        return {
          height: description.getBoundingClientRect().height,
          lineHeight: Number.parseFloat(style.lineHeight),
          phraseDisplays: Array.from(
            description.querySelectorAll<HTMLElement>('[data-slot="phrase-wrap"]'),
          ).map((phrase) => getComputedStyle(phrase).display),
        };
      });
      expect(emptyMetrics.phraseDisplays).toEqual(['inline-block', 'inline-block']);
      expect(emptyMetrics.height).toBeLessThanOrEqual(emptyMetrics.lineHeight * 2 + 1);
      if (width >= 414) {
        expect(emptyMetrics.height).toBeLessThanOrEqual(emptyMetrics.lineHeight + 1);
      }
      const centers = await Promise.all(
        [
          '[data-slot="empty-state-title"]',
          '[data-slot="empty-state-description"]',
          '[data-slot="empty-state-action"]',
        ].map((selector) =>
          page
            .locator(selector)
            .boundingBox()
            .then((box) => {
              if (!box) {
                throw new Error(`empty state geometry unavailable for ${selector}`);
              }
              return box.x + box.width / 2;
            }),
        ),
      );
      expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
      await assertNoHorizontalOverflow();
    }
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`/?month=${month}`);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await assertNoHorizontalOverflow();
    const sectionHeadingMetrics = await page
      .getByRole('heading', { level: 2 })
      .first()
      .evaluate((heading) => {
        const styles = getComputedStyle(heading);
        return {
          height: heading.getBoundingClientRect().height,
          lineHeight: Number.parseFloat(styles.lineHeight),
        };
      });
    expect(sectionHeadingMetrics.height).toBeLessThanOrEqual(
      sectionHeadingMetrics.lineHeight * 2 + 1,
    );

    await page.goto(`/?month=${month}`);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    const zoomedAmount = page
      .locator('[data-slot="transaction-link"]')
      .filter({ hasText: memo })
      .locator('[data-slot="record-amount"]');
    await expect(zoomedAmount).toHaveText('−999,999,999円');
    const zoomedAmountMetrics = await zoomedAmount.evaluate((element) => ({
      text: element.textContent ?? '',
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(zoomedAmountMetrics.text).toContain('−999,999,999円');
    expect(zoomedAmountMetrics.scrollWidth).toBeLessThanOrEqual(
      zoomedAmountMetrics.clientWidth + 1,
    );
    expect(zoomedAmountMetrics.scrollHeight).toBeLessThanOrEqual(
      zoomedAmountMetrics.clientHeight + 1,
    );
    await assertNoHorizontalOverflow();

    await page.goto('/settings/import');
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await assertNoHorizontalOverflow();
    const importHeadingBox = await page.locator('[data-slot="page-header"] h1').boundingBox();
    const importHeadingLinkBox = await page
      .locator('[data-slot="page-header-title-link"]')
      .boundingBox();
    const importChevronBox = await page
      .locator('[data-slot="page-header-back-chevron"]')
      .boundingBox();
    const dropzoneBox = await page.locator('[data-slot="import-dropzone"]').boundingBox();
    const dropzoneButtonBox = await page
      .locator('[data-slot="import-dropzone"] strong')
      .boundingBox();
    if (
      !importHeadingBox ||
      !importHeadingLinkBox ||
      !importChevronBox ||
      !dropzoneBox ||
      !dropzoneButtonBox
    ) {
      throw new Error('zoomed import geometry is unavailable');
    }
    expect(importHeadingLinkBox.y).toBeLessThanOrEqual(importHeadingBox.y + 1);
    expect(importHeadingLinkBox.y + importHeadingLinkBox.height).toBeGreaterThanOrEqual(
      importHeadingBox.y + importHeadingBox.height - 1,
    );
    expect(importChevronBox.x).toBeLessThanOrEqual(importHeadingLinkBox.x + 20);
    expect(importChevronBox.y).toBeLessThanOrEqual(importHeadingLinkBox.y + 16);
    expect(dropzoneButtonBox.x + dropzoneButtonBox.width).toBeLessThanOrEqual(
      dropzoneBox.x + dropzoneBox.width + 1,
    );
    expect(dropzoneButtonBox.y + dropzoneButtonBox.height).toBeLessThanOrEqual(
      dropzoneBox.y + dropzoneBox.height + 1,
    );
  } finally {
    await databaseClient.sql`delete from transactions where id = ${transactionId}`;
    await databaseClient.sql`delete from categories where id = ${categoryId}`;
    await databaseClient.sql`delete from accounts where id = ${accountId}`;
  }
});

test('opens the month picker from the month label and keeps the running filters', async ({
  page,
  isMobile,
}) => {
  await page.addInitScript(() => {
    const target = HTMLInputElement.prototype as HTMLInputElement & { showPicker?: () => void };
    const original = target.showPicker;
    const calls: string[] = [];
    Object.defineProperty(window, 'pickerCalls', { value: calls, configurable: true });
    if (typeof original !== 'function') return;
    target.showPicker = function (this: HTMLInputElement, ...args: unknown[]) {
      calls.push(this.type);
      return original.apply(this, args as never);
    };
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/?month=${month}`);
  const label = page.locator('[data-slot="month-switcher-label"]');
  // 月はアプリ内の月グリッドで選び、ネイティブのピッカー（showPicker()）は使いません。
  await openMonthPicker(page, label, isMobile);
  await pickMonthInGrid(page, nextMonth, isMobile);
  await expect(page).toHaveURL(
    (url) => url.pathname === '/' && url.searchParams.get('month') === nextMonth,
  );
  await expect(label).toHaveText(nextMonthLabel);

  await page.goto(`/transactions?month=${month}&type=expense`);
  await openMonthPicker(page, label, isMobile);
  await pickMonthInGrid(page, nextMonth, isMobile);
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === '/transactions' &&
      url.searchParams.get('month') === nextMonth &&
      url.searchParams.get('type') === 'expense',
  );
  await expect(label).toHaveText(nextMonthLabel);
  expect(
    await page.evaluate(() => (window as unknown as { pickerCalls: string[] }).pickerCalls),
  ).toEqual([]);
});

test('supports keyboard entry and mobile layout for an ordinary transaction', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/transactions/new?month=${month}`);
  const amount = page.getByLabel('金額');
  const category = page.locator('#transaction-category-expense');
  const memo = page.getByLabel('メモ（任意）');
  await amount.focus();
  await amount.pressSequentially('321');
  await page.keyboard.press('Tab');
  await expect(category).toBeFocused();
  await category.press('Home');
  await category.press('ArrowDown');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(memo).toBeFocused();
  await memo.pressSequentially(markerFor('keyboard-mobile'));
  const dimensions = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  await page.getByRole('button', { name: '登録する' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  const row = page
    .locator('[data-slot="transaction-link"]')
    .filter({ hasText: markerFor('keyboard-mobile') });
  await expect(row).toHaveCount(1);
  await row.click();
  await page.locator('[data-slot="delete-confirm"] > summary').click();
  const deleteCard = page.locator('[data-slot="delete-confirmation"]');
  await expect(deleteCard).toHaveAttribute('data-card-pattern', 'overlay-card');
  await expect(deleteCard.getByRole('heading', { name: 'この取引を削除しますか？' })).toBeVisible();
  const dangerColor = await deleteCard
    .getByRole('button', { name: '削除を確定' })
    .evaluate((button) => getComputedStyle(button).backgroundColor);
  expect(dangerColor).toBe('rgb(168, 79, 69)');
  await page.getByRole('button', { name: '削除を確定' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(
    page
      .locator('[data-slot="transaction-link"]')
      .filter({ hasText: markerFor('keyboard-mobile') }),
  ).toHaveCount(0);
});

test('adds income and updates the difference, then edits and deletes a transaction', async ({
  page,
}) => {
  await page.goto(`/transactions/new?month=${month}`);
  await page.getByText('収入', { exact: true }).click();
  await page.getByLabel('金額').fill('5,000');
  await page.locator('input[name="occurredOn"]').fill(`${month}-20`);
  await selectFieldOption(page.locator('#transaction-category-income'), { label: '給与' });
  await page.getByLabel('メモ（任意）').fill(markerFor('income'));
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await page.goto(`/?month=${month}`);
  await expect(page.getByRole('group', { name: '収入' }).getByText('5,000円')).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'この月の支出' }).locator('[data-slot="lead-amount"]'),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: '収支差額' }).getByText('3,800円')).toBeVisible();

  await page.goto(`/transactions?month=${month}`);
  await page.getByRole('link', { name: /10日/ }).click();
  await page.getByLabel('金額').fill('2,000');
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(page.getByRole('link', { name: /支出.*2,000円/ })).toBeVisible();

  await page.getByRole('link', { name: /10日/ }).click();
  const deleteTrigger = page.locator('[data-slot="delete-confirm"] > summary');
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 375, height: 812 },
  ] satisfies ModalViewport[]) {
    await page.setViewportSize(viewport);
    await assertDeleteAndSaveAligned(page);
    await assertDeleteModalInteraction(page, viewport);
  }
  await deleteTrigger.click();
  await expect(page.getByText('この取引を削除しますか？')).toBeVisible();
  await page.getByRole('link', { name: 'キャンセル' }).click();
  await expect(deleteTrigger).toBeVisible();
  await deleteTrigger.click();
  await page.locator('#delete-transaction-form input[name="confirm"]').evaluate((input) => {
    input.remove();
  });
  await page.getByRole('button', { name: '削除を確定' }).click();
  const errorDialog = page.getByRole('dialog', { name: '入力内容を確認してください' });
  await expect(errorDialog).toContainText('確認操作を完了してください');
  await errorDialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.reload();
  await page.locator('[data-slot="delete-confirm"] > summary').click();
  await page.getByRole('button', { name: '削除を確定' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(page.getByRole('link', { name: /支出.*2,000円/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /収入.*5,000円/ })).toBeVisible();
});

test('requires explicit delete confirmation when JavaScript is disabled', async ({ browser }) => {
  if (!databaseClient) {
    throw new Error('database client is not initialized');
  }
  const categoryRows = await databaseClient.sql`
    select id
    from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and type = 'expense'
    order by id
    limit 1
  `;
  const categoryId = Number(categoryRows[0]?.id);
  if (!Number.isInteger(categoryId)) {
    throw new Error('expense category fixture is missing');
  }
  const memo = markerFor('js-disabled-delete');
  const insertedRows = await databaseClient.sql`
    insert into transactions (household_id, type, amount, occurred_on, category_id, memo)
    values (${DEFAULT_HOUSEHOLD_ID}, 'expense', 321, ${`${month}-28`}, ${categoryId}, ${memo})
    returning id
  `;
  const transactionId = Number(insertedRows[0]?.id);
  if (!Number.isInteger(transactionId)) {
    throw new Error('delete fixture was not created');
  }

  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(`/transactions/${transactionId}/edit`);
    const desktopViewport = { width: 1280, height: 900 } satisfies ModalViewport;
    await page.setViewportSize(desktopViewport);
    let deleteTrigger = page.locator('[data-slot="delete-confirm"] > summary');
    await expect(deleteTrigger).toBeVisible();
    await deleteTrigger.click();
    await expect(page.getByText('この取引を削除しますか？')).toBeVisible();
    await assertDeleteModalGeometry(page, desktopViewport);
    await page.getByRole('link', { name: 'キャンセル' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}/edit`));

    const mobileViewport = { width: 375, height: 812 } satisfies ModalViewport;
    await page.setViewportSize(mobileViewport);
    deleteTrigger = page.locator('[data-slot="delete-confirm"] > summary');
    await deleteTrigger.click();
    await expect(page.getByText('この取引を削除しますか？')).toBeVisible();
    await assertDeleteModalGeometry(page, mobileViewport);
    await page.getByRole('button', { name: '削除を確定' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
    await expect(page.getByRole('link', { name: /支出.*321円/ })).toHaveCount(0);
  } finally {
    await context.close();
    await databaseClient.sql`delete from transactions where id = ${transactionId}`;
  }
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
    const categorySelect = page.locator('#transaction-category-expense');
    await expect(categorySelect).toContainText('不明なカテゴリ');
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
  await selectFieldOption(page.locator('#transaction-category-expense'), { label: '日用品' });
  await page.getByLabel('メモ（任意）').fill(markerFor('next-month'));
  await page.getByRole('button', { name: '登録する' }).click();

  await page.goto(`/?month=${month}`);
  await expect(page.getByText('700円')).toHaveCount(0);
  await expect(page.getByRole('group', { name: '収入' }).getByText('5,000円')).toBeVisible();

  await page.goto(`/transactions?month=${month}`);
  await expect(page.getByRole('link', { name: /700円/ })).toHaveCount(0);

  await page.goto(`/?month=${nextMonth}`);
  await expect(page.getByRole('heading', { name: '概要' })).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'この月の支出' }).locator('[data-slot="lead-amount"]'),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: '収入' }).getByText('0円')).toBeVisible();

  await page.goto(`/transactions?month=${nextMonth}`);
  const rows = page.getByRole('list', { name: '取引' }).getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('700円');

  await page.goto(`/?month=${month}`);
  await page.getByRole('link', { name: '翌月' }).click();
  await expect(page.locator('[data-slot="month-switcher-label"]')).toHaveText(nextMonthLabel);
});

test('applies chip filters immediately and clears filtered empty states', async ({ page }) => {
  if (!databaseClient) {
    throw new Error('ledger filter database is not initialized');
  }
  const [incomeCategory] = await databaseClient.sql<{ id: number }[]>`
    select id
    from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and type = 'income' and name = '給与'
    limit 1
  `;
  const [expenseCategory] = await databaseClient.sql<{ id: number }[]>`
    select id
    from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and type = 'expense' and name = '食費'
    limit 1
  `;
  if (!incomeCategory || !expenseCategory) {
    throw new Error('ledger filter category fixtures are missing');
  }
  const [incomeRow] = await databaseClient.sql<{ id: number }[]>`
    insert into transactions (household_id, type, amount, occurred_on, category_id, memo)
    values (
      ${DEFAULT_HOUSEHOLD_ID}, 'income', 5000, ${`${month}-20`},
      ${incomeCategory.id}, ${markerFor('native-filter-income')}
    )
    returning id
  `;
  if (!incomeRow) {
    throw new Error('ledger filter income fixture was not created');
  }
  try {
    await page.goto(`/transactions?month=${month}`);
    const typeChip = page.locator('[data-slot="filter-chip"][data-filter="type"]');
    await typeChip.getByRole('button', { name: '種別', exact: true }).click();
    await page
      .getByRole('menu', { name: '種別' })
      .getByRole('menuitemradio', { name: '収入', exact: true })
      .click();
    await expect(page).toHaveURL(
      (url) => url.pathname === '/transactions' && url.searchParams.get('type') === 'income',
    );
    await expect(typeChip.getByRole('button', { name: '種別 収入', exact: true })).toBeVisible();
    await expect(
      page
        .getByRole('list', { name: '取引', exact: true })
        .getByRole('listitem')
        .filter({ hasText: markerFor('native-filter-income') }),
    ).toHaveCount(1);

    const categoryChip = page.locator('[data-slot="filter-chip"][data-filter="category"]');
    await categoryChip.getByRole('button', { name: 'カテゴリ', exact: true }).click();
    const categoryMenu = page.getByRole('menu', { name: 'カテゴリ' });
    await expect(categoryMenu.getByRole('group', { name: '収入' })).toBeVisible();
    await expect(categoryMenu.getByRole('group', { name: '支出' })).toHaveCount(0);
    await expect(
      categoryMenu.getByRole('menuitemradio', { name: '給与', exact: true }),
    ).toBeVisible();
    await categoryMenu.getByRole('menuitemradio', { name: '給与', exact: true }).click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === '/transactions' &&
        url.searchParams.get('type') === 'income' &&
        url.searchParams.get('category') === String(incomeCategory.id),
    );
    await expect(
      categoryChip.getByRole('button', { name: 'カテゴリ 給与', exact: true }),
    ).toBeVisible();

    const clear = page.locator('[data-slot="filter-clear"]');
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(page).toHaveURL(`/transactions?month=${month}`);

    await page.goto(`/transactions?month=${month}&type=income&category=${expenseCategory.id}`);
    await expect(page.getByRole('heading', { name: '条件に合う記録がありません' })).toBeVisible();
    await expect(page.getByRole('list', { name: '取引', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-slot="filter-clear"]')).toBeVisible();
    await page.getByRole('link', { name: '条件をクリア', exact: true }).click();
    await expect(page).toHaveURL(`/transactions?month=${month}`);
  } finally {
    await databaseClient.sql`delete from transactions where id = ${incomeRow.id}`;
  }
});

test('saves and displays zero and negative amounts', async ({ page }) => {
  await page.goto(`/transactions/new?month=${month}`);
  await page.getByLabel('金額').fill('0');
  await page.locator('input[name="occurredOn"]').fill(`${month}-26`);
  await selectFieldOption(page.locator('#transaction-category-expense'), { label: '食費' });
  await page.getByLabel('メモ（任意）').fill(markerFor('zero'));
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(page.getByRole('link', { name: /支出.*0円/ })).toBeVisible();

  await page.goto(`/transactions/new?month=${month}`);
  await page.getByLabel('金額').fill('-1200');
  await page.locator('input[name="occurredOn"]').fill(`${month}-27`);
  await selectFieldOption(page.locator('#transaction-category-expense'), { label: '食費' });
  await page.getByLabel('メモ（任意）').fill(markerFor('negative'));
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(page.getByRole('link', { name: /支出.*＋1,200円/ })).toBeVisible();
});

test('rejects invalid amount input without stripping and shows an accessible format popup', async ({
  page,
}) => {
  await page.goto(`/transactions/new?month=${month}`);
  const amount = page.getByLabel('金額');
  await amount.fill('1,200');
  await expect(amount).toHaveValue('1,200');

  await amount.press('a');
  await expect(amount).toHaveValue('1,200');
  await expect(page.locator('#transaction-amount-format-error')).toContainText(
    '整数で入力してください',
  );

  for (const invalidValue of ['1.5', '1.', '.5', '1e3', '12abc', '1-2', '--2', '1_200']) {
    await amount.fill(invalidValue);
    await expect(amount).toHaveValue('1,200');
    const error = page.locator('#transaction-amount-format-error');
    await expect(error).toContainText('整数で入力してください');
    await expect(error).toHaveAttribute('id', 'transaction-amount-format-error');
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(amount).toHaveAttribute('aria-invalid', 'true');
    await expect(amount).toHaveAttribute('aria-describedby', 'transaction-amount-format-error');
  }

  await amount.fill('-');
  await expect(amount).toHaveValue('-');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(/\/transactions\/new\?month=/);
  await expect(page.locator('#transaction-amount-format-error')).toContainText(
    '整数で入力してください',
  );
  await page.getByRole('dialog').getByRole('button', { name: '閉じる' }).click();
  await amount.fill('-1,200');
  await expect(amount).toHaveValue('-1,200');
  await expect(page.locator('#transaction-amount-format-error')).toHaveCount(0);
  for (const selector of [
    '[data-slot="amount-field-value"]',
    '[data-slot="category-field-value-expense"]',
    '[data-slot="date-field-value"]',
    '[data-slot="memo-field-value"]',
  ]) {
    const valueBox = await page.locator(selector).boundingBox();
    const controlBox = await page
      .locator(
        `${selector} > input, ${selector} > select, ${selector} > textarea, ${selector} > button, ${selector} [data-slot="date-picker-display"]`,
      )
      .first()
      .boundingBox();
    if (!valueBox || !controlBox) {
      throw new Error(`value control is not measurable: ${selector}`);
    }
    expect(controlBox.width).toBeCloseTo(valueBox.width, 1);
  }
});

test('centers and auto-grows the memo field up to five lines', async ({ page }) => {
  await page.goto(`/transactions/new?month=${month}`);

  const memo = page.locator('#transaction-memo');
  const memoRow = page.locator('[data-slot="memo-field"]');
  const categoryRow = page.locator('[data-slot="category-field-expense"]');
  const measureMemo = () =>
    memoRow.evaluate((field) => {
      const label = field.querySelector('label');
      const textarea = field.querySelector('textarea');
      if (!label || !textarea) {
        throw new Error('memo field controls are not measurable');
      }
      const labelBox = label.getBoundingClientRect();
      const textareaBox = textarea.getBoundingClientRect();
      const style = getComputedStyle(textarea);
      return {
        rowHeight: field.getBoundingClientRect().height,
        labelCenter: labelBox.top + labelBox.height / 2,
        textareaCenter: textareaBox.top + textareaBox.height / 2,
        textareaHeight: textareaBox.height,
        clientHeight: textarea.clientHeight,
        scrollHeight: textarea.scrollHeight,
        lineHeight: Number.parseFloat(style.lineHeight),
        padding: Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom),
      };
    });

  const emptyMetrics = await measureMemo();
  const categoryBox = await categoryRow.boundingBox();
  if (!categoryBox) {
    throw new Error('category row is not measurable');
  }
  expect(Math.abs(emptyMetrics.rowHeight - categoryBox.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(emptyMetrics.labelCenter - emptyMetrics.textareaCenter)).toBeLessThanOrEqual(1);

  const threeLineMemo = 'one\ntwo\nthree';
  await memo.fill(threeLineMemo);
  await expect
    .poll(async () => (await measureMemo()).textareaHeight)
    .toBeGreaterThan(emptyMetrics.textareaHeight);
  const threeLineMetrics = await measureMemo();
  expect(threeLineMetrics.rowHeight).toBeGreaterThan(emptyMetrics.rowHeight);
  expect(
    Math.abs(threeLineMetrics.labelCenter - threeLineMetrics.textareaCenter),
  ).toBeLessThanOrEqual(1);
  await expect(memo).toHaveValue(threeLineMemo);

  const tenLineMemo = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n');
  await memo.fill(tenLineMemo);
  await expect
    .poll(async () => {
      const metrics = await measureMemo();
      return metrics.scrollHeight - metrics.clientHeight;
    })
    .toBeGreaterThan(0);
  const maxMetrics = await measureMemo();
  expect(maxMetrics.scrollHeight).toBeGreaterThan(maxMetrics.clientHeight);
  expect(
    Math.abs(maxMetrics.clientHeight - (maxMetrics.lineHeight * 5 + maxMetrics.padding)),
  ).toBeLessThanOrEqual(2);
  expect(Math.abs(maxMetrics.labelCenter - maxMetrics.textareaCenter)).toBeLessThanOrEqual(1);
  await expect(memo).toHaveValue(tenLineMemo);
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
      const row = page.locator('[data-slot="amount-field"]');
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
  const row = page.locator('[data-slot="amount-field"]');
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
  expect(errorColor).toBe('rgb(163, 58, 54)');
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

test('keeps the date picker tab stop visible and saves after picking a date', async ({ page }) => {
  await page.goto(`/transactions/new?month=${month}`);
  const amount = page.getByLabel('金額');
  const category = page.locator('#transaction-category-expense');
  const account = page.getByLabel('資産', { exact: true });
  const dateDisplay = page.locator('[data-slot="date-picker-display"]');
  const memo = page.getByLabel('メモ（任意）');
  await amount.focus();

  await page.keyboard.press('Tab');
  await expect(category).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(account).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dateDisplay).toBeFocused();
  const dateInput = page.locator('input[type="date"][name="occurredOn"]');
  await expect(dateInput).toHaveJSProperty('tabIndex', -1);
  const dateBox = await dateDisplay.boundingBox();
  if (!dateBox || dateBox.width === 0 || dateBox.height === 0) {
    throw new Error('date picker display is not visible');
  }
  await page.keyboard.press('Tab');
  await expect(memo).toBeFocused();

  const pickedDate = `${month}-03`;
  await dateInput.fill(pickedDate);
  await expect(dateDisplay).toContainText(pickedDate.replaceAll('-', '/'));
  await amount.fill('432');
  await selectFieldOption(category, { label: '食費' });
  await memo.fill(markerFor('date-tab-save'));
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(page.getByRole('link', { name: /支出.*432円/ })).toBeVisible();
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
  const expectedMonth = labelForMonth(month);
  try {
    await page.goto(`/transactions/new?month=${month}`);
    const dateInput = page.locator('input[type="date"][name="occurredOn"]');
    await expect(page.locator('[data-slot="date-picker-display"]')).toContainText(initialDate);
    await dateInput.fill(day);
    await expect(page.locator('[data-slot="date-picker-display"]')).toContainText(expectedDate);
    await page.getByLabel('金額').fill('321');
    await selectFieldOption(page.locator('#transaction-category-expense'), { label: '食費' });
    await page.getByLabel('メモ（任意）').fill(markerFor('locale-date'));
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
    await expect(page.locator('[data-slot="month-switcher-label"]')).toHaveText(expectedMonth);
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
