import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
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
const markerPrefix = `${E2E_MARKER_PREFIX}${runId}:card-billing:`;
const cardName = `${markerPrefix}fictional card`;
const missingSettingsCardName = `${markerPrefix}missing settings card`;
const debitAccountName = `${markerPrefix}debit account`;
const firstUsageMemo = `${markerPrefix}usage one`;
const secondUsageMemo = `${markerPrefix}usage two`;
const refundMemo = `${markerPrefix}refund`;
const initialPaymentMemo = `${markerPrefix}initial payment`;
const firstUsageDate = '2025-12-10';
const secondUsageDate = '2026-01-20';
const unbilledUsageDate = '2099-01-05';
const refundDate = '2026-01-25';
const closingDay = '15';
const unbilledUsageMemo = `${markerPrefix}unbilled usage`;
const paymentDay = '10';
const paymentMonthOffset = 'next_month';

let databaseClient: DatabaseClient | undefined;
let databaseTarget: DatabaseTarget;
let cardAccountId = 0;
let missingSettingsCardId = 0;
let debitAccountId = 0;
let latestClosedPeriodText = '';

function database(): DatabaseClient {
  if (!databaseClient) throw new Error('card billing E2E database is not initialized');
  return databaseClient;
}

async function seedFixtures(): Promise<void> {
  const client = database();
  const accountRows = await client.sql<{ id: number; name: string }[]>`
    insert into accounts (household_id, name, kind)
    values
      (${DEFAULT_HOUSEHOLD_ID}, ${cardName}, 'credit_card'),
      (${DEFAULT_HOUSEHOLD_ID}, ${missingSettingsCardName}, 'credit_card'),
      (${DEFAULT_HOUSEHOLD_ID}, ${debitAccountName}, 'bank')
    returning id, name
  `;
  const card = accountRows.find((account) => account.name === cardName);
  const missingCard = accountRows.find((account) => account.name === missingSettingsCardName);
  const debit = accountRows.find((account) => account.name === debitAccountName);
  if (!card || !missingCard || !debit)
    throw new Error('card billing account fixtures were not created');
  cardAccountId = card.id;
  missingSettingsCardId = missingCard.id;
  debitAccountId = debit.id;

  await client.sql`
    insert into account_card_settings (
      household_id,
      account_id,
      closing_day,
      payment_day,
      payment_month_offset,
      debit_account_id,
      auto_payment_enabled,
      auto_payment_enabled_on
    )
    values (
      ${DEFAULT_HOUSEHOLD_ID},
      ${cardAccountId},
      ${closingDay},
      ${paymentDay},
      ${paymentMonthOffset},
      ${debitAccountId},
      false,
      null
    )
  `;

  const categories = await client.sql<{ id: number; type: 'expense' | 'income' }[]>`
    select id, type
    from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and type in ('expense', 'income')
    order by id
  `;
  const expenseCategory = categories.find((category) => category.type === 'expense');
  const incomeCategory = categories.find((category) => category.type === 'income');
  if (!expenseCategory || !incomeCategory)
    throw new Error('card billing categories were not created');

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
    values
      (
        ${DEFAULT_HOUSEHOLD_ID},
        'expense',
        12000,
        ${firstUsageDate},
        ${expenseCategory.id},
        ${cardAccountId},
        ${firstUsageMemo}
      ),
      (
        ${DEFAULT_HOUSEHOLD_ID},
        'expense',
        9000,
        ${secondUsageDate},
        ${expenseCategory.id},
        ${cardAccountId},
        ${secondUsageMemo}
      ),
      (
        ${DEFAULT_HOUSEHOLD_ID},
        'expense',
        500,
        ${unbilledUsageDate},
        ${expenseCategory.id},
        ${cardAccountId},
        ${unbilledUsageMemo}
      ),
      (
        ${DEFAULT_HOUSEHOLD_ID},
        'income',
        1000,
        ${refundDate},
        ${incomeCategory.id},
        ${cardAccountId},
        ${refundMemo}
      )
  `;
  await client.sql`
    insert into transfers (
      household_id,
      from_account_id,
      to_account_id,
      amount,
      occurred_on,
      memo
    )
    values (
      ${DEFAULT_HOUSEHOLD_ID},
      ${debitAccountId},
      ${cardAccountId},
      12000,
      '2026-01-10',
      ${initialPaymentMemo}
    )
  `;
}

async function cleanupFixtures(): Promise<void> {
  const client = database();
  assertCleanupMarker(markerPrefix);
  await client.sql`
    delete from transfers
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and (
        memo like ${`${markerPrefix}%`}
        or from_account_id in (
          select id from accounts where household_id = ${DEFAULT_HOUSEHOLD_ID} and name like ${`${markerPrefix}%`}
        )
        or to_account_id in (
          select id from accounts where household_id = ${DEFAULT_HOUSEHOLD_ID} and name like ${`${markerPrefix}%`}
        )
      )
  `;
  await client.sql`
    delete from transactions
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and memo like ${`${markerPrefix}%`}
  `;
  await client.sql`
    delete from card_auto_payment_runs
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and card_account_id in (
        select id from accounts where household_id = ${DEFAULT_HOUSEHOLD_ID} and name like ${`${markerPrefix}%`}
      )
  `;
  await client.sql`
    delete from account_card_settings
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and account_id in (
        select id from accounts where household_id = ${DEFAULT_HOUSEHOLD_ID} and name like ${`${markerPrefix}%`}
      )
  `;
  await client.sql`
    delete from accounts
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and name like ${`${markerPrefix}%`}
  `;
}

function cardTransactionsUrl(): string {
  return `/transactions?account=${cardAccountId}&month=all`;
}

function latestClosedStatement(page: Page) {
  return page.locator('[data-latest-closed="true"]');
}

test.beforeAll(async () => {
  const safeTestDatabase = assertSafeTestDatabaseTarget();
  databaseTarget = safeTestDatabase.target;
  databaseClient = createDatabaseClient(safeTestDatabase.url);
  try {
    await verifySafeTestDatabaseConnection(
      databaseClient.sql,
      databaseTarget,
      process.env.DATABASE_URL,
    );
    await initializeDefaultLedger(databaseClient.db);
    await seedFixtures();
  } catch (error) {
    await databaseClient.close();
    databaseClient = undefined;
    throw error;
  }
});

test.afterAll(async () => {
  if (!databaseClient) return;
  try {
    await verifySafeTestDatabaseConnection(
      databaseClient.sql,
      databaseTarget,
      process.env.DATABASE_URL,
    );
    await cleanupFixtures();
  } finally {
    await databaseClient.close();
    databaseClient = undefined;
  }
});

test.describe.configure({ mode: 'serial' });

test('shows a settings link for a card with missing settings', async ({ page }) => {
  await page.goto('/balances');
  const row = page.getByRole('listitem').filter({ hasText: missingSettingsCardName });
  await expect(row.getByRole('link', { name: '設定', exact: true })).toHaveAttribute(
    'href',
    `/accounts/${missingSettingsCardId}/edit`,
  );
});
test('shows the same-month schedule error on the payment day field', async ({ page }) => {
  await page.goto(`/accounts/${cardAccountId}/edit`);
  await page.locator('#closing-day').selectOption(closingDay);
  await page.locator('#payment-day').selectOption(closingDay);
  await page.locator('#payment-month-offset').selectOption('same_month');
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page.locator('#payment-day-error')).toContainText(
    '同月払いでは、支払日が締め日より後になる設定にしてください。',
  );
  await expect(page.locator('#payment-day')).toHaveAttribute('aria-invalid', 'true');
});

test('shows derived statements and filters usage details by period', async ({ page }) => {
  await page.goto(cardTransactionsUrl());
  await expect(page.locator('.card-statement')).toHaveCount(2);

  const statement = latestClosedStatement(page);
  latestClosedPeriodText = (await statement.locator('h3').textContent()) ?? '';
  await expect(statement).toContainText('8,000円');
  await statement.getByRole('link', { name: 'この期間の取引' }).click();
  await expect(page).toHaveURL(/periodStart=\d{4}-\d{2}-\d{2}&periodEnd=\d{4}-\d{2}-\d{2}/);
  await expect(page.getByText(secondUsageMemo)).toBeVisible();
  await expect(page.getByText(refundMemo)).toBeVisible();
  await expect(page.getByText(firstUsageMemo)).toHaveCount(0);
});

test('records a partial payment and updates remaining', async ({ page }) => {
  await page.goto(cardTransactionsUrl());
  const statement = latestClosedStatement(page);
  latestClosedPeriodText = (await statement.locator('h3').textContent()) ?? latestClosedPeriodText;
  await statement.getByRole('link', { name: '支払いを記録' }).click();
  await expect(page).toHaveURL(/\/transactions\/new\?/);
  await expect(page.locator('#transaction-amount')).toHaveValue('8000');
  await expect(page.locator('#transaction-date')).toHaveValue('2026-03-10');
  await expect(page.locator('#transaction-from-account')).toHaveValue(String(debitAccountId));
  await expect(page.locator('#transaction-to-account')).toHaveValue(String(cardAccountId));

  await page.locator('#transaction-amount').fill('3000');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?account=${cardAccountId}.*month=all`));
  const updated = page.locator('.card-statement').filter({ hasText: latestClosedPeriodText });
  await expect(updated).toContainText('5,000円');
});

