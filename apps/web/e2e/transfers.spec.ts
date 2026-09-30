import { randomUUID } from 'node:crypto';

import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  DEFAULT_HOUSEHOLD_ID,
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
  chooseEmptyMonthPair,
  monthIsEmpty,
} from './e2e-safety';

const runId = randomUUID();
const runMarkerPrefix = `${E2E_MARKER_PREFIX}${runId}:`;
const marker = `${runMarkerPrefix}transfer:`;
test.describe.configure({ mode: 'serial' });
let databaseClient: DatabaseClient | undefined;
let month = '';
let fromName = '';
let toName = '';
let alternateName = '';

async function clearRunTransfers(client: DatabaseClient): Promise<void> {
  assertCleanupMarker(runMarkerPrefix);
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
}
function runTransferRows(page: Page): Locator {
  return page
    .locator('.transaction-link[href*="/transactions/transfers/"]')
    .filter({ hasText: marker });
}
async function selectTextGeometry(select: Locator): Promise<{
  textStartX: number;
  height: number;
  font: string;
}> {
  return select.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    return {
      textStartX: rect.x + borderLeft + paddingLeft,
      height: rect.height,
      font: style.font,
    };
  });
}

async function selectOptionByKeyboard(select: Locator, label: string): Promise<void> {
  const options = await select.locator('option').allTextContents();
  const optionIndex = options.findIndex((option) => option === label);
  if (optionIndex < 1) {
    throw new Error(`option ${label} was not found`);
  }
  await select.focus();
  await select.press('Home');
  for (let index = 0; index < optionIndex; index += 1) {
    await select.press('ArrowDown');
  }
}

async function seedRunTransfer(): Promise<void> {
  if (!databaseClient) {
    throw new Error('transfer test database is not initialized');
  }
  await clearRunTransfers(databaseClient);
  await databaseClient.sql`
    insert into transfers (household_id, from_account_id, to_account_id, amount, occurred_on, memo)
    select
      ${DEFAULT_HOUSEHOLD_ID},
      from_account.id,
      to_account.id,
      3000,
      ${`${month}-10`},
      ${`${marker}:fixture`}
    from accounts as from_account
    cross join accounts as to_account
    where from_account.household_id = ${DEFAULT_HOUSEHOLD_ID}
      and from_account.name = ${fromName}
      and to_account.household_id = ${DEFAULT_HOUSEHOLD_ID}
      and to_account.name = ${toName}
  `;
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
}

async function assertDeleteConfirmationDoesNotOverlapForm(page: Page): Promise<void> {
  const overlaps = await page.locator('.delete-confirmation').evaluate((confirmation) => {
    const confirmationRect = confirmation.getBoundingClientRect();
    return [...document.querySelectorAll('.ledger-form .field, .ledger-form .save-button')].some(
      (target) => {
        const targetRect = target.getBoundingClientRect();
        return (
          confirmationRect.left < targetRect.right &&
          confirmationRect.right > targetRect.left &&
          confirmationRect.top < targetRect.bottom &&
          confirmationRect.bottom > targetRect.top
        );
      },
    );
  });
  expect(overlaps).toBe(false);
}
type ButtonMetrics = {
  width: number;
  height: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  fontSize: number;
  borderRadius: string;
  lineHeight: string;
};

async function buttonMetrics(button: Locator): Promise<ButtonMetrics> {
  return button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      width: rect.width,
      height: rect.height,
      paddingTop: Number.parseFloat(style.paddingTop),
      paddingRight: Number.parseFloat(style.paddingRight),
      paddingBottom: Number.parseFloat(style.paddingBottom),
      paddingLeft: Number.parseFloat(style.paddingLeft),
      fontSize: Number.parseFloat(style.fontSize),
      borderRadius: style.borderRadius,
      lineHeight: style.lineHeight,
    };
  });
}

