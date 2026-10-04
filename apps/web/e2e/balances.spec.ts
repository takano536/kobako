import { randomUUID } from 'node:crypto';

import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  DEFAULT_HOUSEHOLD_ID,
  assertSafeTestDatabaseTarget,
  createDatabaseClient,
  initializeDefaultLedger,
  verifySafeTestDatabaseConnection,
  type DatabaseClient,
  type DatabaseTarget,
} from '@kobako/db';

import { E2E_MARKER_PREFIX, assertCleanupMarker } from './e2e-safety';

const runId = randomUUID();
const markerPrefix = `${E2E_MARKER_PREFIX}${runId}:balances:`;
const month = '9998-12';
const longAccountName = `${markerPrefix}very long account name that wraps`;
const destinationAccountName = `${markerPrefix}destination account`;
const screenshotDirectory = '.tmp/screenshots';
const summaryFixtureUnit = 999_999_999;
const summaryFixtureAssetRows = 1_001;
const summaryFixtureLiabilityRows = 3_003;
const summaryFixtureAssetAccountName = `${markerPrefix}trillion-scale asset account`;
const summaryFixtureSecondAssetAccountName = `${markerPrefix}trillion-scale second asset`;
const summaryFixtureLiabilityAccountName = `${markerPrefix}trillion-scale liability account`;
const summaryFixtureFillerAccountNames = Array.from(
  { length: 24 },
  (_, index) => `${markerPrefix}filler account ${String(index + 1).padStart(2, '0')}`,
);
const summaryFixtureAssetBalance = (
  BigInt(summaryFixtureUnit) * BigInt(summaryFixtureAssetRows)
).toString();
const summaryFixtureAssets = (BigInt(summaryFixtureAssetBalance) * 2n).toString();
const summaryFixtureLiabilities = (
  BigInt(summaryFixtureUnit) * BigInt(summaryFixtureLiabilityRows)
).toString();
const summaryFixtureNet = (
  BigInt(summaryFixtureAssets) - BigInt(summaryFixtureLiabilities)
).toString();
const formatFixtureAmount = (value: string): string => value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const summaryFixtureAssetsDisplay = formatFixtureAmount(summaryFixtureAssets);
const summaryFixtureLiabilitiesDisplay = formatFixtureAmount(summaryFixtureLiabilities);
const summaryFixtureNetMagnitudeDisplay = formatFixtureAmount(
  (-BigInt(summaryFixtureNet)).toString(),
);

let databaseClient: DatabaseClient | undefined;
let developmentUrl: string | undefined;
let databaseTarget: DatabaseTarget;

function database(): DatabaseClient {
  if (!databaseClient) {
    throw new Error('balances E2E database is not initialized');
  }
  return databaseClient;
}

function balanceList(page: Page): Locator {
  return page.getByRole('list', { name: /資産別残高/ }).first();
}

function summaryAmount(page: Page, label: string): Locator {
  return page
    .locator('.balance-summary-item')
    .filter({ has: page.locator('.balance-summary-label', { hasText: new RegExp(`^${label}$`) }) })
    .locator('.balance-summary-value');
}

async function expectBalanceSummary(
  page: Page,
  values: { assets: string; liabilities: string; net: string },
): Promise<void> {
  for (const [label, value] of Object.entries({
    資産: values.assets,
    負債: values.liabilities,
    純資産: values.net,
  })) {
    const amount = summaryAmount(page, label);
    await expect(amount).toContainText(`${value.replace(/^−/, '')}円`);
    if (value.startsWith('−')) {
      await expect(amount.locator('.sr-only')).toHaveText('マイナス');
    }
  }
}

async function captureSharedGeometry(page: Page, name: string): Promise<void> {
  const geometry = await page.evaluate(() => {
    const rectangle = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      header: rectangle('.site-header'),
      nav: rectangle('.site-nav'),
      content: rectangle('.page-content'),
      shell: rectangle('.page-shell'),
      pageHeader: rectangle('.page-header'),
      h1: rectangle('.page-header h1'),
    };
  });
  console.log(`BALANCES_GEOMETRY ${name} ${JSON.stringify(geometry)}`);
}

function accountRow(page: Page, accountName: string): Locator {
  return balanceList(page).getByRole('listitem').filter({ hasText: accountName });
}

