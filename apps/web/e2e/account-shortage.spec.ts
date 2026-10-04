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
import {
  E2E_MARKER_PREFIX,
  SENTINEL_CLEANUP_END_YEAR,
  SENTINEL_MIN_YEAR,
  assertCleanupMarker,
  chooseEmptyMonthPair,
} from './e2e-safety';

const runId = randomUUID();
const runMarkerPrefix = `${E2E_MARKER_PREFIX}${runId}:`;
const marker = `${runMarkerPrefix}account-shortage:`;
let databaseClient: DatabaseClient | undefined;
let month = '';

async function clearRunTransactions(client: DatabaseClient): Promise<void> {
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
    await clearRunTransactions(databaseClient);
  } finally {
    await databaseClient.close();
    databaseClient = undefined;
  }
});

test('allows ordinary registration and validates transfers with fewer than two accounts', async ({
  page,
}) => {
  if (!databaseClient) {
    throw new Error('account shortage test database is not initialized');
  }
  const protectedAccounts = await databaseClient.sql<{ count: string }[]>`
    select count(*)::text as count
    from accounts
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
  `;
  if (Number(protectedAccounts[0]?.count ?? '0') >= 2) {
    throw new Error(
      'The E2E account-shortage scenario requires fewer than two pre-existing household accounts; refusing to delete unrelated rows.',
    );
  }

  await page.goto(`/transactions/new?month=${month}`);
  await page.getByLabel('金額').fill('100');
  await page.locator('.category-field-expense select').selectOption({ label: '食費' });
  await page.getByLabel('メモ（任意）').fill(`${marker}:shortage-expense`);
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));

  await page.goto(`/transactions/new?type=income&month=${month}`);
  await page.getByLabel('金額').fill('200');
  await page.locator('.category-field-income select').selectOption({ label: '給与' });
  await page.getByLabel('メモ（任意）').fill(`${marker}:shortage-income`);
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));

  await page.goto(`/transactions/new?type=transfer&month=${month}`);
  await expect(page.locator('.insufficient-accounts')).toHaveCount(0);
  await expect(page.getByLabel('振替元')).toBeVisible();
  await expect(page.getByLabel('振替先')).toBeVisible();
  const saveButton = page.getByRole('button', { name: '登録する' });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.locator('.form-error-dialog')).toContainText(
    '振替元の資産を選択してください。',
  );
  await expect(page.locator('.form-error-dialog')).toContainText(
    '振替先の資産を選択してください。',
  );
});