test('edits and deletes the payment and recomputes the statement', async ({ page }) => {
  await page.goto(cardTransactionsUrl());
  await page.getByRole('link', { name: /振替.*3,000円/ }).click();
  await page.locator('#transaction-amount').fill('4000');
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page).toHaveURL(/\/transactions\?month=\d{4}-\d{2}/);
  await page.goto(cardTransactionsUrl());
  await expect(
    page.locator('.card-statement').filter({ hasText: latestClosedPeriodText }),
  ).toContainText('4,000円');

  await page.getByRole('link', { name: /振替.*4,000円/ }).click();
  await page.getByText('削除する', { exact: true }).click();
  await page.getByRole('button', { name: '削除を確定' }).click();
  await expect(page).toHaveURL(/\/transactions\?month=\d{4}-\d{2}/);
  await page.goto(cardTransactionsUrl());
  await expect(
    page.locator('.card-statement').filter({ hasText: latestClosedPeriodText }),
  ).toContainText('8,000円');
});

test('shows an inline note for an overpayment and keeps auto payment off by default', async ({
  page,
}) => {
  await page.goto(cardTransactionsUrl());
  const statement = latestClosedStatement(page);
  await statement.getByRole('link', { name: '支払いを記録' }).click();
  await page.locator('#transaction-amount').fill('9000');
  await expect(
    page.getByText('選択した請求の残りを超えています。超過分は次の請求に充てられます。'),
  ).toBeVisible();

  await page.goto(`/accounts/${cardAccountId}/edit`);
  await expect(page.locator('select[name="autoPaymentEnabled"]')).toHaveValue('');
});
