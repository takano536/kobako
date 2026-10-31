import { randomUUID } from 'node:crypto';

import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  DEFAULT_HOUSEHOLD_ID,
  assertSafeTestDatabaseTarget,
  createDatabaseClient,
  currentTokyoDate,
  initializeDefaultLedger,
  shiftMonth,
  verifySafeTestDatabaseConnection,
  type DatabaseClient,
  type DatabaseTarget,
} from '@kobako/db';

import { E2E_MARKER_PREFIX, assertCleanupMarker } from './e2e-safety';
import { selectFieldOption } from './select-field-helpers';

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
  return page.locator('[data-slot="balance-list"]');
}
function summaryAmount(page: Page, label: string): Locator {
  return page
    .locator('dt')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('xpath=..')
    .locator('dd');
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
      await expect(amount.getByText('マイナス', { exact: true })).toHaveCount(1);
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
      header: rectangle('[data-slot="site-header"]'),
      nav: rectangle('[data-slot="site-nav"]'),
      content: rectangle('[data-slot="page-content"]'),
      shell: rectangle('[data-slot="page-shell"]'),
      pageHeader: rectangle('[data-slot="page-header"]'),
      h1: rectangle('[data-slot="page-header-title"]'),
    };
  });
  console.log(`BALANCES_GEOMETRY ${name} ${JSON.stringify(geometry)}`);
}

function accountRow(page: Page, accountName: string): Locator {
  return balanceList(page).getByRole('listitem').filter({ hasText: accountName });
}
function balanceMetric(row: Locator, label: string): Locator {
  return row.locator('[data-slot="balance-metric"][aria-label="' + label + '"]');
}

async function expectAccountBalance(
  page: Page,
  accountName: string,
  amount: string,
): Promise<void> {
  const row = accountRow(page, accountName);
  await expect(row).toHaveCount(1);
  const balance = row.locator('[data-slot="balance-amount"]');
  await expect(balance).toContainText(amount.replace(/^−/, ''));
  if (amount.startsWith('−')) {
    await expect(balance.getByText('マイナス', { exact: true })).toHaveCount(1);
  }
}

async function openBalances(page: Page): Promise<void> {
  await page.getByRole('link', { name: '残高', exact: true }).click();
  await expect(page).toHaveURL(/\/balances(?:\?month=\d{4}-\d{2})?$/);
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function tabToBalanceLink(page: Page, link: Locator): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  for (let index = 0; index < 100; index += 1) {
    await page.keyboard.press('Tab');
    if (await link.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error('balance row link was not reached by keyboard navigation');
}

async function expectStickyBalanceSummary(page: Page): Promise<void> {
  const summary = page.getByRole('region', { name: '残高の集計' });
  await expect(summary).toHaveCSS('position', 'sticky');

  const initialGeometry = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('[data-slot="site-header"]');
    const summary = document.querySelector<HTMLElement>('[data-slot="page-summary"]');
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
    const summary = document.querySelector<HTMLElement>('[data-slot="page-summary"]');
    if (!summary) throw new Error('balance summary is missing');
    window.scrollTo(0, summary.getBoundingClientRect().top + window.scrollY);
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector<HTMLElement>('[data-slot="page-summary"]')?.getBoundingClientRect()
            .top,
      ),
    )
    .toBeGreaterThanOrEqual(-1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector<HTMLElement>('[data-slot="page-summary"]')?.getBoundingClientRect()
            .top,
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
    Array.from(document.querySelectorAll<HTMLElement>('[data-slot="page-summary"] dd')).map(
      (value) => ({
        clientWidth: value.clientWidth,
        scrollWidth: value.scrollWidth,
        height: value.getBoundingClientRect().height,
        text: value.textContent ?? '',
      }),
    ),
  );
  expect(values).toHaveLength(3);
  for (const value of values) {
    expect(value.clientWidth).toBeGreaterThan(0);
    expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth + 1);
    expect(value.height).toBeGreaterThan(0);
    expect(value.text).toMatch(/(?:円|—)/);
  }
}
type ListAmountMeasurement = {
  text: string;
  amountScrollWidth: number;
  amountClientWidth: number;
  contentScrollWidth: number;
  contentClientWidth: number;
  rowHeight: number;
};

async function readListAmountMeasurements(page: Page): Promise<ListAmountMeasurement[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-slot="balance-amount"]')).map(
      (amount) => {
        const content = amount.querySelector<HTMLElement>('[data-slot="balance-amount-content"]');
        const row = amount.closest<HTMLElement>('[data-slot="balance-row"]');
        if (!content) throw new Error('balance amount content is missing');
        return {
          text: amount.textContent ?? '',
          amountScrollWidth: amount.scrollWidth,
          amountClientWidth: amount.clientWidth,
          contentScrollWidth: content.scrollWidth,
          contentClientWidth: content.clientWidth,
          rowHeight: row?.getBoundingClientRect().height ?? 0,
        };
      },
    ),
  );
}

