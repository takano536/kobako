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
import { chooseEmptyMonthPair, monthIsEmpty } from './e2e-safety';

const runId = randomUUID();
const marker = `e2e-transfer:${runId}`;
test.describe.configure({ mode: 'serial' });
let databaseClient: DatabaseClient | undefined;
let month = '';
let fromName = '';
let toName = '';
let alternateName = '';

async function clearRunTransfers(client: DatabaseClient): Promise<void> {
  await client.sql`
    delete from transfers
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and memo like ${`${marker}%`}
  `;
}
function runTransferRows(page: Page): Locator {
  return page.locator('.transaction-transfer-link').filter({ hasText: marker });
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
    return [
      ...document.querySelectorAll('.transfer-form .field, .transfer-form .save-button'),
    ].some((target) => {
      const targetRect = target.getBoundingClientRect();
      return (
        confirmationRect.left < targetRect.right &&
        confirmationRect.right > targetRect.left &&
        confirmationRect.top < targetRect.bottom &&
        confirmationRect.bottom > targetRect.top
      );
    });
  });
  expect(overlaps).toBe(false);
}

async function deleteRunTransfersAndAccounts(client: DatabaseClient): Promise<void> {
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
      and name like ${`${marker}%`}
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
  await page.getByRole('link', { name: '＋ 振替を追加', exact: true }).click();
  await expect(page.getByRole('heading', { name: '振替を追加' })).toBeVisible();

  await page.getByLabel('振替元').selectOption({ label: fromName });
  await page.getByLabel('振替先').selectOption({ label: fromName });
  await page.getByLabel('金額').fill('3,000');
  await page.locator('input[name="occurredOn"]').fill(`${month}-10`);
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page.locator('.transfer-form-errors')).toContainText('振替元と振替先');
  await expect(page).toHaveURL(/\/transactions\/transfers\/new/);

  await page.getByLabel('振替先').selectOption({ label: toName });
  await page.getByLabel('金額').fill('0');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page.locator('.transfer-form-errors')).toContainText('金額は1円以上');
  await page.getByLabel('金額').fill('1.0');
  await expect(page.locator('.amount-input-error')).toContainText('整数で入力してください');
  await page.goto(`/transactions?month=${month}`);
  await expect(runTransferRows(page)).toHaveCount(0);

  await page.getByRole('link', { name: '＋ 振替を追加', exact: true }).click();
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
  await expect(page.getByRole('heading', { name: '振替を編集' })).toBeVisible();
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

  const addLink = page.getByRole('link', { name: '＋ 振替を追加', exact: true });
  await addLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '振替を追加' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: '振替を編集' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: '振替を編集' })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  const deleteSummary = page.locator('.delete-confirm > summary');
  await deleteSummary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.delete-confirmation')).toContainText(`${toName} → ${alternateName}`);
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
  await expect(page.getByRole('heading', { name: '振替を編集' })).toBeVisible();
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
  const deleteError = page.locator('.delete-action p[role="alert"]');
  await expect(deleteError).toContainText('振替が見つかりません。');
  await expect(deleteError).toBeFocused();
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
    await page.goto(`/transactions/transfers/new?month=${month}`);
    await page.getByLabel('振替元').selectOption({ label: fromName });
    await page.getByLabel('振替先').selectOption({ label: toName });
    await page.getByLabel('金額').fill('1.0');
    await page.locator('input[name="occurredOn"]').fill(`${month}-10`);
    await page.getByLabel('メモ（任意）').fill(`${marker}:no-js`);
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page).toHaveURL(/\/transactions\/transfers\/new/);
    await expect(page.locator('.transfer-form-errors')).toContainText(
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
    await expect(page.locator('.delete-confirmation')).toContainText('次の振替を削除しますか？');
    await page.getByRole('link', { name: 'キャンセル' }).click();
    await expect(page.getByRole('heading', { name: '振替を編集' })).toBeVisible();
    await page.locator('.delete-confirm > summary').click();
    await page.getByRole('button', { name: '削除を確定' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
    await expect(runTransferRows(page)).toHaveCount(0);
  } finally {
    await context.close();
    await clearRunTransfers(databaseClient);
  }
});
