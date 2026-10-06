import { randomUUID } from 'node:crypto';

import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  DEFAULT_HOUSEHOLD_ID,
  assertSafeTestDatabaseTarget,
  createDatabaseClient,
  currentTokyoDate,
  currentTokyoMonth,
  initializeDefaultLedger,
  shiftMonth,
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
const compactSummaryMarker = `${markerPrefix}compact-summary:`;
const compactSummaryAssetAccountName = `${compactSummaryMarker}asset`;
const compactSummaryLiabilityAccountName = `${compactSummaryMarker}liability`;
const compactSummaryAssetTotal = '9876543210';
const compactSummaryLiabilityTotal = '17654321098';
const compactSummaryNet = (
  BigInt(compactSummaryAssetTotal) - BigInt(compactSummaryLiabilityTotal)
).toString();
const compactSummaryAssetsDisplay = formatFixtureAmount(compactSummaryAssetTotal);
const compactSummaryLiabilitiesDisplay = formatFixtureAmount(compactSummaryLiabilityTotal);
const compactSummaryNetDisplay = formatFixtureAmount(compactSummaryNet.slice(1));
const visualSummaryMarker = `${markerPrefix}visual-summary:`;
const visualSummaryAccountNames = ['財布', '普通預金', 'クレジットカード'] as const;
const visualSummaryValues = {
  assets: '200000',
  liabilities: '23456',
  net: '176544',
} as const;
const paymentFixtureMarker = `${markerPrefix}payment-schedule:`;
const paymentFixtureNames = {
  primaryBank: `${paymentFixtureMarker}みずほ銀行`,
  secondaryBank: `${paymentFixtureMarker}三井住友銀行`,
  orphanBank: `${paymentFixtureMarker}未紐付銀行`,
  primaryCard: `${paymentFixtureMarker}10日カード`,
  secondPrimaryCard: `${paymentFixtureMarker}27日カード`,
  secondaryCard: `${paymentFixtureMarker}別銀行カード`,
  nextMonthCard: `${paymentFixtureMarker}翌月カード`,
  partialCard: `${paymentFixtureMarker}一部支払カード`,
  overpaymentCard: `${paymentFixtureMarker}過払いカード`,
  noSettingsCard: `${paymentFixtureMarker}設定なしカード`,
  invalidSettingsCard: `${paymentFixtureMarker}設定不備カード`,
} as const;

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
  return page.getByRole('list', { name: /資産別残高/ });
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
function balanceMetric(row: Locator, label: string): Locator {
  return row.locator('.balance-metric').filter({ hasText: label });
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
    Array.from(document.querySelectorAll<HTMLElement>('.balance-summary-value')).map((value) => {
      const style = getComputedStyle(value);
      return {
        clientWidth: value.clientWidth,
        scrollWidth: value.scrollWidth,
        height: value.getBoundingClientRect().height,
        lineHeight: Number.parseFloat(style.lineHeight),
        scrollHeight: value.scrollHeight,
        text: value.textContent ?? '',
        whiteSpace: style.whiteSpace,
      };
    }),
  );
  expect(values).toHaveLength(3);
  for (const value of values) {
    expect(value.clientWidth).toBeGreaterThan(0);
    expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth + 1);
    expect(value.height).toBeGreaterThanOrEqual(value.lineHeight - 1);
    expect(value.height).toBeLessThanOrEqual(value.lineHeight + 1);
    expect(value.scrollHeight).toBeLessThanOrEqual(value.lineHeight + 1);
    expect(value.text).not.toBe('');
    expect(value.whiteSpace).toBe('nowrap');
  }
}
async function expectMobileSummaryLayout(
  page: Page,
  options: { requireSingleRow?: boolean } = {},
): Promise<void> {
  const layout = await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('.balance-summary-list');
    const items = Array.from(document.querySelectorAll<HTMLElement>('.balance-summary-item'));
    if (!list || items.length !== 3) {
      throw new Error('balance summary layout elements are missing');
    }
    const listBox = list.getBoundingClientRect();
    const listStyle = getComputedStyle(list);
    const itemGeometry = items.map((item) => {
      const label = item.querySelector<HTMLElement>('.balance-summary-label');
      const value = item.querySelector<HTMLElement>('.balance-summary-value');
      if (!label || !value) {
        throw new Error('balance summary label/value is missing');
      }
      const itemBox = item.getBoundingClientRect();
      const labelBox = label.getBoundingClientRect();
      const valueBox = value.getBoundingClientRect();
      const itemStyle = getComputedStyle(item);
      const labelStyle = getComputedStyle(label);
      const valueStyle = getComputedStyle(value);
      const dividerStyle = getComputedStyle(item, '::before');
      return {
        label: label.textContent,
        itemTop: itemBox.top,
        itemBottom: itemBox.bottom,
        itemLeft: itemBox.left,
        itemRight: itemBox.right,
        itemHeight: itemBox.height,
        itemCenter: (itemBox.left + itemBox.right) / 2,
        labelCenter: (labelBox.left + labelBox.right) / 2,
        labelBottom: labelBox.bottom,
        labelColor: labelStyle.color,
        valueCenter: (valueBox.left + valueBox.right) / 2,
        valueBottom: valueBox.bottom,
        valueHeight: valueBox.height,
        valueFontSize: Number.parseFloat(valueStyle.fontSize),
        valueFontWeight: Number.parseInt(valueStyle.fontWeight, 10),
        valueTextAlign: valueStyle.textAlign,
        valueWhiteSpace: valueStyle.whiteSpace,
        valueScrollWidth: value.scrollWidth,
        valueClientWidth: value.clientWidth,
        itemFlex: itemStyle.flex,
        itemMinWidth: itemStyle.minWidth,
        borderInlineStart: itemStyle.borderInlineStartWidth,
        borderBlockStart: itemStyle.borderBlockStartWidth,
        dividerBorderBlockStart: dividerStyle.borderBlockStartWidth,
      };
    });
    const rowTops: number[] = [];
    for (const item of itemGeometry) {
      if (!rowTops.some((rowTop) => Math.abs(rowTop - item.itemTop) <= 1)) {
        rowTops.push(item.itemTop);
      }
    }
    return {
      display: listStyle.display,
      flexWrap: listStyle.flexWrap,
      columnGap: listStyle.columnGap,
      rowGap: listStyle.rowGap,
      paddingInlineStart: listStyle.paddingInlineStart,
      paddingInlineEnd: listStyle.paddingInlineEnd,
      borderBlockStart: listStyle.borderBlockStartWidth,
      borderBlockEnd: listStyle.borderBlockEndWidth,
      listLeft: listBox.left,
      listRight: listBox.right,
      rowTops,
      itemGeometry,
      summaryHeight: document
        .querySelector<HTMLElement>('.balance-summary')
        ?.getBoundingClientRect().height,
    };
  });
  expect(layout.display).toBe('flex');
  expect(layout.flexWrap).toBe('wrap');
  expect(layout.columnGap).toBe('16px');
  expect(layout.rowGap).toBe('16px');
  expect(layout.paddingInlineStart).toBe('0px');
  expect(layout.paddingInlineEnd).toBe('0px');
  expect(layout.borderBlockStart).toBe('0px');
  expect(layout.borderBlockEnd).toBe('0px');
  expect(layout.itemGeometry.map((item) => item.label)).toEqual(['資産', '負債', '純資産']);
  if (options.requireSingleRow) {
    expect(layout.rowTops).toHaveLength(1);
  }
  const firstItem = layout.itemGeometry[0];
  if (!firstItem) throw new Error('first mobile summary item is missing');
  const netItem = layout.itemGeometry[2];
  if (!netItem) throw new Error('net mobile summary item is missing');
  for (const rowTop of layout.rowTops) {
    const rowItems = layout.itemGeometry.filter((item) => Math.abs(item.itemTop - rowTop) <= 1);
    const firstRowItem = rowItems[0];
    if (!firstRowItem) throw new Error('mobile summary row is missing');
    expect(
      Math.abs(Math.min(...rowItems.map((item) => item.itemLeft)) - layout.listLeft),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(Math.max(...rowItems.map((item) => item.itemRight)) - layout.listRight),
    ).toBeLessThanOrEqual(1);
    for (const [index, item] of rowItems.entries()) {
      expect(Math.abs(item.itemBottom - firstRowItem.itemBottom)).toBeLessThanOrEqual(1);
      expect(Math.abs(item.itemHeight - firstRowItem.itemHeight)).toBeLessThanOrEqual(1);
      if (index > 0) {
        const previousItem = rowItems[index - 1];
        if (!previousItem) throw new Error('previous mobile summary item is missing');
        expect(item.itemLeft).toBeGreaterThanOrEqual(previousItem.itemRight);
      }
      expect(Math.abs(item.labelCenter - item.itemCenter)).toBeLessThanOrEqual(1);
      expect(Math.abs(item.valueCenter - item.itemCenter)).toBeLessThanOrEqual(1);
      expect(Math.abs(item.valueBottom - firstRowItem.valueBottom)).toBeLessThanOrEqual(1);
      expect(item.valueTextAlign).toBe('center');
      expect(item.valueWhiteSpace).toBe('nowrap');
      expect(item.valueScrollWidth).toBeLessThanOrEqual(item.valueClientWidth + 1);
      expect(item.itemFlex).toBe('1 1 0px');
      expect(item.itemMinWidth).toBe('max-content');
      expect(item.borderInlineStart).toBe('0px');
      expect(item.borderBlockStart).toBe('0px');
      expect(item.dividerBorderBlockStart).toBe('0px');
    }
  }
  expect(firstItem.valueFontSize).toBe(15);
  expect(firstItem.valueFontWeight).toBe(400);
  expect(layout.itemGeometry[1]?.valueFontSize).toBe(15);
  expect(layout.itemGeometry[1]?.valueFontWeight).toBe(400);
  expect(netItem.valueFontSize).toBe(16);
  expect(netItem.valueFontWeight).toBe(600);
  expect(netItem.labelColor).not.toBe(firstItem.labelColor);
  expect(layout.summaryHeight).toBeGreaterThan(0);
}