async function expectAccountBalance(
  page: Page,
  accountName: string,
  amount: string,
): Promise<void> {
  const row = accountRow(page, accountName);
  await expect(row).toHaveCount(1);
  const balance = row.locator('.balance-amount');
  await expect(balance).toContainText(amount.replace(/^−/, ''));
  if (amount.startsWith('−')) {
    await expect(balance.locator('.sr-only')).toHaveText('マイナス');
  }
}

async function openBalances(page: Page): Promise<void> {
  await page.getByRole('link', { name: '残高', exact: true }).click();
  await expect(page).toHaveURL(/\/balances$/);
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

async function expectStickyBalanceSummary(page: Page): Promise<void> {
  const summary = page.locator('.balance-summary');
  await expect(summary).toHaveCSS('position', 'sticky');
  await expect(page.locator('.balances-note')).toHaveCount(0);

  const initialGeometry = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.site-header');
    const summary = document.querySelector<HTMLElement>('.balance-summary');
    if (!header || !summary) {
      throw new Error('balance summary geometry elements are missing');
    }
    return {
      headerBottom: header.getBoundingClientRect().bottom,
      summaryTop: summary.getBoundingClientRect().top,
    };
  });
  expect(initialGeometry.summaryTop).toBeGreaterThanOrEqual(initialGeometry.headerBottom);
  const viewportWidth = page.viewportSize()?.width ?? 0;
  const stickyHeight = await summary.evaluate((element) => element.getBoundingClientRect().height);
  console.log(`BALANCE_STICKY_HEIGHT ${viewportWidth} ${stickyHeight}`);
  if (viewportWidth <= 390) {
    expect(stickyHeight).toBeLessThanOrEqual(90);
  }

  await page.evaluate(() => {
    document.body.style.minHeight = '200vh';
    const summary = document.querySelector<HTMLElement>('.balance-summary');
    if (!summary) {
      throw new Error('balance summary is missing');
    }
    window.scrollTo(0, summary.getBoundingClientRect().top + window.scrollY);
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector<HTMLElement>('.balance-summary')?.getBoundingClientRect().top,
      ),
    )
    .toBeGreaterThanOrEqual(-1);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector<HTMLElement>('.balance-summary')?.getBoundingClientRect().top,
      ),
    )
    .toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    document.body.style.minHeight = '';
    window.scrollTo(0, 0);
  });
}
async function expectSummaryValuesFit(page: Page): Promise<void> {
  const values = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.balance-summary-value')).map((value) => ({
      clientWidth: value.clientWidth,
      scrollWidth: value.scrollWidth,
      height: value.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(value).lineHeight),
      whiteSpace: getComputedStyle(value).whiteSpace,
    })),
  );
  expect(values).toHaveLength(3);
  for (const value of values) {
    expect(value.whiteSpace).toBe('nowrap');
    expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth + 1);
    expect(value.height).toBeLessThanOrEqual(value.lineHeight + 1);
  }
}
async function expectAccountValuesFit(page: Page): Promise<void> {
  const values = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.balance-amount')).map((value) => ({
      clientWidth: value.clientWidth,
      scrollWidth: value.scrollWidth,
      whiteSpace: getComputedStyle(value).whiteSpace,
    })),
  );
  expect(values.length).toBeGreaterThan(0);
  for (const value of values) {
    expect(value.whiteSpace).toBe('nowrap');
    expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth + 1);
  }
}

async function seedAccounts(): Promise<{ longAccountId: number; destinationAccountId: number }> {
  const client = database();
  const rows = await client.sql<{ id: number; name: string }[]>`
    insert into accounts (household_id, name, kind)
    values
      (${DEFAULT_HOUSEHOLD_ID}, ${longAccountName}, 'other'),
      (${DEFAULT_HOUSEHOLD_ID}, ${destinationAccountName}, 'other')
    returning id, name
  `;
  const longAccount = rows.find((account) => account.name === longAccountName);
  const destinationAccount = rows.find((account) => account.name === destinationAccountName);
  if (!longAccount || !destinationAccount) {
    throw new Error('balances E2E account fixtures were not created');
  }
  return { longAccountId: longAccount.id, destinationAccountId: destinationAccount.id };
}

