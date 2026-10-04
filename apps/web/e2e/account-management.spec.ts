import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import {
  DEFAULT_HOUSEHOLD_ID,
  assertSafeTestDatabaseTarget,
  createDatabaseClient,
  initializeDefaultLedger,
  verifySafeTestDatabaseConnection,
  type DatabaseClient,
} from '@kobako/db';

const runId = randomUUID();
const assetName = `E2E asset ${runId}`;
const reviewPrefix = `E2E asset review ${runId}:`;

let databaseClient: DatabaseClient | undefined;

function database(): DatabaseClient {
  if (!databaseClient) throw new Error('asset-management E2E database is not initialized');
  return databaseClient;
}

async function cleanupReviewFixtures(): Promise<void> {
  if (!databaseClient) return;
  const rows = await databaseClient.sql<{ id: number }[]>`
    select id from accounts
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and (name like ${`${assetName}%`} or name like ${`${reviewPrefix}%`})
  `;
  for (const row of rows) {
    await databaseClient.sql`
      delete from account_card_conditions
      where household_id = ${DEFAULT_HOUSEHOLD_ID}
        and (account_id = ${row.id} or debit_account_id = ${row.id})
    `;
    await databaseClient.sql`
      delete from account_card_settings
      where household_id = ${DEFAULT_HOUSEHOLD_ID}
        and (account_id = ${row.id} or debit_account_id = ${row.id})
    `;
    await databaseClient.sql`
      delete from transfers
      where household_id = ${DEFAULT_HOUSEHOLD_ID}
        and (from_account_id = ${row.id} or to_account_id = ${row.id})
    `;
    await databaseClient.sql`
      delete from transactions
      where household_id = ${DEFAULT_HOUSEHOLD_ID} and account_id = ${row.id}
    `;
    await databaseClient.sql`
      delete from accounts
      where household_id = ${DEFAULT_HOUSEHOLD_ID} and id = ${row.id}
    `;
  }
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
  } catch (error) {
    await databaseClient.close();
    databaseClient = undefined;
    throw error;
  }
});

test.afterEach(cleanupReviewFixtures);

test.afterAll(async () => {
  if (!databaseClient) return;
  try {
    const safeTestDatabase = assertSafeTestDatabaseTarget();
    await verifySafeTestDatabaseConnection(
      databaseClient.sql,
      safeTestDatabase.target,
      process.env.DATABASE_URL,
    );
    await cleanupReviewFixtures();
  } finally {
    await databaseClient.close();
    databaseClient = undefined;
  }
});

test.describe.configure({ mode: 'serial' });

test('registers an asset, filters transactions, and opens unified settings', async ({ page }) => {
  await page.goto('/balances');
  await page.getByRole('link', { name: '資産を登録' }).first().click();
  await expect(page.getByRole('heading', { name: '資産を登録' })).toBeVisible();
  await page.getByLabel('名前', { exact: true }).fill(assetName);
  await page.getByLabel('種別', { exact: true }).selectOption('bank');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(/\/transactions\?account=\d+&month=all$/);
  await expect(page.getByRole('heading', { name: assetName, exact: true })).toBeVisible();
  const settings = page.getByRole('link', { name: '資産設定', exact: true });
  await expect(settings).toBeVisible();
  await settings.click();
  await expect(page.getByRole('heading', { name: '資産設定' })).toBeVisible();
  await expect(page.getByLabel('名前', { exact: true })).toHaveValue(assetName);
  const renamedAssetName = `${assetName}変更後`;
  await page.getByLabel('名前', { exact: true }).fill(renamedAssetName);
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page).toHaveURL(/\/transactions\?account=\d+&month=all&saved=1$/);
  await expect(page.getByRole('heading', { name: renamedAssetName, exact: true })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
});