async function expectDesktopSummaryLayout(page: Page): Promise<void> {
  const layout = await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('.balance-summary-list');
    const items = Array.from(document.querySelectorAll<HTMLElement>('.balance-summary-item'));
    if (!list || items.length !== 3) {
      throw new Error('desktop balance summary layout elements are missing');
    }
    return {
      gridTemplateColumns: getComputedStyle(list).gridTemplateColumns,
      items: items.map((item) => {
        const box = item.getBoundingClientRect();
        return {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          borderInlineStart: getComputedStyle(item).borderInlineStartWidth,
        };
      }),
    };
  });
  expect(layout.gridTemplateColumns.split(' ')).toHaveLength(3);
  const firstItem = layout.items[0];
  if (!firstItem) throw new Error('first desktop summary item is missing');
  for (const [index, item] of layout.items.entries()) {
    expect(Math.abs(item.y - firstItem.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(item.width - firstItem.width)).toBeLessThanOrEqual(1);
    expect(item.height).toBeGreaterThan(0);
    expect(item.borderInlineStart).toBe(index === 0 ? '0px' : '1px');
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
async function seedCompactSummaryBalances(): Promise<void> {
  const client = database();
  const accounts = await client.sql<{ id: number; name: string }[]>`
    insert into accounts (household_id, name, kind)
    values
      (${DEFAULT_HOUSEHOLD_ID}, ${compactSummaryAssetAccountName}, 'other'),
      (${DEFAULT_HOUSEHOLD_ID}, ${compactSummaryLiabilityAccountName}, 'other')
    returning id, name
  `;
  const assetAccount = accounts.find((account) => account.name === compactSummaryAssetAccountName);
  const liabilityAccount = accounts.find(
    (account) => account.name === compactSummaryLiabilityAccountName,
  );
  const assetAccountId = assetAccount?.id;
  const liabilityAccountId = liabilityAccount?.id;
  const categories = await client.sql<{ id: number; type: 'expense' | 'income' }[]>`
    select id, type
    from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and type in ('expense', 'income')
    order by id
  `;
  const incomeCategory = categories.find((category) => category.type === 'income');
  const expenseCategory = categories.find((category) => category.type === 'expense');
  if (!assetAccountId || !liabilityAccountId || !incomeCategory || !expenseCategory) {
    throw new Error('compact balance summary fixtures were not created');
  }

  await client.sql`
    insert into transactions (
      household_id, type, amount, occurred_on, category_id, account_id, memo
    )
    select
      ${DEFAULT_HOUSEHOLD_ID}, 'income', ${summaryFixtureUnit}, ${`${month}-01`},
      ${incomeCategory.id}, ${assetAccountId},
      ${`${compactSummaryMarker}asset-`} || series.row_number::text
    from generate_series(1, 9) as series(row_number)
  `;
  await client.sql`
    insert into transactions (
      household_id, type, amount, occurred_on, category_id, account_id, memo
    )
    values (
      ${DEFAULT_HOUSEHOLD_ID}, 'income', 876543219, ${`${month}-10`},
      ${incomeCategory.id}, ${assetAccountId}, ${`${compactSummaryMarker}asset-remainder`}
    )
  `;
  await client.sql`
    insert into transactions (
      household_id, type, amount, occurred_on, category_id, account_id, memo
    )
    select
      ${DEFAULT_HOUSEHOLD_ID}, 'expense', ${summaryFixtureUnit}, ${`${month}-02`},
      ${expenseCategory.id}, ${liabilityAccountId},
      ${`${compactSummaryMarker}liability-`} || series.row_number::text
    from generate_series(1, 17) as series(row_number)
  `;
  await client.sql`
    insert into transactions (
      household_id, type, amount, occurred_on, category_id, account_id, memo
    )
    values (
      ${DEFAULT_HOUSEHOLD_ID}, 'expense', 654321115, ${`${month}-11`},
      ${expenseCategory.id}, ${liabilityAccountId}, ${`${compactSummaryMarker}liability-remainder`}
    )
  `;
}

async function cleanupCompactSummaryBalances(): Promise<void> {
  const client = database();
  await client.sql`
    delete from transactions
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and memo like ${`${compactSummaryMarker}%`}
  `;
  await client.sql`
    delete from accounts
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and name like ${`${compactSummaryMarker}%`}
  `;
}
type VisualSummaryFixture = {
  accountIds: number[];
};

async function seedVisualSummaryBalances(): Promise<VisualSummaryFixture> {
  const client = database();
  const accounts = await client.sql<{ id: number; name: string }[]>`
    insert into accounts (household_id, name, kind)
    values
      (${DEFAULT_HOUSEHOLD_ID}, ${visualSummaryAccountNames[0]}, 'cash'),
      (${DEFAULT_HOUSEHOLD_ID}, ${visualSummaryAccountNames[1]}, 'bank'),
      (${DEFAULT_HOUSEHOLD_ID}, ${visualSummaryAccountNames[2]}, 'credit_card')
    returning id, name
  `;
  const categories = await client.sql<{ id: number; type: 'income' | 'expense' }[]>`
    select id, type
    from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and type in ('income', 'expense')
    order by id
  `;
  const incomeCategory = categories.find((category) => category.type === 'income');
  const expenseCategory = categories.find((category) => category.type === 'expense');
  const cash = accounts.find((account) => account.name === visualSummaryAccountNames[0]);
  const bank = accounts.find((account) => account.name === visualSummaryAccountNames[1]);
  const card = accounts.find((account) => account.name === visualSummaryAccountNames[2]);
  if (!incomeCategory || !expenseCategory || !cash || !bank || !card) {
    throw new Error('natural visual balance summary fixtures were not created');
  }
  await client.sql`
    insert into transactions (
      household_id, type, amount, occurred_on, category_id, account_id, memo
    )
    values
      (${DEFAULT_HOUSEHOLD_ID}, 'income', 125000, ${`${month}-01`},
        ${incomeCategory.id}, ${cash.id}, ${`${visualSummaryMarker}income-cash`}),
      (${DEFAULT_HOUSEHOLD_ID}, 'income', 75000, ${`${month}-02`},
        ${incomeCategory.id}, ${bank.id}, ${`${visualSummaryMarker}income-bank`}),
      (${DEFAULT_HOUSEHOLD_ID}, 'expense', 23456, ${`${month}-03`},
        ${expenseCategory.id}, ${card.id}, ${`${visualSummaryMarker}expense-card`})
  `;
  return { accountIds: accounts.map((account) => account.id) };
}

async function seedPaymentScheduleBalances(): Promise<void> {
  const client = database();
  const names = paymentFixtureNames;
  await client.sql`
    insert into accounts (household_id, name, kind)
    values
      (${DEFAULT_HOUSEHOLD_ID}, ${names.primaryBank}, 'bank'),
      (${DEFAULT_HOUSEHOLD_ID}, ${names.secondaryBank}, 'bank'),
      (${DEFAULT_HOUSEHOLD_ID}, ${names.orphanBank}, 'bank'),
      (${DEFAULT_HOUSEHOLD_ID}, ${names.primaryCard}, 'credit_card'),
      (${DEFAULT_HOUSEHOLD_ID}, ${names.secondPrimaryCard}, 'credit_card'),
      (${DEFAULT_HOUSEHOLD_ID}, ${names.secondaryCard}, 'credit_card'),
      (${DEFAULT_HOUSEHOLD_ID}, ${names.nextMonthCard}, 'credit_card'),
      (${DEFAULT_HOUSEHOLD_ID}, ${names.partialCard}, 'credit_card'),
      (${DEFAULT_HOUSEHOLD_ID}, ${names.overpaymentCard}, 'credit_card'),
      (${DEFAULT_HOUSEHOLD_ID}, ${names.noSettingsCard}, 'credit_card'),
      (${DEFAULT_HOUSEHOLD_ID}, ${names.invalidSettingsCard}, 'credit_card')
  `;
  const accounts = await client.sql<{ id: number; name: string }[]>`
    select id, name
    from accounts
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and name like ${`${paymentFixtureMarker}%`}
  `;
  const accountId = (name: string): number => {
    const account = accounts.find((row) => row.name === name);
    if (!account) throw new Error(`payment schedule account fixture is missing: ${name}`);
    return account.id;
  };
  const expenseCategory = (
    await client.sql<{ id: number }[]>`
      select id
      from categories
      where household_id = ${DEFAULT_HOUSEHOLD_ID} and type = 'expense'
      order by id
      limit 1
    `
  )[0];
  if (!expenseCategory) throw new Error('payment schedule expense category is missing');

  const currentMonth = currentTokyoMonth();
  const billedMonth = shiftMonth(currentMonth, -2);
  const unbilledMonth = shiftMonth(currentMonth, -1);
  const occurredOn = (monthValue: string, day: number): string =>
    `${monthValue}-${String(day).padStart(2, '0')}`;
  const addSetting = async (
    cardName: string,
    closingDay: string,
    paymentDay: string | null,
    bankName: string,
  ): Promise<void> => {
    await client.sql`
      insert into account_card_settings (
        household_id, account_id, closing_day, payment_day, payment_month_offset,
        debit_account_id, auto_payment_starts_on
      )
      select
        ${DEFAULT_HOUSEHOLD_ID}, card.id, ${closingDay}, ${paymentDay}, 'next_month',
        bank.id, ${currentTokyoDate()}
      from accounts card
      cross join accounts bank
      where card.household_id = ${DEFAULT_HOUSEHOLD_ID}
        and card.name = ${cardName}
        and bank.household_id = ${DEFAULT_HOUSEHOLD_ID}
        and bank.name = ${bankName}
    `;
  };
  const addExpense = async (
    accountName: string,
    amount: number,
    date: string,
    suffix: string,
  ): Promise<void> => {
    await client.sql`
      insert into transactions (
        household_id, type, amount, occurred_on, category_id, account_id, memo
      )
      values (
        ${DEFAULT_HOUSEHOLD_ID}, 'expense', ${amount}, ${date},
        ${expenseCategory.id}, ${accountId(accountName)}, ${`${paymentFixtureMarker}${suffix}`}
      )
    `;
  };

  await addSetting(names.primaryCard, '15', '10', names.primaryBank);
  await addSetting(names.secondPrimaryCard, '15', '27', names.primaryBank);
  await addSetting(names.secondaryCard, '15', '10', names.secondaryBank);
  await addSetting(names.nextMonthCard, '15', '10', names.secondaryBank);
  await addSetting(names.partialCard, '15', '10', names.primaryBank);
  await addSetting(names.overpaymentCard, '15', '10', names.primaryBank);
  await addSetting(names.invalidSettingsCard, '15', null, names.secondaryBank);

  await addExpense(names.primaryCard, 1000, occurredOn(billedMonth, 20), 'primary-billed');
  await addExpense(names.primaryCard, 250, occurredOn(unbilledMonth, 20), 'primary-unbilled');
  await addExpense(names.secondPrimaryCard, 2000, occurredOn(billedMonth, 20), 'second-billed');
  await addExpense(names.secondPrimaryCard, 350, occurredOn(unbilledMonth, 20), 'second-unbilled');
  await addExpense(names.secondaryCard, 3000, occurredOn(billedMonth, 20), 'secondary-billed');
  await addExpense(names.nextMonthCard, 400, occurredOn(unbilledMonth, 20), 'next-month-only');
  await addExpense(names.partialCard, 1200, occurredOn(billedMonth, 20), 'partial-billed');
  await addExpense(names.overpaymentCard, 500, occurredOn(billedMonth, 20), 'overpayment-billed');
  await addExpense(names.noSettingsCard, 900, occurredOn(currentMonth, 2), 'no-settings');
  await addExpense(
    names.invalidSettingsCard,
    1000,
    occurredOn(billedMonth, 20),
    'invalid-settings',
  );

  await client.sql`
    insert into transfers (
      household_id, from_account_id, to_account_id, amount, occurred_on, memo
    )
    values (
      ${DEFAULT_HOUSEHOLD_ID}, ${accountId(names.primaryBank)}, ${accountId(names.partialCard)},
      500, ${occurredOn(currentMonth, 1)}, ${`${paymentFixtureMarker}partial-payment`}
    )
  `;
  await client.sql`
    insert into transfers (
      household_id, from_account_id, to_account_id, amount, occurred_on, memo
    )
    values (
      ${DEFAULT_HOUSEHOLD_ID}, ${accountId(names.primaryBank)}, ${accountId(names.overpaymentCard)},
      700, ${occurredOn(currentMonth, 2)}, ${`${paymentFixtureMarker}overpayment`}
    )
  `;
}

async function cleanupVisualSummaryBalances(fixture: VisualSummaryFixture): Promise<void> {
  const client = database();
  await client.sql`
    delete from transactions
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and memo like ${`${visualSummaryMarker}%`}
  `;
  for (const accountId of fixture.accountIds) {
    await client.sql`
      delete from accounts
      where household_id = ${DEFAULT_HOUSEHOLD_ID} and id = ${accountId}
    `;
  }
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
    delete from account_card_conditions
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and account_id in (
        select id from accounts
        where household_id = ${DEFAULT_HOUSEHOLD_ID} and name like ${`${markerPrefix}%`}
      )
  `;
  await client.sql`
    delete from account_card_settings
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and account_id in (
        select id from accounts
        where household_id = ${DEFAULT_HOUSEHOLD_ID} and name like ${`${markerPrefix}%`}
      )
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
  for (const width of [320, 390, 430, 479]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/balances');
    await expectBalanceSummary(page, { assets: '0', liabilities: '0', net: '0' });
    await expectMobileSummaryLayout(page);
    await expectSummaryValuesFit(page);
    await expectStickyBalanceSummary(page);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: `${screenshotDirectory}/balances-empty-mobile-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 481, height: 844 });
  await page.goto('/balances');
  await expectBalanceSummary(page, { assets: '0', liabilities: '0', net: '0' });
  await expectDesktopSummaryLayout(page);
  await expectSummaryValuesFit(page);
  await expectStickyBalanceSummary(page);
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: `${screenshotDirectory}/balances-empty-481.png`,
    fullPage: true,
  });
});

test('updates balances after UI transaction and transfer mutations', async ({ page }) => {
  const { longAccountId, destinationAccountId } = await seedAccounts();
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
  await database().sql`
    delete from accounts
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and id in (${longAccountId}, ${destinationAccountId})
  `;
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

test('splits and aggregates card payment schedules on balances', async ({ page }) => {
  await seedPaymentScheduleBalances();
  try {
    await page.goto('/balances');

    const primaryBank = accountRow(page, paymentFixtureNames.primaryBank);
    await expect(balanceMetric(primaryBank, '今月の支払予定')).toContainText('3,700円');
    await expect(balanceMetric(primaryBank, '残高')).toContainText('−1,200円');
    const secondaryBank = accountRow(page, paymentFixtureNames.secondaryBank);
    await expect(balanceMetric(secondaryBank, '今月の支払予定')).toContainText('3,000円');
    await expect(balanceMetric(secondaryBank, '残高')).toContainText('0円');
    const orphanBank = accountRow(page, paymentFixtureNames.orphanBank);
    await expect(balanceMetric(orphanBank, '今月の支払予定')).toContainText('0円');
    await expect(balanceMetric(orphanBank, '残高')).toContainText('0円');

    const primaryCard = accountRow(page, paymentFixtureNames.primaryCard);
    await expect(balanceMetric(primaryCard, '支払予定')).toContainText('1,000円');
    await expect(balanceMetric(primaryCard, '未請求')).toContainText('250円');
    const secondPrimaryCard = accountRow(page, paymentFixtureNames.secondPrimaryCard);
    await expect(balanceMetric(secondPrimaryCard, '支払予定')).toContainText('2,000円');
    await expect(balanceMetric(secondPrimaryCard, '未請求')).toContainText('350円');
    await expect(
      balanceMetric(accountRow(page, paymentFixtureNames.secondaryCard), '支払予定'),
    ).toContainText('3,000円');
    await expect(
      balanceMetric(accountRow(page, paymentFixtureNames.partialCard), '支払予定'),
    ).toContainText('700円');
    await expect(
      balanceMetric(accountRow(page, paymentFixtureNames.nextMonthCard), '支払予定'),
    ).toContainText('0円');
    await expect(
      balanceMetric(accountRow(page, paymentFixtureNames.nextMonthCard), '未請求'),
    ).toContainText('400円');

    const noSettingsCard = accountRow(page, paymentFixtureNames.noSettingsCard);
    await expect(balanceMetric(noSettingsCard, '支払予定')).toContainText('—');
    await expect(balanceMetric(noSettingsCard, '利用残高')).toContainText('900円');
    await expect(noSettingsCard.getByText('設定を確認')).toHaveCount(0);
    const invalidSettingsCard = accountRow(page, paymentFixtureNames.invalidSettingsCard);
    await expect(balanceMetric(invalidSettingsCard, '支払予定')).toContainText('—');
    await expect(balanceMetric(invalidSettingsCard, '利用残高')).toContainText('1,000円');
    await expect(invalidSettingsCard.getByText('設定を確認')).toBeVisible();
    expect((await page.locator('.balance-list').allTextContents()).join('\n')).not.toContain(
      '支払日',
    );

    const moneyColors = await page.evaluate(() => {
      const readToken = (name: string): string => {
        const probe = document.createElement('span');
        probe.style.color = getComputedStyle(document.documentElement)
          .getPropertyValue(name)
          .trim();
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      };
      return {
        debt: readToken('--money-negative'),
        positive: readToken('--money-positive'),
      };
    });
    const debtColor = moneyColors.debt;
    const positiveColor = moneyColors.positive;
    await expect(balanceMetric(primaryBank, '今月の支払予定').locator('.money-amount')).toHaveCSS(
      'color',
      debtColor,
    );
    await expect(balanceMetric(primaryCard, '支払予定').locator('.money-amount')).toHaveCSS(
      'color',
      debtColor,
    );
    await expect(balanceMetric(primaryCard, '未請求').locator('.money-amount')).toHaveCSS(
      'color',
      debtColor,
    );
    await expect(balanceMetric(primaryBank, '残高').locator('.money-amount')).toHaveCSS(
      'color',
      debtColor,
    );
    await expect(balanceMetric(invalidSettingsCard, '利用残高').locator('.money-amount')).toHaveCSS(
      'color',
      debtColor,
    );
    await expect(balanceMetric(noSettingsCard, '利用残高').locator('.money-amount')).toHaveCSS(
      'color',
      debtColor,
    );
    await expect(balanceMetric(secondaryBank, '残高').locator('.money-amount')).not.toHaveCSS(
      'color',
      debtColor,
    );
    const overpaymentCard = accountRow(page, paymentFixtureNames.overpaymentCard);
    await expect(balanceMetric(overpaymentCard, '支払予定')).toContainText('0円');
    await expect(balanceMetric(overpaymentCard, '利用残高')).toContainText('−200円');
    await expect(balanceMetric(overpaymentCard, '利用残高').locator('.money-amount')).toHaveCSS(
      'color',
      positiveColor,
    );

    const cardRows = [
      primaryCard,
      secondPrimaryCard,
      accountRow(page, paymentFixtureNames.secondaryCard),
      accountRow(page, paymentFixtureNames.nextMonthCard),
      accountRow(page, paymentFixtureNames.partialCard),
      overpaymentCard,
      noSettingsCard,
      invalidSettingsCard,
    ];
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.reload();
      await assertNoHorizontalOverflow(page);
      const row = accountRow(page, paymentFixtureNames.primaryCard);
      const nameBox = await row.locator('.balance-account-link').boundingBox();
      const metricsBox = await row.locator('.balance-row-metrics').boundingBox();
      if (!nameBox || !metricsBox) throw new Error('balance row geometry is missing');
      expect(metricsBox.x).toBeGreaterThanOrEqual(nameBox.x + nameBox.width - 1);
      expect(metricsBox.y).toBeLessThan(nameBox.y + nameBox.height);

      const metricColumns = await Promise.all(
        cardRows.map((cardRow) =>
          cardRow.locator('.balance-metric').evaluateAll((elements) =>
            elements.map((element) => {
              const box = element.getBoundingClientRect();
              return { x: box.x, width: box.width };
            }),
          ),
        ),
      );
      for (const columns of metricColumns) {
        expect(columns).toHaveLength(2);
      }
      const referenceColumns = metricColumns[0];
      if (!referenceColumns) throw new Error('balance metric columns are missing');
      for (const columns of metricColumns.slice(1)) {
        for (const [index, column] of columns.entries()) {
          const reference = referenceColumns[index];
          if (!reference) throw new Error('balance metric column is missing');
          expect(Math.abs(column.x - reference.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(column.width - reference.width)).toBeLessThanOrEqual(1);
        }
      }
    }
  } finally {
    await cleanupBalances();
    await initializeDefaultLedger(database().db);
  }
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
test('captures natural summary fixtures for mobile and desktop visuals', async ({ page }) => {
  const fixture = await seedVisualSummaryBalances();
  try {
    const values = {
      assets: formatFixtureAmount(visualSummaryValues.assets),
      liabilities: formatFixtureAmount(visualSummaryValues.liabilities),
      net: formatFixtureAmount(visualSummaryValues.net),
    };
    for (const width of [375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/balances');
      await expectBalanceSummary(page, values);
      await expectMobileSummaryLayout(page, { requireSingleRow: true });
      await expectSummaryValuesFit(page);
      await expectStickyBalanceSummary(page);
      await assertNoHorizontalOverflow(page);
      for (const accountName of visualSummaryAccountNames) {
        await expect(page.getByRole('link', { name: accountName, exact: true })).toBeVisible();
      }
      await page.screenshot({
        path: `${screenshotDirectory}/balances-natural-mobile-${width}.png`,
        fullPage: true,
      });
    }
    for (const viewport of [
      { width: 481, height: 844, name: '481' },
      { width: 1280, height: 800, name: 'desktop' },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/balances');
      await expectBalanceSummary(page, values);
      await expectDesktopSummaryLayout(page);
      await expectSummaryValuesFit(page);
      await expectStickyBalanceSummary(page);
      await assertNoHorizontalOverflow(page);
      await page.screenshot({
        path: `${screenshotDirectory}/balances-natural-${viewport.name}.png`,
        fullPage: true,
      });
    }
  } finally {
    await cleanupVisualSummaryBalances(fixture);
  }
});
test('keeps large mobile summary values in compact rows', async ({ page }) => {
  await seedCompactSummaryBalances();
  try {
    for (const width of [320, 375, 390, 430, 479]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/balances');
      await expectBalanceSummary(page, {
        assets: compactSummaryAssetsDisplay,
        liabilities: compactSummaryLiabilitiesDisplay,
        net: `−${compactSummaryNetDisplay}`,
      });
      await expectMobileSummaryLayout(page);
      await expectSummaryValuesFit(page);
      await expectStickyBalanceSummary(page);
      await assertNoHorizontalOverflow(page);
      if (width === 320 || width === 430 || width === 479) {
        await page.screenshot({
          path: `${screenshotDirectory}/balances-negative-net-mobile-${width}.png`,
          fullPage: true,
        });
      }
    }
    await page.setViewportSize({ width: 481, height: 844 });
    await page.goto('/balances');
    await expectBalanceSummary(page, {
      assets: compactSummaryAssetsDisplay,
      liabilities: compactSummaryLiabilitiesDisplay,
      net: `−${compactSummaryNetDisplay}`,
    });
    await expectDesktopSummaryLayout(page);
    await expectSummaryValuesFit(page);
    await expectStickyBalanceSummary(page);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: `${screenshotDirectory}/balances-negative-net-481.png`,
      fullPage: true,
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/balances');
    await expectBalanceSummary(page, {
      assets: compactSummaryAssetsDisplay,
      liabilities: compactSummaryLiabilitiesDisplay,
      net: `−${compactSummaryNetDisplay}`,
    });
    await expectDesktopSummaryLayout(page);
    await expectSummaryValuesFit(page);
    await expectStickyBalanceSummary(page);
    await assertNoHorizontalOverflow(page);
  } finally {
    await cleanupCompactSummaryBalances();
  }
});

test('keeps trillion-scale summary values fully visible on mobile and desktop', async ({
  page,
}) => {
  await seedTrillionScaleBalances();
  try {
    for (const width of [320, 360, 430, 479]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/balances');
      await expectBalanceSummary(page, {
        assets: summaryFixtureAssetsDisplay,
        liabilities: summaryFixtureLiabilitiesDisplay,
        net: `−${summaryFixtureNetMagnitudeDisplay}`,
      });
      await expectMobileSummaryLayout(page);
      await expectSummaryValuesFit(page);
      await expectAccountValuesFit(page);
      await expectStickyBalanceSummary(page);
      await assertNoHorizontalOverflow(page);
      await page.screenshot({
        path: `${screenshotDirectory}/balances-trillion-mobile-${width}.png`,
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 481, height: 844 });
    await page.goto('/balances');
    await expectBalanceSummary(page, {
      assets: summaryFixtureAssetsDisplay,
      liabilities: summaryFixtureLiabilitiesDisplay,
      net: `−${summaryFixtureNetMagnitudeDisplay}`,
    });
    await expectDesktopSummaryLayout(page);
    await expectSummaryValuesFit(page);
    await expectAccountValuesFit(page);
    await expectStickyBalanceSummary(page);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: `${screenshotDirectory}/balances-trillion-481.png`,
      fullPage: true,
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/balances');
    await expectBalanceSummary(page, {
      assets: summaryFixtureAssetsDisplay,
      liabilities: summaryFixtureLiabilitiesDisplay,
      net: `−${summaryFixtureNetMagnitudeDisplay}`,
    });
    await expectDesktopSummaryLayout(page);
    await expectSummaryValuesFit(page);
    await expectAccountValuesFit(page);
    await expectStickyBalanceSummary(page);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      path: `${screenshotDirectory}/balances-trillion-desktop.png`,
      fullPage: true,
    });
  } finally {
    await cleanupBalances();
  }
});

test('keeps the balances test marker contract', () => {
  assertCleanupMarker(markerPrefix);
});
