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