async function expectUnifiedListAmountFont(page: Page): Promise<void> {
  const values = await readListAmountMeasurements(page);
  expect(values.length).toBeGreaterThan(0);
  for (const value of values) {
    expect(value.text.replace(/\s+/g, '')).toMatch(/^(?:マイナス)?(?:−)?[\d,]+円$|^—$/);
    expect(value.amountClientWidth).toBeGreaterThan(0);
    expect(value.amountScrollWidth).toBeLessThanOrEqual(value.amountClientWidth + 1);
    expect(value.contentScrollWidth).toBeLessThanOrEqual(value.contentClientWidth + 1);
    expect(value.rowHeight).toBeGreaterThan(0);
  }
}

async function expectUnifiedListBodyFont(page: Page): Promise<void> {
  const values = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-slot="balance-account-name"], [data-slot="balance-amount-content"]',
      ),
    ).map((element) => {
      const style = getComputedStyle(element);
      return {
        fontSize: Number.parseFloat(style.fontSize),
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
      };
    }),
  );
  expect(values.length).toBeGreaterThan(0);
  const first = values[0];
  if (!first) throw new Error('balance body font measurements are missing');
  for (const value of values) {
    expect(value.fontSize).toBeGreaterThan(0);
    expect(value.fontFamily).toBe(first.fontFamily);
    expect(value.fontWeight).toBe(first.fontWeight);
  }
}

async function logRenderedPlatformFonts(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send('DOM.enable');
  await client.send('CSS.enable');
  try {
    const document = await client.send('DOM.getDocument', { depth: -1 });
    const readFonts = async (selector: string) => {
      const node = await client.send('DOM.querySelector', {
        nodeId: document.root.nodeId,
        selector,
      });
      if (node.nodeId === 0) throw new Error(`balance font node is missing: ${selector}`);
      return client.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId });
    };
    const nameFonts = await readFonts('[data-slot="balance-account-name"]');
    const amountFonts = await readFonts('[data-slot="balance-amount-content"]');
    console.log(`BALANCE_PLATFORM_FONTS ${JSON.stringify({ nameFonts, amountFonts })}`);
  } finally {
    await client.detach();
  }
}

async function expectMobileSummaryLayout(
  page: Page,
  { allowStacked = false }: { allowStacked?: boolean } = {},
): Promise<void> {
  const layout = await page.evaluate(() => {
    const summary = document.querySelector<HTMLElement>('[data-slot="page-summary"]');
    const list = summary?.querySelector<HTMLElement>('dl');
    const metrics = list
      ? Array.from(list.querySelectorAll<HTMLElement>('dt')).map((label) => {
          const value = label.parentElement?.querySelector<HTMLElement>('dd');
          if (!value) throw new Error('balance summary value is missing');
          const labelStyle = getComputedStyle(label);
          const valueStyle = getComputedStyle(value);
          const box = value.getBoundingClientRect();
          const metricBox = label.parentElement?.getBoundingClientRect();
          if (!metricBox) throw new Error('balance summary metric box is missing');
          return {
            label: label.textContent,
            labelColor: labelStyle.color,
            valueFontSize: Number.parseFloat(valueStyle.fontSize),
            valueFontWeight: Number.parseInt(valueStyle.fontWeight, 10),
            metricTop: metricBox.top,
            metricBottom: metricBox.bottom,
            valueTop: box.top,
            valueBottom: box.bottom,
            valueLeft: box.left,
            valueRight: box.right,
            valueScrollWidth: value.scrollWidth,
            valueClientWidth: value.clientWidth,
          };
        })
      : [];
    if (!summary || !list || metrics.length !== 3) {
      throw new Error('balance summary layout elements are missing');
    }
    const listBox = list.getBoundingClientRect();
    const listStyle = getComputedStyle(list);
    return {
      display: listStyle.display,
      flexWrap: listStyle.flexWrap,
      columnGap: listStyle.columnGap,
      rowGap: listStyle.rowGap,
      borderBlockEnd: getComputedStyle(summary).borderBlockEndWidth,
      listLeft: listBox.left,
      listRight: listBox.right,
      metrics,
    };
  });
  expect(layout.display).toBe('flex');
  expect(layout.flexWrap).toBe('wrap');
  expect(layout.columnGap).toBe('12px');
  expect(layout.rowGap).toBe('12px');
  expect(layout.borderBlockEnd).toBe('1px');
  expect(layout.metrics.map((metric) => metric.label)).toEqual(['純資産', '資産', '負債']);
  const net = layout.metrics[0];
  const assets = layout.metrics[1];
  const liabilities = layout.metrics[2];
  if (!net || !assets || !liabilities) throw new Error('balance summary metrics are missing');
  const compact320 = await page.evaluate(() => window.innerWidth <= 320);
  const primarySize = compact320 ? 23.36 : 26;
  const secondarySize = compact320 ? 14.72 : 16;
  expect(net.valueFontSize).toBeCloseTo(primarySize, 2);
  expect(net.valueFontWeight).toBe(600);
  for (const metric of [assets, liabilities]) {
    expect(metric.valueFontSize).toBeCloseTo(secondarySize, 2);
  }
  // 主指標の見出しは ink、副指標の見出しは muted で金額と左端を揃えます。
  expect(net.labelColor).not.toBe(assets.labelColor);
  expect(assets.labelColor).toBe(liabilities.labelColor);
  if (allowStacked && Math.abs(net.valueBottom - assets.valueBottom) > 1) {
    expect(net.valueBottom).toBeLessThanOrEqual(assets.valueTop + 1);
  } else {
    expect(Math.abs(net.valueBottom - assets.valueBottom)).toBeLessThanOrEqual(1);
  }
  for (const metric of layout.metrics) {
    expect(metric.valueScrollWidth).toBeLessThanOrEqual(metric.valueClientWidth + 1);
  }
}