async function seedOrdinaryTransaction(accountId: number): Promise<number> {
  const client = database();
  const categories = await client.sql<{ id: number }[]>`
    select id
    from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and type = 'expense'
    order by id
    limit 1
  `;
  const category = categories[0];
  if (!category) {
    throw new Error('balances E2E expense category fixture was not created');
  }
  const rows = await client.sql<{ id: number }[]>`
    insert into transactions (
      household_id,
      type,
      amount,
      occurred_on,
      category_id,
      account_id,
      memo
    )
    values (
      ${DEFAULT_HOUSEHOLD_ID},
      'expense',
      500,
      ${`${month}-01`},
      ${category.id},
      ${accountId},
      ${`${markerPrefix}ordinary-create`}
    )
    returning id
  `;
  const transaction = rows[0];
  if (!transaction) {
    throw new Error('balances E2E ordinary transaction fixture was not created');
  }
  return transaction.id;
}
async function seedTrillionScaleBalances(): Promise<void> {
  const client = database();
  const accountNames = [
    summaryFixtureAssetAccountName,
    summaryFixtureSecondAssetAccountName,
    summaryFixtureLiabilityAccountName,
    ...summaryFixtureFillerAccountNames,
  ];
  const accountIds = new Map<string, number>();
  for (const accountName of accountNames) {
    const rows = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name, kind)
      values (${DEFAULT_HOUSEHOLD_ID}, ${accountName}, 'other')
      returning id
    `;
    const account = rows[0];
    if (!account) {
      throw new Error(`balances E2E account fixture was not created: ${accountName}`);
    }
    accountIds.set(accountName, account.id);
  }

  const categories = await client.sql<{ id: number; type: 'expense' | 'income' }[]>`
    select id, type
    from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and type in ('expense', 'income')
    order by id
  `;
  const incomeCategory = categories.find((category) => category.type === 'income');
  const expenseCategory = categories.find((category) => category.type === 'expense');
  const firstAssetAccountId = accountIds.get(summaryFixtureAssetAccountName);
  const secondAssetAccountId = accountIds.get(summaryFixtureSecondAssetAccountName);
  const liabilityAccountId = accountIds.get(summaryFixtureLiabilityAccountName);
  if (
    !incomeCategory ||
    !expenseCategory ||
    !firstAssetAccountId ||
    !secondAssetAccountId ||
    !liabilityAccountId
  ) {
    throw new Error('balances E2E trillion-scale fixtures were not created');
  }

  await client.sql`
    insert into transactions (
      household_id,
      type,
      amount,
      occurred_on,
      category_id,
      account_id,
      memo
    )
    select
      ${DEFAULT_HOUSEHOLD_ID},
      'income',
      ${summaryFixtureUnit},
      ${`${month}-01`},
      ${incomeCategory.id},
      ${firstAssetAccountId},
      ${`${markerPrefix}trillion-asset-a-`} || series.row_number::text
    from generate_series(1, ${summaryFixtureAssetRows}) as series(row_number)
  `;
  await client.sql`
    insert into transactions (
      household_id,
      type,
      amount,
      occurred_on,
      category_id,
      account_id,
      memo
    )
    select
      ${DEFAULT_HOUSEHOLD_ID},
      'income',
      ${summaryFixtureUnit},
      ${`${month}-02`},
      ${incomeCategory.id},
      ${secondAssetAccountId},
      ${`${markerPrefix}trillion-asset-b-`} || series.row_number::text
    from generate_series(1, ${summaryFixtureAssetRows}) as series(row_number)
  `;
  await client.sql`
    insert into transactions (
      household_id,
      type,
      amount,
      occurred_on,
      category_id,
      account_id,
      memo
    )
    select
      ${DEFAULT_HOUSEHOLD_ID},
      'expense',
      ${summaryFixtureUnit},
      ${`${month}-03`},
      ${expenseCategory.id},
      ${liabilityAccountId},
      ${`${markerPrefix}trillion-liability-`} || series.row_number::text
    from generate_series(1, ${summaryFixtureLiabilityRows}) as series(row_number)
  `;
}

async function cleanupBalances(): Promise<void> {
  const client = database();
  await verifySafeTestDatabaseConnection(client.sql, databaseTarget, developmentUrl);
  await client.sql`
    delete from transfers
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and memo like ${`${markerPrefix}%`}
  `;
  await client.sql`
    delete from transactions
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and memo like ${`${markerPrefix}%`}
  `;
  await client.sql`
    delete from accounts
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and name like ${`${markerPrefix}%`}
  `;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const safeTarget = assertSafeTestDatabaseTarget();
  databaseTarget = safeTarget.target;
  developmentUrl = process.env.DATABASE_URL;
  databaseClient = createDatabaseClient(safeTarget.url);
  await verifySafeTestDatabaseConnection(databaseClient.sql, databaseTarget, developmentUrl);
  await initializeDefaultLedger(databaseClient.db);
});

test.afterAll(async () => {
  if (!databaseClient) return;
  await cleanupBalances();
  await databaseClient.close();
  databaseClient = undefined;
});

test('reaches balances from navigation and shows a deterministic empty state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const accountCount = await database().sql<{ count: string }[]>`
    select count(*)::text as count
    from accounts
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
  `;
  expect(Number(accountCount[0]?.count ?? '0')).toBe(0);

  await page.goto('/balances');
  await expect(page.getByRole('link', { name: '残高', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '資産がありません' })).toBeVisible();
  await expect(page.getByText('資産を登録すると、ここに残高が表示されます。')).toBeVisible();
  await expectBalanceSummary(page, { assets: '0', liabilities: '0', net: '0' });
  await expectStickyBalanceSummary(page);
  await page.screenshot({
    path: `${screenshotDirectory}/balances-empty-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${screenshotDirectory}/balances-empty-mobile.png`,
    fullPage: true,
  });
});

test('updates balances after UI transaction and transfer mutations', async ({ page }) => {
  const { longAccountId } = await seedAccounts();
  const ordinaryTransactionId = await seedOrdinaryTransaction(longAccountId);

  await page.goto(`/transactions?month=${month}`);
  await openBalances(page);
  await expectAccountBalance(page, longAccountName, '−500円');
  await expectBalanceSummary(page, { assets: '0', liabilities: '500', net: '−500' });
  await expectStickyBalanceSummary(page);
  await expect(
    accountRow(page, destinationAccountName).getByText('分類なし', { exact: true }),
  ).toHaveCount(0);
  await page.goto(`/transactions?month=${month}`);
  await page
    .locator('.transaction-link')
    .filter({ hasText: `${markerPrefix}ordinary-create` })
    .click();
  await page.locator('#transaction-amount').fill('700');
  await page.getByRole('button', { name: '変更を保存', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}$`));
  await openBalances(page);
  await expectAccountBalance(page, longAccountName, '−700円');
  await expectBalanceSummary(page, { assets: '0', liabilities: '700', net: '−700' });
  const editedTransaction = await database().sql<{ accountId: number | null; amount: number }[]>`
    select account_id as "accountId", amount
    from transactions
    where id = ${ordinaryTransactionId} and household_id = ${DEFAULT_HOUSEHOLD_ID}
  `;
  expect(editedTransaction).toEqual([{ accountId: longAccountId, amount: 700 }]);

  await page.goto(`/transactions?month=${month}`);
  await page
    .locator('.transaction-link')
    .filter({ hasText: `${markerPrefix}ordinary-create` })
    .click();
  await page.locator('.delete-confirm > summary').click();
  await page.getByRole('button', { name: '削除を確定', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}$`));
  await openBalances(page);
  await expectAccountBalance(page, longAccountName, '0円');
  await expectBalanceSummary(page, { assets: '0', liabilities: '0', net: '0' });

  await page.goto(`/transactions/new?month=${month}&type=transfer`);
  await page.locator('#transaction-amount').fill('300');
  await page.locator('#transaction-from-account').selectOption({ label: longAccountName });
  await page.locator('#transaction-to-account').selectOption({ label: destinationAccountName });
  await page.locator('#transaction-memo').fill(`${markerPrefix}transfer-create`);
  await page.getByRole('button', { name: '登録する', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}$`));
  await openBalances(page);
  await expectAccountBalance(page, longAccountName, '−300円');
  await expectBalanceSummary(page, { assets: '300', liabilities: '300', net: '0' });
  await expectAccountBalance(page, destinationAccountName, '300円');

  await page.goto(`/transactions?month=${month}`);
  await page
    .locator('.transaction-link')
    .filter({ hasText: `${markerPrefix}transfer-create` })
    .click();
  await page.locator('#transaction-amount').fill('400');
  await page.getByRole('button', { name: '変更を保存', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}$`));
  await openBalances(page);
  await expectAccountBalance(page, longAccountName, '−400円');
  await expectAccountBalance(page, destinationAccountName, '400円');
  await expectBalanceSummary(page, { assets: '400', liabilities: '400', net: '0' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({
    path: `${screenshotDirectory}/balances-data-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await assertNoHorizontalOverflow(page);
  await expectStickyBalanceSummary(page);
  await expect(accountRow(page, longAccountName)).toBeVisible();
  await expect(
    accountRow(page, longAccountName).getByText(longAccountName, { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${screenshotDirectory}/balances-data-mobile.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto(`/transactions?month=${month}`);
  await page
    .locator('.transaction-link')
    .filter({ hasText: `${markerPrefix}transfer-create` })
    .click();
  await page.locator('.delete-confirm > summary').click();
  await page.getByRole('button', { name: '削除を確定', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}$`));
  await openBalances(page);
  await expectAccountBalance(page, longAccountName, '0円');
  await expectAccountBalance(page, destinationAccountName, '0円');
  await expectBalanceSummary(page, { assets: '0', liabilities: '0', net: '0' });
});

test('opens the account-filtered transactions by clicking its name from balances', async ({
  page,
}) => {
  const accountName = `${markerPrefix}account-link`;
  const [category] = await database().sql<{ id: number }[]>`
    select id
    from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and type = 'expense'
    order by id
    limit 1
  `;
  if (!category) throw new Error('balances account-link category fixture was not created');
  const [account] = await database().sql<{ id: number }[]>`
    insert into accounts (
      household_id, name, kind, status, sort_order
    )
    values (
      ${DEFAULT_HOUSEHOLD_ID}, ${accountName}, 'bank', 'active', 500
    )
    returning id
  `;
  if (!account) throw new Error('balances account-link account fixture was not created');
  await database().sql`
    insert into transactions (
      household_id, type, amount, occurred_on, category_id, account_id, memo
    )
    values (
      ${DEFAULT_HOUSEHOLD_ID}, 'expense', 321, ${`${month}-03`},
      ${category.id}, ${account.id}, ${`${markerPrefix}account-link-row`}
    )
  `;

  await page.goto('/balances');
  const row = accountRow(page, accountName);
  await expect(row).toBeVisible();
  await row.getByText(accountName, { exact: true }).click();
  await expect(page).toHaveURL(`/transactions?account=${account.id}&month=all`);
  await expect(page.getByRole('heading', { name: accountName, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '資産の絞り込みを解除', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '資産の絞り込みを解除', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\?month=\d{4}-\d{2}$/);
  await database().sql`
    delete from transactions
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and memo = ${`${markerPrefix}account-link-row`}
  `;
  await database().sql`
    delete from accounts
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and id = ${account.id}
  `;
});

test('captures shared chrome geometry for overview, transactions, and balances', async ({
  page,
}) => {
  for (const viewport of [
    { label: 'desktop', width: 1280, height: 800 },
    { label: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const screen of [
      { name: 'overview', path: '/' },
      { name: 'transactions', path: `/transactions?month=${month}` },
      { name: 'balances-data', path: '/balances' },
    ]) {
      await page.goto(screen.path);
      await captureSharedGeometry(page, `${screen.name}-${viewport.label}`);
      await page.screenshot({
        path: `${screenshotDirectory}/geometry-${screen.name}-${viewport.label}.png`,
        fullPage: true,
      });
      await assertNoHorizontalOverflow(page);
    }
  }
});
test('keeps trillion-scale summary values on one line at narrow mobile widths', async ({
  page,
}) => {
  await seedTrillionScaleBalances();

  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/balances');
    await expectBalanceSummary(page, {
      assets: summaryFixtureAssetsDisplay,
      liabilities: summaryFixtureLiabilitiesDisplay,
      net: `−${summaryFixtureNetMagnitudeDisplay}`,
    });
    await expectSummaryValuesFit(page);
    await expectAccountValuesFit(page);
    await expectStickyBalanceSummary(page);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: `${screenshotDirectory}/balances-trillion-mobile-${width}.png`,
      fullPage: true,
    });
  }
});

test('keeps the balances test marker contract', () => {
  assertCleanupMarker(markerPrefix);
});