function expectButtonMetricsToMatch(actual: ButtonMetrics, expected: ButtonMetrics): void {
  expect(actual.height).toBeCloseTo(expected.height, 1);
  expect(actual.paddingTop).toBeCloseTo(expected.paddingTop, 1);
  expect(actual.paddingRight).toBeCloseTo(expected.paddingRight, 1);
  expect(actual.paddingBottom).toBeCloseTo(expected.paddingBottom, 1);
  expect(actual.paddingLeft).toBeCloseTo(expected.paddingLeft, 1);
  expect(actual.fontSize).toBeCloseTo(expected.fontSize, 1);
  expect(actual.borderRadius).toBe(expected.borderRadius);
  expect(actual.lineHeight).toBe(expected.lineHeight);
}

async function deleteRunTransfersAndAccounts(client: DatabaseClient): Promise<void> {
  assertCleanupMarker(runMarkerPrefix);
  const safeTestDatabase = assertSafeTestDatabaseTarget();
  await verifySafeTestDatabaseConnection(
    client.sql,
    safeTestDatabase.target,
    process.env.DATABASE_URL,
  );
  await clearRunTransfers(client);
  await client.sql`
    delete from accounts
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and name like ${`${runMarkerPrefix}%`}
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
    [month] = await chooseEmptyMonthPair(databaseClient, runId);
    fromName = `${marker}:元`;
    toName = `${marker}:先`;
    alternateName = `${marker}:変更先`;
    await databaseClient.sql`
      insert into accounts (household_id, name)
      values
        (${DEFAULT_HOUSEHOLD_ID}, ${fromName}),
        (${DEFAULT_HOUSEHOLD_ID}, ${toName}),
        (${DEFAULT_HOUSEHOLD_ID}, ${alternateName})
    `;
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
    await deleteRunTransfersAndAccounts(databaseClient);
  } finally {
    await databaseClient.close();
    databaseClient = undefined;
  }
});
test('treats a transfer-only month as occupied for E2E safety checks', async () => {
  if (!databaseClient) {
    throw new Error('transfer test database is not initialized');
  }
  await seedRunTransfer();
  expect(await monthIsEmpty(databaseClient, month)).toBe(false);
  await clearRunTransfers(databaseClient);
  expect(await monthIsEmpty(databaseClient, month)).toBe(true);
});

test('uses one form for all types with type-specific fields and preserved shared values', async ({
  page,
}) => {
  await page.goto(`/transactions?month=${month}`);
  await expect(page.getByRole('link', { name: '＋ 取引を追加', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '＋ 振替を追加', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '＋ 取引を追加', exact: true }).click();

  const amount = page.getByLabel('金額');
  const date = page.locator('input[name="occurredOn"]');
  const memo = page.getByLabel('メモ（任意）');
  await expect(page.locator('.category-field-expense')).toBeVisible();
  await expect(page.locator('.category-field-income')).toBeHidden();
  await expect(page.locator('.account-detail-grid')).toBeHidden();
  await amount.fill('123');
  await date.fill(`${month}-12`);
  await memo.fill(`${marker}:shared`);

  await page.getByText('収入', { exact: true }).click();
  await expect(page.locator('.category-field-expense')).toBeHidden();
  await expect(page.locator('.category-field-income')).toBeVisible();
  await expect(amount).toHaveValue('123');
  await expect(date).toHaveValue(`${month}-12`);
  await expect(memo).toHaveValue(`${marker}:shared`);

  await page.getByText('振替', { exact: true }).click();
  await expect(page.locator('.category-field-expense')).toBeHidden();
  await expect(page.locator('.category-field-income')).toBeHidden();
  await expect(page.locator('.account-detail-grid')).toBeVisible();
  await expect(page.getByLabel('振替元')).toBeVisible();
  await expect(page.getByLabel('振替先')).toBeVisible();
  await expect(amount).toHaveValue('123');
  await expect(date).toHaveValue(`${month}-12`);
  await expect(memo).toHaveValue(`${marker}:shared`);

  await page.getByText('支出', { exact: true }).click();
  const categorySelect = page.locator('.category-field-expense select');
  await categorySelect.selectOption({ label: '食費' });
  await expect(categorySelect).toHaveClass('field-select');
  const categoryGeometry = await selectTextGeometry(categorySelect);

  await page.getByText('振替', { exact: true }).click();
  const accountSelects = [page.getByLabel('振替元'), page.getByLabel('振替先')];
  for (const accountSelect of accountSelects) {
    await expect(accountSelect).toHaveClass('field-select');
    const accountGeometry = await selectTextGeometry(accountSelect);
    expect(accountGeometry.textStartX).toBeCloseTo(categoryGeometry.textStartX, 1);
    expect(accountGeometry.height).toBeCloseTo(categoryGeometry.height, 1);
    expect(accountGeometry.font).toBe(categoryGeometry.font);
  }
});

test('filters transfer rows by direct transfer URL regardless of category query', async ({
  page,
}) => {
  if (!databaseClient) {
    throw new Error('transfer test database is not initialized');
  }
  await clearRunTransfers(databaseClient);
  await seedRunTransfer();
  await page.goto(`/transactions?month=${month}&type=transfer&category=1`);
  await expect(page.getByText('振替・カテゴリなし')).toBeVisible();
  await expect(page.locator('select[name="type"]')).toHaveValue('transfer');
  await expect(page.locator('select[name="category"]')).toBeDisabled();
  await expect(runTransferRows(page)).toHaveCount(1);
  await expect(page.locator('.transaction-link').filter({ hasText: marker })).toHaveCount(1);
});

test('converts a transfer to expense and updates the list and overview totals', async ({
  page,
}) => {
  if (!databaseClient) {
    throw new Error('transfer test database is not initialized');
  }
  await clearRunTransfers(databaseClient);
  await seedRunTransfer();
  await page.goto(`/transactions?month=${month}`);
  await runTransferRows(page).click();
  await page.getByText('支出', { exact: true }).click();
  await page.locator('.category-field-expense select').selectOption({ label: '食費' });
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(runTransferRows(page)).toHaveCount(0);
  const convertedRow = page.locator('.transaction-link').filter({ hasText: marker });
  await expect(convertedRow).toHaveCount(1);
  await page.goto(`/?month=${month}`);
  await expect(page.getByRole('group', { name: '収入' }).locator('dd')).toContainText('0円');
  await expect(page.locator('.lead-amount')).toHaveText('3,000円');
  await expect(page.getByRole('group', { name: '収支差額' }).locator('dd')).toContainText(
    '3,000円',
  );
});

test('registers, edits, and deletes income directly without JavaScript', async ({ browser }) => {
  if (!databaseClient) {
    throw new Error('transfer test database is not initialized');
  }
  await clearRunTransfers(databaseClient);
  const context = await browser.newContext({
    javaScriptEnabled: false,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });
  const page = await context.newPage();
  try {
    await page.goto(`/transactions/new?type=income&month=${month}`);
    await expect(page.locator('.category-field-income')).toBeVisible();
    await expect(page.locator('.category-field-expense')).toBeHidden();
    await page.getByLabel('金額').fill('600');
    await page.locator('input[name="occurredOn"]').fill(`${month}-13`);
    await page.locator('.category-field-income select').selectOption({ label: '給与' });
    await page.getByLabel('メモ（任意）').fill(`${marker}:direct-income`);
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
    const row = page.locator('.transaction-link').filter({ hasText: `${marker}:direct-income` });
    await expect(row).toHaveCount(1);
    await row.click();
    await expect(page.getByRole('heading', { name: '取引を編集' })).toBeVisible();
    await page.getByLabel('金額').fill('700');
    await page.getByRole('button', { name: '変更を保存' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
    await expect(
      page.locator('.transaction-link').filter({ hasText: `${marker}:direct-income` }),
    ).toContainText('700円');
    await page
      .locator('.transaction-link')
      .filter({ hasText: `${marker}:direct-income` })
      .click();
    await page.locator('.delete-confirm > summary').click();
    await page.getByRole('button', { name: '削除を確定' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
    await expect(
      page.locator('.transaction-link').filter({ hasText: `${marker}:direct-income` }),
    ).toHaveCount(0);
  } finally {
    await context.close();
    await clearRunTransfers(databaseClient);
  }
});

test('navigates from the ledger, creates exactly one transfer, and preserves cashflow totals', async ({
  page,
}) => {
  if (!databaseClient) {
    throw new Error('transfer test database is not initialized');
  }
  await clearRunTransfers(databaseClient);

  await page.goto(`/?month=${month}`);
  const incomeBefore = await page.getByRole('group', { name: '収入' }).locator('dd').textContent();
  const expenseBefore = await page
    .getByRole('group', { name: 'この月の支出' })
    .getByText(/円$/)
    .textContent();

  await page.goto(`/transactions?month=${month}`);
  await expect(runTransferRows(page)).toHaveCount(0);
  await page.getByRole('link', { name: '＋ 取引を追加', exact: true }).click();
  await expect(page.getByRole('heading', { name: '新規登録' })).toBeVisible();
  await page.getByText('振替', { exact: true }).click();

  await page.getByLabel('振替元').selectOption({ label: fromName });
  await page.getByLabel('振替先').selectOption({ label: fromName });
  await page.getByLabel('金額').fill('3,000');
  await page.locator('input[name="occurredOn"]').fill(`${month}-10`);
  await page.getByRole('button', { name: '登録する' }).click();
  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(page).toHaveURL(/\/transactions\/new/);

  await page.getByLabel('振替先').selectOption({ label: toName });
  await page.getByLabel('金額').fill('0');
  await page.getByRole('button', { name: '登録する' }).click();
  await page.getByRole('button', { name: '閉じる' }).click();
  await page.getByLabel('金額').fill('1.0');
  await expect(page.locator('.amount-input-error')).toContainText('整数で入力してください');
  await page.goto(`/transactions?month=${month}`);
  await expect(runTransferRows(page)).toHaveCount(0);

  await page.getByRole('link', { name: '＋ 取引を追加', exact: true }).click();
  await page.getByText('振替', { exact: true }).click();
  await page.getByLabel('振替元').selectOption({ label: fromName });
  await page.getByLabel('振替先').selectOption({ label: toName });
  await page.getByLabel('金額').fill('3,000');
  await page.locator('input[name="occurredOn"]').fill(`${month}-10`);
  await page.getByLabel('メモ（任意）').fill(`${marker}:作成`);
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  const transferRows = runTransferRows(page);
  await expect(transferRows).toHaveCount(1);
  await expect(transferRows).toContainText(fromName);
  await expect(transferRows).toContainText(toName);
  await expect(transferRows).toContainText('3,000円');

  await page.goto(`/?month=${month}`);
  await expect(page.getByRole('group', { name: '収入' }).locator('dd')).toHaveText(
    incomeBefore ?? '',
  );
  await expect(page.getByRole('group', { name: 'この月の支出' }).getByText(/円$/)).toHaveText(
    expenseBefore ?? '',
  );
});

test('edits a transfer and reflects the changed from and to accounts', async ({ page }) => {
  await seedRunTransfer();
  await page.goto(`/transactions?month=${month}`);
  await expect(runTransferRows(page)).toHaveCount(1);
  await runTransferRows(page).click();
  await expect(page.getByRole('heading', { name: '取引を編集' })).toBeVisible();
  await expect(page.getByLabel('振替元')).toHaveValue(/^\d+$/);
  await expect(page.getByLabel('振替先')).toHaveValue(/^\d+$/);

  await page.getByLabel('振替元').selectOption({ label: toName });
  await page.getByLabel('振替先').selectOption({ label: alternateName });
  await page.getByLabel('金額').fill('2,000');
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  const transferRow = runTransferRows(page);
  await expect(transferRow).toHaveCount(1);
  await expect(transferRow).toContainText(toName);
  await expect(transferRow).toContainText(alternateName);
  await expect(transferRow).toContainText('2,000円');
});

test('renders transfers with the same row geometry and neutral amount tone', async ({ page }) => {
  if (!databaseClient) {
    throw new Error('transfer test database is not initialized');
  }
  await clearRunTransfers(databaseClient);
  await seedRunTransfer();
  await page.goto(`/transactions/new?month=${month}`);
  await page.getByLabel('金額').fill('100');
  await page.locator('input[name="occurredOn"]').fill(`${month}-11`);
  await page.locator('.category-field-expense select').selectOption({ label: '食費' });
  await page.getByLabel('メモ（任意）').fill(`${marker}:visual-expense`);
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));

  const transferRow = runTransferRows(page);
  const ordinaryRow = page
    .locator('.transaction-link')
    .filter({ hasText: `${marker}:visual-expense` });
  await expect(transferRow).toHaveCount(1);
  await expect(ordinaryRow).toHaveCount(1);
  await expect(transferRow.locator('.transaction-memo')).toHaveCount(1);
  await expect(ordinaryRow.locator('.transaction-memo')).toHaveCount(1);
  await expect(transferRow).not.toContainText('振替');
  await expect(transferRow).not.toContainText('編集');
  await expect(transferRow.locator('.row-affordance')).toHaveText('›');
  const transferDot = await transferRow.locator('.transfer-dot').boundingBox();
  const ordinaryDot = await ordinaryRow.locator('.category-dot').boundingBox();
  if (!transferDot || !ordinaryDot) {
    throw new Error('row dots are not measurable');
  }
  expect(transferDot.width).toBeCloseTo(ordinaryDot.width, 1);
  expect(transferDot.height).toBeCloseTo(ordinaryDot.height, 1);
  expect(transferDot.x).toBeCloseTo(ordinaryDot.x, 1);
  const transferMain = await transferRow.locator('.transaction-main').boundingBox();
  const ordinaryMain = await ordinaryRow.locator('.transaction-main').boundingBox();
  const transferAmount = await transferRow.locator('.record-amount').boundingBox();
  const ordinaryAmount = await ordinaryRow.locator('.record-amount').boundingBox();
  const transferAffordance = await transferRow.locator('.row-affordance').boundingBox();
  const ordinaryAffordance = await ordinaryRow.locator('.row-affordance').boundingBox();
  const transferLink = await transferRow.boundingBox();
  const ordinaryLink = await ordinaryRow.boundingBox();
  if (
    !transferMain ||
    !ordinaryMain ||
    !transferAmount ||
    !ordinaryAmount ||
    !transferAffordance ||
    !ordinaryAffordance ||
    !transferLink ||
    !ordinaryLink
  ) {
    throw new Error('row geometry is not measurable');
  }
  expect(transferMain.x).toBeCloseTo(ordinaryMain.x, 1);
  expect(transferAmount.x + transferAmount.width).toBeCloseTo(
    ordinaryAmount.x + ordinaryAmount.width,
    1,
  );
  expect(transferAffordance.x).toBeCloseTo(ordinaryAffordance.x, 1);
  expect(transferLink.height).toBeCloseTo(ordinaryLink.height, 1);
  const transferAmountElement = transferRow.locator('.record-amount');
  await expect(transferAmountElement).toHaveClass(/(^|\s)neutral(\s|$)/);
  const transferNeutralColors = await transferAmountElement.evaluate((element) => {
    const token = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
    const probe = document.createElement('span');
    probe.style.color = token;
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return { actual: getComputedStyle(element).color, expected };
  });
  expect(transferNeutralColors.actual).toBe(transferNeutralColors.expected);
  const transferAmountColor = await transferRow
    .locator('.record-amount')
    .evaluate((element) => getComputedStyle(element).color);
  const ordinaryAmountColor = await ordinaryRow
    .locator('.record-amount')
    .evaluate((element) => getComputedStyle(element).color);
  expect(transferAmountColor).not.toBe(ordinaryAmountColor);
  const transferHref = await transferRow.getAttribute('href');
  const ordinaryHref = await ordinaryRow.getAttribute('href');
  if (!transferHref || !ordinaryHref) {
    throw new Error('edit links are missing');
  }
  await page.goto(ordinaryHref);
  const ordinaryDelete = page.locator('.delete-confirm > summary');
  const ordinaryDeleteBox = await ordinaryDelete.boundingBox();
  await expect(ordinaryDelete).toHaveText('削除する');
  await page.goto(transferHref);
  const transferDelete = page.locator('.delete-confirm > summary');
  const transferDeleteBox = await transferDelete.boundingBox();
  if (!ordinaryDeleteBox || !transferDeleteBox) {
    throw new Error('delete controls are not measurable');
  }
  expect(transferDeleteBox.x).toBeCloseTo(ordinaryDeleteBox.x, 1);
  expect(transferDeleteBox.width).toBeCloseTo(ordinaryDeleteBox.width, 1);
  expect(transferDeleteBox.height).toBeCloseTo(ordinaryDeleteBox.height, 1);
});
test('matches delete control dimensions to save controls on desktop and mobile', async ({
  page,
}) => {
  if (!databaseClient) {
    throw new Error('transfer test database is not initialized');
  }
  await clearRunTransfers(databaseClient);
  await seedRunTransfer();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/transactions/new?month=${month}`);
  await page.getByLabel('金額').fill('100');
  await page.locator('input[name="occurredOn"]').fill(`${month}-11`);
  await page.locator('.category-field-expense select').selectOption({ label: '食費' });
  await page.getByLabel('メモ（任意）').fill(`${marker}:delete-geometry`);
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));

  const transferRow = runTransferRows(page);
  const ordinaryRow = page
    .locator('.transaction-link')
    .filter({ hasText: `${marker}:delete-geometry` });
  const transferHref = await transferRow.getAttribute('href');
  const ordinaryHref = await ordinaryRow.getAttribute('href');
  if (!transferHref || !ordinaryHref) {
    throw new Error('delete geometry edit links are missing');
  }

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    let ordinarySummaryMetrics: ButtonMetrics | undefined;
    let ordinaryConfirmationMetrics: ButtonMetrics | undefined;
    for (const [kind, href] of [
      ['ordinary', ordinaryHref],
      ['transfer', transferHref],
    ] as const) {
      await page.goto(href);
      await expect(page.getByRole('heading', { name: '取引を編集' })).toBeVisible();
      const saveButton = page.getByRole('button', { name: '変更を保存' });
      const deleteSummary = page.locator('.delete-confirm > summary');
      const saveMetrics = await buttonMetrics(saveButton);
      const summaryMetrics = await buttonMetrics(deleteSummary);
      expectButtonMetricsToMatch(summaryMetrics, saveMetrics);
      expect(summaryMetrics.width).toBeGreaterThan(0);
      expect(summaryMetrics.width).toBeLessThan(viewport.width);
      await deleteSummary.click();
      const confirmationButton = page.getByRole('button', { name: '削除を確定' });
      const cancelLink = page.getByRole('link', { name: 'キャンセル' });
      await expect(confirmationButton).toBeVisible();
      await expect(cancelLink).toBeVisible();
      const confirmationMetrics = await buttonMetrics(confirmationButton);
      expectButtonMetricsToMatch(confirmationMetrics, saveMetrics);
      expect(confirmationMetrics.width).toBeGreaterThan(0);
      expect(confirmationMetrics.width).toBeLessThan(viewport.width);
      await assertDeleteConfirmationDoesNotOverlapForm(page);
      await assertNoHorizontalOverflow(page);
      if (kind === 'ordinary') {
        ordinarySummaryMetrics = summaryMetrics;
        ordinaryConfirmationMetrics = confirmationMetrics;
      } else {
        if (!ordinarySummaryMetrics || !ordinaryConfirmationMetrics) {
          throw new Error('ordinary delete metrics were not captured');
        }
        expect(summaryMetrics.width).toBeCloseTo(ordinarySummaryMetrics.width, 1);
        expect(summaryMetrics.height).toBeCloseTo(ordinarySummaryMetrics.height, 1);
        expect(confirmationMetrics.width).toBeCloseTo(ordinaryConfirmationMetrics.width, 1);
        expect(confirmationMetrics.height).toBeCloseTo(ordinaryConfirmationMetrics.height, 1);
      }
    }
  }
});