test('keeps transaction references when an asset is logically deleted', async ({ page }) => {
  const deletedName = `${reviewPrefix}deleted`;
  const [category] = await database().sql<{ id: number }[]>`
    select id from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and type = 'expense'
    order by id limit 1
  `;
  if (!category) throw new Error('logical-delete fixtures are missing');
  const [asset] = await database().sql<{ id: number }[]>`
    insert into accounts (household_id, name, kind, status, sort_order)
    values (${DEFAULT_HOUSEHOLD_ID}, ${deletedName}, 'bank', 'active', 10)
    returning id
  `;
  if (!asset) throw new Error('logical-delete asset was not created');
  await database().sql`
    insert into transactions (household_id, type, amount, occurred_on, category_id, account_id, memo)
    values (${DEFAULT_HOUSEHOLD_ID}, 'expense', 100, '2026-09-01', ${category.id}, ${asset.id}, '削除後も保持')
  `;
  await page.goto(`/accounts/${asset.id}/edit`);
  await page.locator('.delete-confirm > summary').click();
  await page.getByRole('button', { name: '削除を確定' }).click();
  await expect(page).toHaveURL('/balances');
  const deletedAt = await database().sql<{ deleted_at: string; status: string }[]>`
    select deleted_at::text as deleted_at, status from accounts where id = ${asset.id}
  `;
  expect(deletedAt).toEqual([{ deleted_at: expect.any(String), status: 'active' }]);
  expect(
    await database().sql<{ count: number }[]>`
      select count(*)::int as count from transactions where account_id = ${asset.id}
    `,
  ).toEqual([{ count: 1 }]);
});