async function expectDesktopSummaryLayout(
  page: Page,
  { allowStacked = false }: { allowStacked?: boolean } = {},
): Promise<void> {
  const layout = await page.evaluate(() => {
    const summary = document.querySelector<HTMLElement>('[data-slot="page-summary"]');
    const list = summary?.querySelector<HTMLElement>('dl');
    const metrics = list
      ? Array.from(list.querySelectorAll<HTMLElement>('dt')).map((label) => {
          const value = label.parentElement?.querySelector<HTMLElement>('dd');
          if (!value) throw new Error('desktop balance summary value is missing');
          const valueStyle = getComputedStyle(value);
          const box = value.getBoundingClientRect();
          return {
            label: label.textContent,
            valueFontSize: Number.parseFloat(valueStyle.fontSize),
            valueFontWeight: Number.parseInt(valueStyle.fontWeight, 10),
            valueTop: box.top,
            valueBottom: box.bottom,
            valueLeft: box.left,
            valueRight: box.right,
          };
        })
      : [];
    if (!summary || !list || metrics.length !== 3) {
      throw new Error('desktop balance summary layout elements are missing');
    }
    const listBox = list.getBoundingClientRect();
    const listStyle = getComputedStyle(list);
    return {
      display: listStyle.display,
      alignItems: listStyle.alignItems,
      columnGap: listStyle.columnGap,
      listLeft: listBox.left,
      listRight: listBox.right,
      metrics,
    };
  });
  expect(layout.display).toBe('flex');
  expect(layout.alignItems).toBe('flex-end');
  expect(layout.columnGap).toBe('64px');
  expect(layout.metrics.map((metric) => metric.label)).toEqual(['純資産', '資産', '負債']);
  const net = layout.metrics[0];
  const assets = layout.metrics[1];
  const liabilities = layout.metrics[2];
  if (!net || !assets || !liabilities)
    throw new Error('desktop balance summary metrics are missing');
  expect(net.valueFontSize).toBeCloseTo(36, 2);
  expect(net.valueFontWeight).toBe(600);
  for (const metric of [assets, liabilities]) {
    expect(metric.valueFontSize).toBeCloseTo(18, 2);
    expect(metric.valueFontWeight).toBe(500);
  }
  expect(Math.abs(net.valueLeft - layout.listLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(liabilities.valueRight - layout.listRight)).toBeLessThanOrEqual(1);
  if (allowStacked && Math.abs(net.valueBottom - assets.valueBottom) > 1) {
    expect(net.valueBottom).toBeLessThanOrEqual(assets.valueTop + 1);
  } else {
    for (const metric of layout.metrics) {
      expect(Math.abs(metric.valueBottom - net.valueBottom)).toBeLessThanOrEqual(1);
    }
  }
}

async function expectAccountValuesFit(page: Page): Promise<void> {
  const values = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-slot="balance-amount"]')).map(
      (value) => ({
        text: value.textContent ?? '',
        clientWidth: value.clientWidth,
        scrollWidth: value.scrollWidth,
      }),
    ),
  );
  expect(values.length).toBeGreaterThan(0);
  for (const value of values) {
    expect(value.text.replace(/\s+/g, '')).toMatch(/^(?:マイナス)?(?:−)?[\d,]+円$|^—$/);
    expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth + 1);
  }
}