test('supports keyboard-only create/edit/delete and mobile layouts without overflow', async ({
  page,
}) => {
  if (!databaseClient) {
    throw new Error('transfer test database is not initialized');
  }
  await clearRunTransfers(databaseClient);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/transactions?month=${month}`);
  await assertNoHorizontalOverflow(page);

  const addLink = page.getByRole('link', { name: '＋ 取引を追加', exact: true });
  await addLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '新規登録' })).toBeVisible();
  await page.getByText('振替', { exact: true }).click();
  await assertNoHorizontalOverflow(page);

  const fromSelect = page.getByLabel('振替元');
  const toSelect = page.getByLabel('振替先');
  const amountInput = page.getByLabel('金額');
  const memoInput = page.getByLabel('メモ（任意）');
  await selectOptionByKeyboard(fromSelect, fromName);
  await selectOptionByKeyboard(toSelect, toName);
  await amountInput.focus();
  await amountInput.pressSequentially('3,000');
  await memoInput.focus();
  await memoInput.pressSequentially(`${marker}:keyboard`);
  const createButton = page.getByRole('button', { name: '登録する' });
  await createButton.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await assertNoHorizontalOverflow(page);
  await expect(runTransferRows(page)).toHaveCount(1);

  const transferLink = runTransferRows(page);
  await transferLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '取引を編集' })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await selectOptionByKeyboard(page.getByLabel('振替元'), toName);
  await selectOptionByKeyboard(page.getByLabel('振替先'), alternateName);
  await amountInput.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await amountInput.pressSequentially('2,000');
  const saveButton = page.getByRole('button', { name: '変更を保存' });
  await saveButton.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await assertNoHorizontalOverflow(page);
  await expect(transferLink).toContainText(toName);
  await expect(transferLink).toContainText(alternateName);

  await transferLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '取引を編集' })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  const deleteSummary = page.locator('.delete-confirm > summary');
  await deleteSummary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.delete-confirmation')).toContainText('この取引を削除しますか？');
  await assertDeleteConfirmationDoesNotOverlapForm(page);
  await assertNoHorizontalOverflow(page);
  const deleteButton = page.getByRole('button', { name: '削除を確定' });
  await deleteButton.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(runTransferRows(page)).toHaveCount(0);
  await assertNoHorizontalOverflow(page);
});

test('focuses a not-found delete error after the transfer was removed elsewhere', async ({
  page,
}) => {
  if (!databaseClient) {
    throw new Error('transfer test database is not initialized');
  }
  await seedRunTransfer();
  await page.goto(`/transactions?month=${month}`);
  const transferHref = await runTransferRows(page).getAttribute('href');
  const transferId = Number(transferHref?.match(/\/transfers\/(\d+)\/edit$/)?.[1]);
  await runTransferRows(page).click();
  await expect(page.getByRole('heading', { name: '取引を編集' })).toBeVisible();
  if (!Number.isInteger(transferId)) {
    throw new Error('transfer id was not found in edit link');
  }
  await databaseClient.sql`
    delete from transfers
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and id = ${transferId}
      and memo like ${`${marker}%`}
  `;
  await page.locator('.delete-confirm > summary').click();
  await page.getByRole('button', { name: '削除を確定' }).click();
  await expect(page.locator('body')).toContainText('404');
});

test('supports transfer create, edit, delete confirmation/cancel, and server validation without JavaScript', async ({
  browser,
}) => {
  if (!databaseClient) {
    throw new Error('transfer test database is not initialized');
  }
  await clearRunTransfers(databaseClient);
  const context = await browser.newContext({
    javaScriptEnabled: false,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });
  const page = await context.newPage();
  try {
    await page.goto(`/transactions/new?type=transfer&month=${month}`);
    await page.getByLabel('振替元').selectOption({ label: fromName });
    await page.getByLabel('振替先').selectOption({ label: toName });
    await page.getByLabel('金額').fill('1.0');
    await page.locator('input[name="occurredOn"]').fill(`${month}-10`);
    await page.getByLabel('メモ（任意）').fill(`${marker}:no-js`);
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page).toHaveURL(/\/transactions\/new\?type=transfer/);
    await expect(page.locator('.form-error-dialog')).toContainText(
      '金額は整数で入力してください。',
    );

    await page.getByLabel('金額').fill('3,000');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
    await expect(runTransferRows(page)).toHaveCount(1);

    await runTransferRows(page).click();
    await page.getByLabel('振替元').selectOption({ label: toName });
    await page.getByLabel('振替先').selectOption({ label: alternateName });
    await page.getByLabel('金額').fill('2,000');
    await page.getByRole('button', { name: '変更を保存' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
    await expect(runTransferRows(page)).toContainText(toName);
    await expect(runTransferRows(page)).toContainText(alternateName);

    await runTransferRows(page).click();
    const deleteSummary = page.locator('.delete-confirm > summary');
    await deleteSummary.click();
    await expect(page.locator('.delete-confirmation')).toContainText('この取引を削除しますか？');
    await page.getByRole('link', { name: 'キャンセル' }).click();
    await expect(page.getByRole('heading', { name: '取引を編集' })).toBeVisible();
    await page.locator('.delete-confirm > summary').click();
    await page.getByRole('button', { name: '削除を確定' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
    await expect(runTransferRows(page)).toHaveCount(0);
  } finally {
    await context.close();
    await clearRunTransfers(databaseClient);
  }
});

test('supports all three entry types without JavaScript, including conversion and delete', async ({
  browser,
}) => {
  if (!databaseClient) {
    throw new Error('transfer test database is not initialized');
  }
  await clearRunTransfers(databaseClient);
  const context = await browser.newContext({
    javaScriptEnabled: false,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });
  const page = await context.newPage();
  try {
    await page.goto(`/transactions/new?type=expense&month=${month}`);
    await page.getByLabel('金額').fill('100');
    await page.locator('input[name="occurredOn"]').fill(`${month}-11`);
    await page.locator('.category-field-expense select').selectOption({ label: '食費' });
    await page.getByLabel('メモ（任意）').fill(`${marker}:expense`);
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));

    const entryRow = page.locator('.transaction-link').filter({ hasText: marker });
    await expect(entryRow).toHaveCount(1);
    await entryRow.click();
    await expect(page.getByRole('heading', { name: '取引を編集' })).toBeVisible();

    await page.getByText('振替', { exact: true }).click();
    await page.getByLabel('振替元').selectOption({ label: fromName });
    await page.getByLabel('振替先').selectOption({ label: toName });
    await page.getByLabel('メモ（任意）').fill(`${marker}:transfer`);
    await page.getByRole('button', { name: '変更を保存' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
    await expect(runTransferRows(page)).toHaveCount(1);

    await runTransferRows(page).click();
    await expect(page.getByRole('heading', { name: '取引を編集' })).toBeVisible();
    await page.getByText('支出', { exact: true }).click();
    await page.locator('.category-field-expense select').selectOption({ label: '食費' });
    await page.getByLabel('メモ（任意）').fill(`${marker}:converted-expense`);
    await page.getByRole('button', { name: '変更を保存' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
    await expect(runTransferRows(page)).toHaveCount(0);

    const expenseRow = page.locator('.transaction-link').filter({
      hasText: `${marker}:converted-expense`,
    });
    await expect(expenseRow).toHaveCount(1);
    await expenseRow.click();
    await page.getByText('収入', { exact: true }).click();
    await page.locator('.category-field-income select').selectOption({ label: '給与' });
    await page.getByLabel('メモ（任意）').fill(`${marker}:income`);
    await page.getByRole('button', { name: '変更を保存' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));

    const convertedRow = page.locator('.transaction-link').filter({ hasText: `${marker}:income` });
    await expect(convertedRow).toHaveCount(1);
    await convertedRow.click();
    await page.locator('.delete-confirm > summary').click();
    await page.getByRole('button', { name: '削除を確定' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
    await expect(page.locator('.transaction-link').filter({ hasText: marker })).toHaveCount(0);
  } finally {
    await context.close();
    await clearRunTransfers(databaseClient);
  }
});