test('shows card current conditions in the same asset settings form', async ({ page }) => {
  await page.goto('/accounts/new');
  const cardName = `${reviewPrefix}card`;
  await page.getByLabel('名前', { exact: true }).fill(cardName);
  await page.getByLabel('種別', { exact: true }).selectOption('credit_card');
  await expect(page.getByRole('heading', { name: 'カード条件' })).toBeVisible();
  await page.getByLabel('締め日').selectOption('last');
  await page.getByLabel('支払日').selectOption('10');
  await page.getByLabel('支払月').selectOption('next_month');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(/\/transactions\?account=\d+&month=all$/);
  const accountId = Number(new URL(page.url()).searchParams.get('account'));
  await page.getByRole('link', { name: '資産設定', exact: true }).click();
  await expect(page.getByLabel('締め日')).toHaveValue('last');
  await expect(page.getByLabel('支払日')).toHaveValue('10');
  await expect(page.getByLabel('支払月')).toHaveValue('next_month');
  await page.getByLabel('支払日').selectOption('');
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/transactions\\?account=${accountId}&month=all&saved=1$`),
  );
  await page.getByRole('link', { name: '資産設定', exact: true }).click();
  await expect(page.getByLabel('締め日')).toHaveValue('last');
  await expect(page.getByLabel('支払日')).toHaveValue('');
  await expect(page.getByLabel('支払月')).toHaveValue('next_month');
  await database().sql`
    insert into account_card_conditions (
      household_id, account_id, effective_from, closing_day, payment_day,
      payment_month_offset
    )
    values (
      ${DEFAULT_HOUSEHOLD_ID}, ${accountId}, '2999-01-01', '7', '8',
      'same_month'
    )
  `;
  await page.reload();
  await expect(page.getByLabel('締め日')).toHaveValue('last');
  await expect(page.getByLabel('支払日')).toHaveValue('');
  await expect(page.getByLabel('支払月')).toHaveValue('next_month');
});

test('rejects a stale edit after a credit card is soft-deleted', async ({ page }) => {
  const accountName = `${reviewPrefix}stale-deleted-card`;
  const [account] = await database().sql<{ id: number }[]>`
    insert into accounts (household_id, name, kind, status, sort_order)
    values (${DEFAULT_HOUSEHOLD_ID}, ${accountName}, 'credit_card', 'active', 10)
    returning id
  `;
  if (!account) throw new Error('stale deleted card fixture was not created');
  await database().sql`
    insert into account_card_settings (
      household_id, account_id, closing_day, payment_day, payment_month_offset
    )
    values (
      ${DEFAULT_HOUSEHOLD_ID}, ${account.id}, 'last', '10', 'next_month'
    )
  `;
  await page.goto(`/accounts/${account.id}/edit`);
  await expect(page.getByLabel('名前', { exact: true })).toHaveValue(accountName);
  await expect(page.getByLabel('締め日')).toHaveValue('last');

  await database().sql`
    update accounts set deleted_at = now()
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and id = ${account.id}
  `;
  const afterDelete = await database().sql<
    {
      name: string;
      kind: string;
      deleted_at: string | null;
      closing_day: string | null;
      payment_day: string | null;
      payment_month_offset: string | null;
      debit_account_id: number | null;
    }[]
  >`
    select
      a.name,
      a.kind,
      a.deleted_at::text as deleted_at,
      s.closing_day,
      s.payment_day,
      s.payment_month_offset,
      s.debit_account_id
    from accounts a
    join account_card_settings s
      on s.household_id = a.household_id and s.account_id = a.id
    where a.household_id = ${DEFAULT_HOUSEHOLD_ID} and a.id = ${account.id}
  `;
  await page.getByLabel('名前', { exact: true }).fill(`${accountName}変更`);
  await page.getByLabel('締め日').selectOption('15');
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(
    page.getByText('資産は削除済みのため保存できません。', { exact: true }),
  ).toBeVisible();
  expect(
    await database().sql<
      {
        name: string;
        kind: string;
        deleted_at: string | null;
        closing_day: string | null;
        payment_day: string | null;
        payment_month_offset: string | null;
        debit_account_id: number | null;
      }[]
    >`
      select
        a.name,
        a.kind,
        a.deleted_at::text as deleted_at,
        s.closing_day,
        s.payment_day,
        s.payment_month_offset,
        s.debit_account_id
      from accounts a
      join account_card_settings s
        on s.household_id = a.household_id and s.account_id = a.id
      where a.household_id = ${DEFAULT_HOUSEHOLD_ID} and a.id = ${account.id}
    `,
  ).toEqual(afterDelete);
});

test('create: submit empty name, fill name and kind with card field, save succeeds', async ({
  page,
}) => {
  const createdAccountName = `${reviewPrefix}created-account`;
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: '登録する' }).click();
  const nameErrorId = 'account-name-error';
  await expect(page.locator(`#${nameErrorId}`)).toBeVisible();
  await expect(page.getByLabel('名前', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  const nameInput = page.getByLabel('名前', { exact: true });
  await nameInput.fill(createdAccountName);
  await expect(nameInput).toHaveValue(createdAccountName);
  const kindInput = page.getByLabel('種別', { exact: true });
  await kindInput.selectOption('credit_card');
  await expect(kindInput).toHaveValue('credit_card');
  const closingDay = page.getByLabel('締め日');
  await closingDay.selectOption('15');
  await expect(closingDay).toHaveValue('15');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(/\/transactions\?account=\d+&month=all$/);
  const accountId = Number(new URL(page.url()).searchParams.get('account'));
  const accountRow = await database().sql<
    { name: string; kind: string }[]
  >`select name, kind from accounts where id = ${accountId}`;
  expect(accountRow).toEqual([{ name: createdAccountName, kind: 'credit_card' }]);
  const settingsRow = await database().sql<{ closing_day: string }[]>`
    select closing_day from account_card_settings where account_id = ${accountId}
  `;
  expect(settingsRow[0]?.closing_day).toBe('15');
});

test('edit: submit with empty name, fix and save succeeds', async ({ page }) => {
  const editTestAccountName = `${reviewPrefix}edit-test-account`;
  await page.goto('/accounts/new');
  await page.getByLabel('名前', { exact: true }).fill(editTestAccountName);
  await page.getByLabel('種別', { exact: true }).selectOption('bank');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(/\/transactions\?account=\d+&month=all$/);
  const accountId = Number(new URL(page.url()).searchParams.get('account'));
  await page.getByRole('link', { name: '資産設定', exact: true }).click();
  await page.getByLabel('名前', { exact: true }).fill('');
  await page.getByRole('button', { name: '保存する' }).click();
  const nameErrorId = 'account-name-error';
  await expect(page.locator(`#${nameErrorId}`)).toBeVisible();
  const fixedName = `${editTestAccountName}修正`;
  const nameInput = page.getByLabel('名前', { exact: true });
  await nameInput.fill(fixedName);
  await expect(nameInput).toHaveValue(fixedName);
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/transactions\\?account=${accountId}&month=all&saved=1$`),
  );
  const accountRow = await database().sql<{ name: string }[]>`
    select name from accounts where id = ${accountId}
  `;
  expect(accountRow).toEqual([{ name: fixedName }]);
});

test('kind change: select credit_card, confirmation required on save, check and edit card field', async ({
  page,
}) => {
  const kindChangeAccountName = `${reviewPrefix}kind-change`;
  await page.goto('/accounts/new');
  await page.getByLabel('名前', { exact: true }).fill(kindChangeAccountName);
  await page.getByLabel('種別', { exact: true }).selectOption('bank');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(/\/transactions\?account=\d+&month=all$/);
  const accountId = Number(new URL(page.url()).searchParams.get('account'));
  await page.getByRole('link', { name: '資産設定', exact: true }).click();
  await page.getByLabel('種別', { exact: true }).selectOption('credit_card');
  await page.getByRole('button', { name: '保存する' }).click();
  const confirmCheckbox = page.getByLabel('種別を変更することを確認しました');
  await expect(confirmCheckbox).toBeVisible();
  await confirmCheckbox.check();
  await expect(confirmCheckbox).toBeChecked();
  const closingDay = page.getByLabel('締め日');
  await closingDay.selectOption('last');
  await expect(closingDay).toHaveValue('last');
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/transactions\\?account=${accountId}&month=all&saved=1$`),
  );
  const accountRow = await database().sql<{ kind: string }[]>`
    select kind from accounts where id = ${accountId}
  `;
  expect(accountRow).toEqual([{ kind: 'credit_card' }]);
  const settingsRow = await database().sql<{ closing_day: string }[]>`
    select closing_day from account_card_settings where account_id = ${accountId}
  `;
  expect(settingsRow[0]?.closing_day).toBe('last');
});