async function seedAccounts(): Promise<{ longAccountId: number; destinationAccountId: number }> {
  const client = database();
  const rows = await client.sql<{ id: number; name: string }[]>`
    insert into accounts (household_id, name, kind, asset_category_id)
    values
      (${DEFAULT_HOUSEHOLD_ID}, ${longAccountName}, 'other', (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'other')),
      (${DEFAULT_HOUSEHOLD_ID}, ${destinationAccountName}, 'other', (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'other'))
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
      insert into accounts (household_id, name, kind, asset_category_id)
      values (${DEFAULT_HOUSEHOLD_ID}, ${accountName}, 'other', (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'other'))
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
    insert into accounts (household_id, name, kind, asset_category_id)
    values
      (${DEFAULT_HOUSEHOLD_ID}, ${compactSummaryAssetAccountName}, 'other', (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'other')),
      (${DEFAULT_HOUSEHOLD_ID}, ${compactSummaryLiabilityAccountName}, 'other', (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'other'))
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
    insert into accounts (household_id, name, kind, asset_category_id)
    values
      (${DEFAULT_HOUSEHOLD_ID}, ${visualSummaryAccountNames[0]}, 'cash', (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'cash')),
      (${DEFAULT_HOUSEHOLD_ID}, ${visualSummaryAccountNames[1]}, 'bank', (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'bank')),
      (${DEFAULT_HOUSEHOLD_ID}, ${visualSummaryAccountNames[2]}, 'credit_card', (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'credit_card'))
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
    insert into accounts (household_id, name, kind, asset_category_id)
    values
      (${DEFAULT_HOUSEHOLD_ID}, ${names.primaryBank}, 'bank', (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'bank')),
      (${DEFAULT_HOUSEHOLD_ID}, ${names.secondaryBank}, 'bank', (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'bank')),
      (${DEFAULT_HOUSEHOLD_ID}, ${names.orphanBank}, 'bank', (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'bank')),
      (${DEFAULT_HOUSEHOLD_ID}, ${names.primaryCard}, 'credit_card', (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'credit_card')),
      (${DEFAULT_HOUSEHOLD_ID}, ${names.secondPrimaryCard}, 'credit_card', (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'credit_card')),
      (${DEFAULT_HOUSEHOLD_ID}, ${names.secondaryCard}, 'credit_card', (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'credit_card')),
      (${DEFAULT_HOUSEHOLD_ID}, ${names.nextMonthCard}, 'credit_card', (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'credit_card')),
      (${DEFAULT_HOUSEHOLD_ID}, ${names.partialCard}, 'credit_card', (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'credit_card')),
      (${DEFAULT_HOUSEHOLD_ID}, ${names.overpaymentCard}, 'credit_card', (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'credit_card')),
      (${DEFAULT_HOUSEHOLD_ID}, ${names.noSettingsCard}, 'credit_card', (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'credit_card')),
      (${DEFAULT_HOUSEHOLD_ID}, ${names.invalidSettingsCard}, 'credit_card', (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'credit_card'))
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

  const today = currentTokyoDate();
  const currentMonth = today.slice(0, 7);
  const billedMonth = shiftMonth(currentMonth, -2);
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
        bank.id, ${today}
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

  await addExpense(names.primaryCard, 12000, occurredOn(billedMonth, 20), 'primary-billed');
  await addExpense(names.primaryCard, 3000, today, 'primary-unbilled');
  await addExpense(names.secondPrimaryCard, 2000, occurredOn(billedMonth, 20), 'second-billed');
  await addExpense(names.secondPrimaryCard, 350, today, 'second-unbilled');
  await addExpense(names.secondaryCard, 3000, occurredOn(billedMonth, 20), 'secondary-billed');
  await addExpense(names.nextMonthCard, 400, today, 'next-month-only');
  await addExpense(names.partialCard, 1200, occurredOn(billedMonth, 20), 'partial-billed');
  await addExpense(names.overpaymentCard, 500, occurredOn(billedMonth, 20), 'overpayment-billed');
  await addExpense(names.noSettingsCard, 900, today, 'no-settings');
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
    .locator('[data-slot="transaction-link"]')
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
    .locator('[data-slot="transaction-link"]')
    .filter({ hasText: `${markerPrefix}ordinary-create` })
    .click();
  await page.locator('[data-slot="delete-confirm"] > summary').click();
  await page.getByRole('button', { name: '削除を確定', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}$`));
  await openBalances(page);
  await expectAccountBalance(page, longAccountName, '0円');
  await expectBalanceSummary(page, { assets: '0', liabilities: '0', net: '0' });

  await page.goto(`/transactions/new?month=${month}&type=transfer`);
  await page.locator('#transaction-amount').fill('300');
  await selectFieldOption(page.locator('#transaction-from-account'), { label: longAccountName });
  await selectFieldOption(page.locator('#transaction-to-account'), {
    label: destinationAccountName,
  });
  await page.locator('#transaction-memo').fill(`${markerPrefix}transfer-create`);
  await page.getByRole('button', { name: '登録する', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}$`));
  await openBalances(page);
  await expectAccountBalance(page, longAccountName, '−300円');
  await expectBalanceSummary(page, { assets: '300', liabilities: '300', net: '0' });
  await expectAccountBalance(page, destinationAccountName, '300円');

  await page.goto(`/transactions?month=${month}`);
  await page
    .locator('[data-slot="transaction-link"]')
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
    .locator('[data-slot="transaction-link"]')
    .filter({ hasText: `${markerPrefix}transfer-create` })
    .click();
  await page.locator('[data-slot="delete-confirm"] > summary').click();
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
      household_id, name, kind, asset_category_id, status, sort_order
    )
    values (
      ${DEFAULT_HOUSEHOLD_ID}, ${accountName}, 'bank',
      (select id from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID} and system_key = 'bank'),
      'active', 500
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
  await expect(page.locator('[data-slot="filter-chip"][data-filter="account"]')).toContainText(
    accountName,
  );
  await expect(page.getByRole('button', { name: '資産の条件を外す', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '資産の条件を外す', exact: true }).click();
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

test('makes every balance row surface navigate to its transactions', async ({ page }) => {
  const { destinationAccountId } = await seedAccounts();
  await seedPaymentScheduleBalances();
  try {
    const paymentAccounts = await database().sql<{ id: number; name: string }[]>`
      select id, name
      from accounts
      where household_id = ${DEFAULT_HOUSEHOLD_ID}
        and name like ${`${paymentFixtureMarker}%`}
    `;
    const accountIdFor = (name: string): number => {
      const account = paymentAccounts.find((candidate) => candidate.name === name);
      if (!account) throw new Error(`balance row account fixture is missing: ${name}`);
      return account.id;
    };
    const targets = [
      { name: destinationAccountName, id: destinationAccountId, metricCount: 0 },
      {
        name: paymentFixtureNames.primaryBank,
        id: accountIdFor(paymentFixtureNames.primaryBank),
        metricCount: 2,
      },
      {
        name: paymentFixtureNames.primaryCard,
        id: accountIdFor(paymentFixtureNames.primaryCard),
        metricCount: 2,
      },
    ] as const;

    for (const target of targets) {
      await page.goto('/balances');
      const row = accountRow(page, target.name);
      const link = row.locator('[data-slot="balance-account-link"]');
      await expect(link).toHaveCount(1);
      await expect(row.locator('a')).toHaveCount(1);
      await expect(link).toHaveAttribute('href', `/transactions?account=${target.id}&month=all`);
      await expect(link).toHaveAccessibleName(new RegExp(`^${escapeRegExp(target.name)}`));
      await row.locator('[data-slot="balance-account-name"]').click();
      await expect(page).toHaveURL(`/transactions?account=${target.id}&month=all`);
    }

    for (const target of targets) {
      const amountIndexes = target.metricCount === 0 ? [0] : [0, 1];
      for (const amountIndex of amountIndexes) {
        await page.goto('/balances');
        const row = accountRow(page, target.name);
        const amount =
          target.metricCount === 0
            ? row.locator('[data-slot="balance-amount"]')
            : row.locator('[data-slot="balance-metric"]').nth(amountIndex);
        await amount.click();
        await expect(page).toHaveURL(`/transactions?account=${target.id}&month=all`);
      }
    }

    for (const target of targets) {
      await page.goto('/balances');
      const row = accountRow(page, target.name);
      const link = row.locator('[data-slot="balance-account-link"]');
      await link.scrollIntoViewIfNeeded();
      const linkBox = await link.boundingBox();
      const nameBox = await row.locator('[data-slot="balance-account-name"]').boundingBox();
      if (!linkBox || !nameBox) throw new Error('balance row link geometry is missing');
      let x = linkBox.x + Math.min(4, linkBox.width / 2);
      let y = linkBox.y + linkBox.height - 2;
      if (target.metricCount > 0) {
        const metricsBox = await row.locator('[data-slot="balance-row-metrics"]').boundingBox();
        if (!metricsBox) throw new Error('balance row metrics geometry is missing');
        const gap = metricsBox.x - (nameBox.x + nameBox.width);
        expect(gap).toBeGreaterThan(0);
        x = nameBox.x + nameBox.width + gap / 2;
        y = linkBox.y + linkBox.height / 2;
      } else {
        const amountBox = await row.locator('[data-slot="balance-amount"]').boundingBox();
        if (!amountBox) throw new Error('balance row amount geometry is missing');
        const gap = amountBox.x - (nameBox.x + nameBox.width);
        expect(gap).toBeGreaterThan(0);
        x = nameBox.x + nameBox.width + gap / 2;
        y = linkBox.y + linkBox.height / 2;
      }
      await page.mouse.click(x, y);
      await expect(page).toHaveURL(`/transactions?account=${target.id}&month=all`);
    }

    await page.goto('/balances');
    const cardRow = accountRow(page, paymentFixtureNames.primaryCard);
    const cardLink = cardRow.locator('[data-slot="balance-account-link"]');
    await expectUnifiedListAmountFont(page);
    await page.setViewportSize({ width: 320, height: 844 });
    await page.reload();
    await expectUnifiedListAmountFont(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '20px';
    });
    await expectAccountValuesFit(page);
    await assertNoHorizontalOverflow(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.reload();

    await tabToBalanceLink(page, cardLink);
    await expect(cardLink).toBeFocused();
    await expect(cardLink).toHaveCSS('outline-style', 'solid');
    await expect(cardLink).toHaveCSS('outline-width', '3px');
    await page.screenshot({
      path: `${screenshotDirectory}/balances-row-link-desktop-focus.png`,
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/balances');
    const mobileCardLink = accountRow(page, paymentFixtureNames.primaryCard).locator(
      '[data-slot="balance-account-link"]',
    );
    await tabToBalanceLink(page, mobileCardLink);
    await expect(mobileCardLink).toBeFocused();
    await expect(mobileCardLink).toHaveCSS('outline-style', 'solid');
    await page.screenshot({
      path: `${screenshotDirectory}/balances-row-link-mobile-focus.png`,
      fullPage: true,
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/settings');
    const assetEdit = page.locator(
      `a[href="/accounts/${accountIdFor(paymentFixtureNames.primaryCard)}/edit?return=%2Fsettings"]`,
    );
    await expect(assetEdit).toBeVisible();
    await expect(assetEdit).toContainText(paymentFixtureNames.primaryCard);
    await page.screenshot({
      path: `${screenshotDirectory}/settings-asset-edit-desktop.png`,
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings');
    await expect(
      page.locator(
        `a[href="/accounts/${accountIdFor(paymentFixtureNames.primaryCard)}/edit?return=%2Fsettings"]`,
      ),
    ).toBeVisible();
    await page.screenshot({
      path: `${screenshotDirectory}/settings-asset-edit-mobile.png`,
      fullPage: true,
    });

    await page.goto('/balances');
    const keyboardLink = accountRow(page, destinationAccountName).locator(
      '[data-slot="balance-account-link"]',
    );
    await tabToBalanceLink(page, keyboardLink);
    await expect(keyboardLink).toBeFocused();
    await expect(keyboardLink).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`/transactions?account=${destinationAccountId}&month=all`);
  } finally {
    await cleanupBalances();
    await initializeDefaultLedger(database().db);
  }
});

test('keeps and aggregates card payment schedules on balances', async ({ page }) => {
  await seedPaymentScheduleBalances();
  try {
    await page.goto('/balances');

    await expect(page.getByText('今月の支払予定', { exact: true })).toHaveCount(0);
    await expect(page.getByText('設定を確認', { exact: true })).toHaveCount(0);
    await expect(page.getByText('資産別の残高', { exact: true })).toHaveCount(0);
    await expect(
      page.locator('[data-slot="balance-row"] [data-slot="balance-metric-label"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-slot="balance-row"]').filter({ hasText: '支払予定' }),
    ).toHaveCount(0);

    const bankGroup = page
      .locator('[data-slot="balance-group"]')
      .filter({ has: page.locator('h3', { hasText: /^銀行$/ }) });
    await expect(bankGroup.locator('[data-slot="balance-group-heading-label"]')).toHaveText([
      '支払予定',
      '残高',
    ]);
    const cardGroup = page
      .locator('[data-slot="balance-group"]')
      .filter({ has: page.locator('h3', { hasText: /^クレジットカード$/ }) });
    await expect(cardGroup).toHaveCount(1);
    await expect(cardGroup.locator('[data-slot="balance-group-heading-label"]')).toHaveText([
      '決済予定',
      '未決済',
    ]);

    const expectGroupRows = async (group: Locator, names: readonly string[]): Promise<void> => {
      const rows = group.locator('[data-slot="balance-row"]');
      await expect(rows).toHaveCount(names.length);
      await expect(rows.locator('[data-slot="balance-account-name"]')).toHaveText([...names]);
    };
    await expectGroupRows(bankGroup, [
      paymentFixtureNames.primaryBank,
      paymentFixtureNames.secondaryBank,
      paymentFixtureNames.orphanBank,
    ]);
    await expectGroupRows(cardGroup, [
      paymentFixtureNames.primaryCard,
      paymentFixtureNames.secondPrimaryCard,
      paymentFixtureNames.secondaryCard,
      paymentFixtureNames.nextMonthCard,
      paymentFixtureNames.partialCard,
      paymentFixtureNames.overpaymentCard,
      paymentFixtureNames.noSettingsCard,
      paymentFixtureNames.invalidSettingsCard,
    ]);

    const expectMetricLabels = async (row: Locator, labels: string[]): Promise<void> => {
      await expect(row.locator('[data-slot="balance-metric"]')).toHaveCount(labels.length);
      await expect
        .poll(() =>
          row
            .locator('[data-slot="balance-metric"]')
            .evaluateAll((elements) =>
              elements.map((element) => element.getAttribute('aria-label')),
            ),
        )
        .toEqual(labels);
    };

    const primaryBank = accountRow(page, paymentFixtureNames.primaryBank);
    await expectMetricLabels(primaryBank, ['支払予定', '残高']);
    await expect(balanceMetric(primaryBank, '支払予定')).toContainText('14,700円');
    await expect(balanceMetric(primaryBank, '残高')).toContainText('−1,200円');
    const secondaryBank = accountRow(page, paymentFixtureNames.secondaryBank);
    await expect(balanceMetric(secondaryBank, '支払予定')).toContainText('3,000円');
    await expect(balanceMetric(secondaryBank, '残高')).toContainText('0円');
    const orphanBank = accountRow(page, paymentFixtureNames.orphanBank);
    await expect(balanceMetric(orphanBank, '支払予定')).toContainText('0円');
    await expect(balanceMetric(orphanBank, '残高')).toContainText('0円');

    const primaryCard = accountRow(page, paymentFixtureNames.primaryCard);
    await expectMetricLabels(primaryCard, ['決済予定', '未決済']);
    await expect(balanceMetric(primaryCard, '決済予定')).toContainText('12,000円');
    await expect(balanceMetric(primaryCard, '未決済')).toContainText('3,000円');
    const secondPrimaryCard = accountRow(page, paymentFixtureNames.secondPrimaryCard);
    await expectMetricLabels(secondPrimaryCard, ['決済予定', '未決済']);
    await expect(balanceMetric(secondPrimaryCard, '決済予定')).toContainText('2,000円');
    await expect(balanceMetric(secondPrimaryCard, '未決済')).toContainText('350円');
    await expect(
      balanceMetric(accountRow(page, paymentFixtureNames.secondaryCard), '決済予定'),
    ).toContainText('3,000円');
    await expect(
      balanceMetric(accountRow(page, paymentFixtureNames.partialCard), '決済予定'),
    ).toContainText('700円');
    await expect(
      balanceMetric(accountRow(page, paymentFixtureNames.nextMonthCard), '決済予定'),
    ).toContainText('0円');
    await expect(
      balanceMetric(accountRow(page, paymentFixtureNames.nextMonthCard), '未決済'),
    ).toContainText('400円');
    await expectBalanceSummary(page, {
      assets: '−1,200',
      liabilities: '23,150',
      net: '−24,350',
    });
    await expect(primaryCard).not.toContainText('15,000円');
    const primaryCardAccount = (
      await database().sql<{ id: number }[]>`
        select id
        from accounts
        where household_id = ${DEFAULT_HOUSEHOLD_ID} and name = ${paymentFixtureNames.primaryCard}
      `
    )[0];
    const expenseCategory = (
      await database().sql<{ id: number }[]>`
        select id
        from categories
        where household_id = ${DEFAULT_HOUSEHOLD_ID} and type = 'expense'
        order by id
        limit 1
      `
    )[0];
    if (!primaryCardAccount || !expenseCategory) {
      throw new Error('card column mutation fixtures are missing');
    }
    await database().sql`
      insert into transactions (
        household_id, type, amount, occurred_on, category_id, account_id, memo
      )
      values (
        ${DEFAULT_HOUSEHOLD_ID}, 'expense', 2000, ${currentTokyoDate()},
        ${expenseCategory.id}, ${primaryCardAccount.id}, ${`${paymentFixtureMarker}primary-added`}
      )
    `;
    await page.reload();
    await expect(balanceMetric(primaryCard, '決済予定')).toContainText('12,000円');
    await expect(balanceMetric(primaryCard, '未決済')).toContainText('5,000円');
    await expect(primaryCard).not.toContainText('15,000円');

    const noSettingsCard = accountRow(page, paymentFixtureNames.noSettingsCard);
    await expectMetricLabels(noSettingsCard, ['決済予定', '未決済']);
    await expect(balanceMetric(noSettingsCard, '決済予定')).toContainText('—');
    await expect(balanceMetric(noSettingsCard, '未決済')).toContainText('—');
    const invalidSettingsCard = accountRow(page, paymentFixtureNames.invalidSettingsCard);
    await expectMetricLabels(invalidSettingsCard, ['決済予定', '未決済']);
    await expect(balanceMetric(invalidSettingsCard, '決済予定')).toContainText('—');
    await expect(balanceMetric(invalidSettingsCard, '未決済')).toContainText('—');
    await expect(cardGroup).not.toContainText('利用残高');
    expect(
      (await page.locator('[data-slot="balance-list"]').allTextContents()).join('\n'),
    ).not.toContain('支払日');

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
      };
    });
    const debtColor = moneyColors.debt;
    await expect(
      balanceMetric(primaryBank, '支払予定').locator('[data-slot="money-amount"]'),
    ).toHaveCSS('color', debtColor);
    await expect(
      balanceMetric(primaryCard, '決済予定').locator('[data-slot="money-amount"]'),
    ).toHaveCSS('color', debtColor);
    await expect(
      balanceMetric(primaryCard, '未決済').locator('[data-slot="money-amount"]'),
    ).toHaveCSS('color', debtColor);
    await expect(
      balanceMetric(primaryBank, '残高').locator('[data-slot="money-amount"]'),
    ).toHaveCSS('color', debtColor);
    await expect(
      balanceMetric(secondaryBank, '残高').locator('[data-slot="money-amount"]'),
    ).not.toHaveCSS('color', debtColor);
    const overpaymentCard = accountRow(page, paymentFixtureNames.overpaymentCard);
    await expectMetricLabels(overpaymentCard, ['決済予定', '未決済']);
    await expect(balanceMetric(overpaymentCard, '決済予定')).toContainText('0円');
    await expect(balanceMetric(overpaymentCard, '未決済')).toContainText('0円');

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({
      path: `${screenshotDirectory}/balances-font-before-desktop.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 844 });
    await page.reload();
    await assertNoHorizontalOverflow(page);
    await expectUnifiedListAmountFont(page);
    await expectUnifiedListBodyFont(page);
    await logRenderedPlatformFonts(page);
    await page.screenshot({
      path: `${screenshotDirectory}/balances-font-before-mobile-320.png`,
      fullPage: true,
    });

    await database().sql`
      insert into transactions (
        household_id, type, amount, occurred_on, category_id, account_id, memo
      )
      values (
        ${DEFAULT_HOUSEHOLD_ID}, 'expense', 999_999_999, ${currentTokyoDate()},
        ${expenseCategory.id}, ${primaryCardAccount.id}, ${`${paymentFixtureMarker}font-probe`}
      )
    `;
    await page.setViewportSize({ width: 320, height: 844 });
    await page.reload();
    await assertNoHorizontalOverflow(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '20px';
    });
    await expectUnifiedListAmountFont(page);
    await expectAccountValuesFit(page);
    await assertNoHorizontalOverflow(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    await expectUnifiedListAmountFont(page);
    await expectUnifiedListBodyFont(page);
    await logRenderedPlatformFonts(page);

    await page.screenshot({
      path: `${screenshotDirectory}/balances-font-unified-mobile-320.png`,
      fullPage: true,
    });

    await assertNoHorizontalOverflow(page);
    await expectUnifiedListAmountFont(page);
    await expectUnifiedListBodyFont(page);
    await page.screenshot({
      path: `${screenshotDirectory}/balances-font-unified-desktop.png`,
      fullPage: true,
    });

    const cardGroupWithRows = {
      group: cardGroup,
      rows: cardGroup.locator('[data-slot="balance-row"]'),
    };
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.reload();
      await assertNoHorizontalOverflow(page);
      const row = accountRow(page, paymentFixtureNames.primaryCard);
      const rowBox = await row.boundingBox();
      const linkBox = await row.locator('[data-slot="balance-account-link"]').boundingBox();
      const nameBox = await row.locator('[data-slot="balance-account-name"]').boundingBox();
      const metricsBox = await row.locator('[data-slot="balance-row-metrics"]').boundingBox();
      if (!rowBox || !linkBox || !nameBox || !metricsBox) {
        throw new Error('balance row geometry is missing');
      }
      expect(linkBox.x).toBeGreaterThanOrEqual(rowBox.x - 1);
      expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
      expect(metricsBox.x).toBeGreaterThanOrEqual(nameBox.x + nameBox.width - 1);
      expect(
        Math.abs(metricsBox.y + metricsBox.height / 2 - (rowBox.y + rowBox.height / 2)),
      ).toBeLessThanOrEqual(1);

      for (const { group, rows } of [cardGroupWithRows]) {
        const headingColumns = await group
          .locator('[data-slot="balance-group-heading-label"]')
          .evaluateAll((elements) =>
            elements.map((element) => {
              const box = element.getBoundingClientRect();
              return { x: box.x, width: box.width };
            }),
          );
        const metricColumns = await rows.evaluateAll((rowElements) =>
          rowElements.map((rowElement) =>
            Array.from(rowElement.querySelectorAll('[data-slot="balance-metric"]')).map(
              (element) => {
                const box = element.getBoundingClientRect();
                return { x: box.x, width: box.width };
              },
            ),
          ),
        );
        expect(headingColumns).toHaveLength(2);
        for (const columns of metricColumns) {
          expect(columns).toHaveLength(2);
          for (const [index, column] of columns.entries()) {
            const heading = headingColumns[index];
            if (!heading) throw new Error('balance heading columns are missing');
            expect(Math.abs(column.x - heading.x)).toBeLessThanOrEqual(1);
            expect(Math.abs(column.width - heading.width)).toBeLessThanOrEqual(1);
          }
        }
      }
      const amountGeometry = await page
        .locator('[data-slot="balance-group"]')
        .evaluateAll((groups) =>
          groups.map((group) => {
            const list = group.querySelector<HTMLElement>('[data-slot="balance-list"]');
            if (!list) throw new Error('balance list is missing');
            const readRect = (element: Element) => {
              const box = element.getBoundingClientRect();
              return { right: box.right, top: box.top, bottom: box.bottom };
            };
            const headers = Array.from(
              group.querySelectorAll<HTMLElement>('[data-slot="balance-group-heading-label"]'),
            ).map(readRect);
            const rows = Array.from(
              group.querySelectorAll<HTMLElement>('[data-slot="balance-row"]'),
            ).map((row) =>
              Array.from(row.querySelectorAll<HTMLElement>('[data-slot="balance-metric"]')).map(
                (metric) => {
                  const amount =
                    metric.querySelector<HTMLElement>('[data-slot="money-amount"]') ??
                    metric.querySelector<HTMLElement>('[data-slot="balance-amount"]');
                  if (!amount) throw new Error('balance amount is missing');
                  return readRect(amount);
                },
              ),
            );
            return { list: readRect(list), headers, rows };
          }),
        );
      for (const group of amountGeometry) {
        const columns: { right: number; top: number; bottom: number }[][] = [];
        for (const row of group.rows) {
          for (const [index, amount] of row.entries()) {
            const header = group.headers[index];
            if (!header) throw new Error('balance amount header is missing');
            expect(amount.right).toBeLessThanOrEqual(group.list.right + 1);
            expect(amount.right).toBeLessThanOrEqual(header.right + 1);
            columns[index] ??= [];
            columns[index].push(amount);
          }
        }
        for (const amounts of columns) {
          for (let first = 0; first < amounts.length; first += 1) {
            for (let second = first + 1; second < amounts.length; second += 1) {
              const firstAmount = amounts[first];
              const secondAmount = amounts[second];
              if (!firstAmount || !secondAmount) throw new Error('balance amounts are missing');
              expect(
                firstAmount.bottom <= secondAmount.top + 1 ||
                  secondAmount.bottom <= firstAmount.top + 1,
              ).toBe(true);
            }
          }
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
      await expectMobileSummaryLayout(page);
      await expectSummaryValuesFit(page);
      await expectStickyBalanceSummary(page);
      await assertNoHorizontalOverflow(page);
      for (const accountName of visualSummaryAccountNames) {
        await expect(
          page.getByRole('link', { name: new RegExp(`^${escapeRegExp(accountName)}`) }),
        ).toBeVisible();
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
      await expectMobileSummaryLayout(page, { allowStacked: true });
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
    await expectDesktopSummaryLayout(page, { allowStacked: true });
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
      await expectMobileSummaryLayout(page, { allowStacked: true });
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
    await expectDesktopSummaryLayout(page, { allowStacked: true });
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