test('kind change with field error: empty name, confirmation required, fix and confirm', async ({
  page,
}) => {
  const errorThenKindChangeAccountName = `${reviewPrefix}error-kind-change`;
  await page.goto('/accounts/new');
  await page.getByLabel('名前', { exact: true }).fill(errorThenKindChangeAccountName);
  await page.getByLabel('種別', { exact: true }).selectOption('bank');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(/\/transactions\?account=\d+&month=all$/);
  const accountId = Number(new URL(page.url()).searchParams.get('account'));
  await page.getByRole('link', { name: '資産設定', exact: true }).click();
  const nameInput = page.getByLabel('名前', { exact: true });
  await nameInput.fill('');
  await page.getByLabel('種別', { exact: true }).selectOption('credit_card');
  await page.getByRole('button', { name: '保存する' }).click();
  const nameErrorId = 'account-name-error';
  await expect(page.locator(`#${nameErrorId}`)).toBeVisible();
  const confirmCheckbox = page.getByLabel('種別を変更することを確認しました');
  const fixedName = `${errorThenKindChangeAccountName}修正`;
  await nameInput.fill(fixedName);
  await expect(nameInput).toHaveValue(fixedName);
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(confirmCheckbox).toBeVisible();
  await confirmCheckbox.check();
  await expect(confirmCheckbox).toBeChecked();
  const paymentDay = page.getByLabel('支払日');
  await paymentDay.selectOption('10');
  await expect(paymentDay).toHaveValue('10');
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/transactions\\?account=${accountId}&month=all&saved=1$`),
  );
  const accountRow = await database().sql<{ name: string; kind: string }[]>`
    select name, kind from accounts where id = ${accountId}
  `;
  expect(accountRow).toEqual([{ name: fixedName, kind: 'credit_card' }]);
});
