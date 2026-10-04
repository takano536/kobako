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
const accountName = `E2E account ${runId}`;
const reviewPrefix = `E2E account review ${runId}:`;

let databaseClient: DatabaseClient | undefined;

function database(): DatabaseClient {
  if (!databaseClient) {
    throw new Error('account-management E2E database is not initialized');
  }
  return databaseClient;
}

async function cleanupReviewFixtures(): Promise<void> {
  if (!databaseClient) {
    return;
  }
  const rows = await databaseClient.sql<{ id: number }[]>`
    select id
    from accounts
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and (name = ${accountName} or name like ${`${reviewPrefix}%`})
  `;
  for (const row of rows) {
    await databaseClient.sql`
      delete from account_card_conditions
      where household_id = ${DEFAULT_HOUSEHOLD_ID}
        and (account_id = ${row.id} or debit_account_id = ${row.id})
    `;
    await databaseClient.sql`
      delete from account_import_mappings
      where household_id = ${DEFAULT_HOUSEHOLD_ID} and account_id = ${row.id}
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
  await databaseClient.sql`
    delete from account_groups
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and name like ${`${reviewPrefix}%`}
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
  } catch (error) {
    await databaseClient.close();
    databaseClient = undefined;
    throw error;
  }
});

test.afterEach(async () => {
  await cleanupReviewFixtures();
});

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

test('creates an account and confirms an interpretation-changing kind update', async ({ page }) => {
  await page.goto('/accounts');
  await page.getByRole('link', { name: '口座を登録' }).first().click();
  await expect(page.getByRole('heading', { name: '口座を登録' })).toBeVisible();
  await page.getByLabel('口座名', { exact: true }).fill(accountName);
  await page.getByLabel('種類').selectOption('bank');
  await expect(page.getByLabel('グループ').locator('option:checked')).toHaveText('銀行');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL('/accounts');

  const accountRow = page.locator('.managed-account-row').filter({ hasText: accountName });
  await expect(accountRow).toHaveCount(1);
  await expect(accountRow).toContainText('銀行');
  await accountRow.getByRole('link', { name: accountName, exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\?account=\d+&month=all$/);
  await expect(page.getByRole('heading', { name: accountName, exact: true })).toBeVisible();
  const accountSettingsLink = page
    .locator('.account-transaction-header')
    .getByRole('link', { name: '口座設定', exact: true });
  await expect(accountSettingsLink).toBeVisible();
  await accountSettingsLink.click();
  await expect(page.getByRole('heading', { name: '口座を編集' })).toBeVisible();

  await page.getByLabel('種類').selectOption('credit_card');
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page.getByText('残高の集計上の意味が変わることを確認しました')).toBeVisible();
  await page.getByLabel('残高の集計上の意味が変わることを確認しました').check();
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page).toHaveURL(/\/transactions\?account=\d+&month=all&saved=1$/);
  await expect(page.getByText('保存しました')).toBeVisible();
  await expect(page.getByRole('heading', { name: accountName, exact: true })).toBeVisible();
  await page.goto('/accounts');
  await expect(page.locator('.managed-account-row').filter({ hasText: accountName })).toContainText(
    'クレジットカード',
  );
  await page.goto('/accounts/new');
  await page.getByLabel('口座名', { exact: true }).fill(accountName);
  await expect(page.getByRole('status')).toContainText('同じ名前の口座があります');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL('/accounts');
  await expect(page.locator('.managed-account-row').filter({ hasText: accountName })).toHaveCount(
    2,
  );
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
});
test('edits an imported account and returns to its filtered transaction list', async ({ page }) => {
  const importedName = `${reviewPrefix}imported`;
  const editedName = `${reviewPrefix}imported-renamed`;
  const [group] = await database().sql<{ id: number }[]>`
    select id
    from account_groups
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and default_kind = 'other'
    limit 1
  `;
  if (!group) {
    throw new Error('imported-account group fixture is missing');
  }
  const [account] = await database().sql<{ id: number }[]>`
    insert into accounts (household_id, name, kind, group_id, status, sort_order)
    values (${DEFAULT_HOUSEHOLD_ID}, ${importedName}, 'other', ${group.id}, 'active', 10)
    returning id
  `;
  if (!account) {
    throw new Error('imported-account fixture was not created');
  }
  await database().sql`
    insert into account_import_mappings (
      household_id, source, source_account_name, account_id
    )
    values (${DEFAULT_HOUSEHOLD_ID}, 'money-manager', ${importedName}, ${account.id})
  `;
  await page.goto('/accounts');
  await page
    .locator('.managed-account-row')
    .filter({ hasText: importedName })
    .getByRole('link', { name: importedName, exact: true })
    .click();
  await expect(page).toHaveURL(`/transactions?account=${account.id}&month=all`);
  await page
    .locator('.account-transaction-header')
    .getByRole('link', { name: '口座設定', exact: true })
    .click();
  await page.getByLabel('口座名', { exact: true }).fill(editedName);
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page).toHaveURL(`/transactions?account=${account.id}&month=all&saved=1`);
  await expect(page.getByRole('heading', { name: editedName, exact: true })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(`/transactions?account=${account.id}&month=all&saved=1`);
  await page.goto(
    `/accounts/${account.id}/edit?return=/transactions%3Faccount%3D${account.id}%26month%3Dall`,
  );
  await expect(page.getByLabel('口座名', { exact: true })).toHaveValue(editedName);
});

test('closes, reopens, and deletes accounts according to reference boundaries', async ({
  page,
}) => {
  const closedName = `${reviewPrefix}closed`;
  const deleteName = `${reviewPrefix}unreferenced`;
  const [group] = await database().sql<{ id: number }[]>`
    select id
    from account_groups
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and default_kind = 'other'
    limit 1
  `;
  const [category] = await database().sql<{ id: number }[]>`
    select id from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and type = 'expense'
    order by id limit 1
  `;
  if (!group || !category) {
    throw new Error('closed-account fixtures are missing');
  }
  const [closedAccount] = await database().sql<{ id: number }[]>`
    insert into accounts (household_id, name, kind, group_id, status, sort_order)
    values (${DEFAULT_HOUSEHOLD_ID}, ${closedName}, 'other', ${group.id}, 'active', 20)
    returning id
  `;
  if (!closedAccount) {
    throw new Error('closed account was not created');
  }
  const [transaction] = await database().sql<{ id: number }[]>`
    insert into transactions (
      household_id, type, amount, occurred_on, category_id, account_id, memo
    )
    values (
      ${DEFAULT_HOUSEHOLD_ID}, 'expense', 321, '9998-12-01', ${category.id},
      ${closedAccount.id}, ${`${reviewPrefix}closed-transaction`}
    )
    returning id
  `;
  if (!transaction) {
    throw new Error('closed account transaction was not created');
  }
  const transferSourceName = `${reviewPrefix}transfer-source`;
  const transferDestinationName = `${reviewPrefix}transfer-destination`;
  const [transferSource] = await database().sql<{ id: number }[]>`
    insert into accounts (household_id, name, kind, group_id, status, sort_order)
    values (${DEFAULT_HOUSEHOLD_ID}, ${transferSourceName}, 'other', ${group.id}, 'active', 40)
    returning id
  `;
  const [transferDestination] = await database().sql<{ id: number }[]>`
    insert into accounts (household_id, name, kind, group_id, status, sort_order)
    values (${DEFAULT_HOUSEHOLD_ID}, ${transferDestinationName}, 'other', ${group.id}, 'active', 50)
    returning id
  `;
  if (!transferSource || !transferDestination) {
    throw new Error('transfer endpoint fixtures were not created');
  }
  const [transfer] = await database().sql<{ id: number }[]>`
    insert into transfers (
      household_id, from_account_id, to_account_id, amount, occurred_on, memo
    )
    values (
      ${DEFAULT_HOUSEHOLD_ID}, ${transferSource.id}, ${transferDestination.id}, 222,
      '9998-12-02', ${`${reviewPrefix}closed-transfer`}
    )
    returning id
  `;
  if (!transfer) {
    throw new Error('closed transfer fixture was not created');
  }
  await page.goto(`/accounts/${closedAccount.id}/edit`);
  await page.getByLabel('状態').selectOption('closed');
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page).toHaveURL(`/transactions?account=${closedAccount.id}&month=all&saved=1`);
  await page.goto('/transactions/new?type=expense&month=9998-12');
  await expect(
    page.locator('#transaction-account option').filter({ hasText: closedName }),
  ).toHaveCount(0);
  await page.goto('/transactions/new?type=transfer&month=9998-12');
  await expect(
    page.locator('#transaction-from-account option').filter({ hasText: closedName }),
  ).toHaveCount(0);
  await page.getByLabel('利用終了の口座も表示').check();
  await expect(
    page.locator('#transaction-from-account option').filter({ hasText: '利用終了' }),
  ).toContainText(closedName);
  await page.goto(`/transactions/${transaction.id}/edit`);
  await expect(page.locator('#transaction-account')).toHaveValue(String(closedAccount.id));
  await expect(page.locator('#transaction-account option:checked')).toContainText('利用終了');
  await page.goto(`/transactions/transfers/${transfer.id}/edit`);
  await expect(page.getByLabel('利用終了の口座も表示')).toBeVisible();
  await expect(
    page.locator('#transaction-from-account option').filter({ hasText: closedName }),
  ).toHaveCount(0);
  await page.getByLabel('利用終了の口座も表示').check();
  await expect(
    page.locator('#transaction-from-account option').filter({ hasText: closedName }),
  ).toHaveCount(1);
  await page.locator('#transaction-from-account').selectOption(String(closedAccount.id));
  await page.locator('#transaction-to-account').selectOption(String(transferDestination.id));
  await page.getByRole('button', { name: '変更を保存', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\?month=9998-12$/);
  await expect(
    database().sql<{ fromAccountId: number; toAccountId: number }[]>`
      select from_account_id as "fromAccountId", to_account_id as "toAccountId"
      from transfers
      where household_id = ${DEFAULT_HOUSEHOLD_ID} and id = ${transfer.id}
    `,
  ).resolves.toEqual([{ fromAccountId: closedAccount.id, toAccountId: transferDestination.id }]);
  await page.goto(`/accounts/${closedAccount.id}/edit`);
  await page.getByLabel('状態').selectOption('active');
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page).toHaveURL(`/transactions?account=${closedAccount.id}&month=all&saved=1`);
  await page.goto('/transactions/new?type=expense&month=9998-12');
  await expect(
    page.locator('#transaction-account option').filter({ hasText: closedName }),
  ).toHaveCount(1);
  await page.goto(`/accounts/${closedAccount.id}/edit`);
  await page.locator('.danger-zone > .delete-details > summary').click();
  await page.getByRole('button', { name: '削除を確定' }).click();
  await expect(page).toHaveURL(/\/accounts\?error=account_referenced/);
  await expect(page.locator('p.form-message[role="alert"]')).toContainText('取引');
  await expect(page.locator('.managed-account-row').filter({ hasText: closedName })).toHaveCount(1);

  const [deleteAccount] = await database().sql<{ id: number }[]>`
    insert into accounts (household_id, name, kind, group_id, status, sort_order)
    values (${DEFAULT_HOUSEHOLD_ID}, ${deleteName}, 'other', ${group.id}, 'active', 30)
    returning id
  `;
  if (!deleteAccount) {
    throw new Error('unreferenced account was not created');
  }
  await page.goto(`/accounts/${deleteAccount.id}/edit`);
  await page.locator('.danger-zone > .delete-details > summary').click();
  await page.getByRole('button', { name: '削除を確定' }).click();
  await expect(page).toHaveURL('/accounts');
  await expect(page.locator('.managed-account-row').filter({ hasText: deleteName })).toHaveCount(0);
});
test('shows transaction and transfer totals for an account filter', async ({ page }) => {
  const accountName = `${reviewPrefix}filtered`;
  const destinationName = `${reviewPrefix}filtered-destination`;
  const [group] = await database().sql<{ id: number }[]>`
    select id from account_groups
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and default_kind = 'other'
    limit 1
  `;
  const [category] = await database().sql<{ id: number }[]>`
    select id from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and type = 'expense'
    order by id limit 1
  `;
  if (!group || !category) throw new Error('filter fixtures are missing');
  const [account] = await database().sql<{ id: number }[]>`
    insert into accounts (household_id, name, kind, group_id, status, sort_order)
    values (${DEFAULT_HOUSEHOLD_ID}, ${accountName}, 'other', ${group.id}, 'active', 40)
    returning id
  `;
  const [destination] = await database().sql<{ id: number }[]>`
    insert into accounts (household_id, name, kind, group_id, status, sort_order)
    values (${DEFAULT_HOUSEHOLD_ID}, ${destinationName}, 'other', ${group.id}, 'active', 50)
    returning id
  `;
  if (!account || !destination) throw new Error('filter accounts were not created');
  const filterMemo = `${reviewPrefix}filter-row`;
  await database().sql`
    insert into transactions (
      household_id, type, amount, occurred_on, category_id, account_id, memo
    )
    values (
      ${DEFAULT_HOUSEHOLD_ID}, 'expense', 123, '2098-01-01', ${category.id},
      ${account.id}, ${filterMemo}
    )
  `;
  await database().sql`
    insert into transfers (
      household_id, from_account_id, to_account_id, amount, occurred_on, memo
    )
    values (
      ${DEFAULT_HOUSEHOLD_ID}, ${account.id}, ${destination.id}, 456,
      '2098-01-02', ${filterMemo}
    )
  `;
  await page.goto(`/transactions?account=${account.id}&month=all`);
  await expect(page.getByText(`口座: ${accountName}`, { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: '口座設定', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '口座の絞り込みを解除', exact: true })).toBeVisible();
  await expect(page.getByLabel('表示期間').getByText('全期間', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '月で絞り込む', exact: true })).toBeVisible();
  await expect(page.locator('.transaction-group-heading').first()).toHaveText(/2098年1月[12]日（/);
  await expect(page.getByRole('heading', { name: '取引' })).toContainText('2件');
  await expect(page.locator('.transaction-link').filter({ hasText: filterMemo })).toHaveCount(2);
  await page.goto(`/transactions?account=${account.id}&month=all&type=transfer`);
  await expect(page.getByRole('heading', { name: '取引' })).toContainText('1件');
  await expect(page.locator('.transaction-link').filter({ hasText: filterMemo })).toHaveCount(1);
});

test('preserves filtered page two through account settings and exposes the empty state', async ({
  page,
}) => {
  const accountName = `${reviewPrefix}settings-account`;
  const renamedAccountName = `${reviewPrefix}settings-account-renamed`;
  const emptyAccountName = `${reviewPrefix}settings-empty`;
  const [group] = await database().sql<{ id: number }[]>`
    select id
    from account_groups
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and default_kind = 'other'
    limit 1
  `;
  const [category] = await database().sql<{ id: number }[]>`
    select id
    from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and type = 'expense'
    order by id
    limit 1
  `;
  if (!group || !category) throw new Error('settings-flow fixtures are missing');
  const [account] = await database().sql<{ id: number }[]>`
    insert into accounts (household_id, name, kind, group_id, status, sort_order)
    values (${DEFAULT_HOUSEHOLD_ID}, ${accountName}, 'bank', ${group.id}, 'active', 80)
    returning id
  `;
  if (!account) throw new Error('settings-flow account was not created');
  await database().sql`
    insert into transactions (
      household_id, type, amount, occurred_on, category_id, account_id, memo
    )
    select
      ${DEFAULT_HOUSEHOLD_ID}, 'expense', 100 + series,
      date '2098-03-01' + series, ${category.id}, ${account.id},
      ${reviewPrefix} || 'settings-page-' || lpad(series::text, 2, '0')
    from generate_series(1, 51) as series
  `;

  const filterPath = `/transactions?account=${account.id}&month=all&type=expense&category=${category.id}&page=2`;
  const expectFilterUrl = async (saved: boolean): Promise<void> => {
    await expect(page).toHaveURL(/\/transactions\?/);
    const url = new URL(page.url());
    expect(url.pathname).toBe('/transactions');
    expect(url.searchParams.get('account')).toBe(String(account.id));
    expect(url.searchParams.get('month')).toBe('all');
    expect(url.searchParams.get('type')).toBe('expense');
    expect(url.searchParams.get('category')).toBe(String(category.id));
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('saved')).toBe(saved ? '1' : null);
  };
  const expectPageTwoRows = async (name: string): Promise<void> => {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(
      page.locator('nav[aria-label="取引のページ移動"] [aria-current="page"]'),
    ).toHaveText('2ページ');
    await expect(
      page.locator('.transaction-link').filter({ hasText: `${reviewPrefix}settings-page-01` }),
    ).toHaveCount(1);
    await expect(page.locator('.transaction-link')).toHaveCount(1);
  };

  await page.goto(filterPath);
  await expectFilterUrl(false);
  await expectPageTwoRows(accountName);
  await page.getByRole('link', { name: '口座設定', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/accounts/${account.id}/edit\\?return=`));
  await expect(page.getByLabel('口座名', { exact: true })).toHaveValue(accountName);

  await page.getByRole('link', { name: '取引一覧へ戻る', exact: true }).click();
  await expectFilterUrl(false);
  await expectPageTwoRows(accountName);

  await page.getByRole('link', { name: '口座設定', exact: true }).click();
  await page.getByLabel('口座名', { exact: true }).fill(renamedAccountName);
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await expectFilterUrl(true);
  await expectPageTwoRows(renamedAccountName);

  const [emptyAccount] = await database().sql<{ id: number }[]>`
    insert into accounts (household_id, name, kind, group_id, status, sort_order)
    values (${DEFAULT_HOUSEHOLD_ID}, ${emptyAccountName}, 'bank', ${group.id}, 'active', 90)
    returning id
  `;
  if (!emptyAccount) throw new Error('settings-flow empty account was not created');
  await page.goto(`/transactions?account=${emptyAccount.id}&month=all`);
  await expect(
    page.getByRole('heading', { name: `${emptyAccountName}の記録がありません`, exact: true }),
  ).toBeVisible();
  await expect(page.locator('.empty-state-description').getByText(emptyAccountName)).toBeVisible();
  await expect(
    page.locator('.empty-state-description').getByRole('link', {
      name: '口座設定',
      exact: true,
    }),
  ).toHaveCount(1);
});

test('shows card uses, refunds, and payment transfers without debit-account leakage', async ({
  page,
}) => {
  const cardName = `${reviewPrefix}filter-card`;
  const debitName = `${reviewPrefix}filter-debit`;
  const [group] = await database().sql<{ id: number }[]>`
    select id
    from account_groups
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and default_kind = 'other'
    limit 1
  `;
  const [expenseCategory] = await database().sql<{ id: number }[]>`
    select id
    from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and type = 'expense'
    order by id
    limit 1
  `;
  const [incomeCategory] = await database().sql<{ id: number }[]>`
    select id
    from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and type = 'income'
    order by id
    limit 1
  `;
  if (!group || !expenseCategory || !incomeCategory) {
    throw new Error('card-filter fixtures are missing');
  }
  const [card] = await database().sql<{ id: number }[]>`
    insert into accounts (household_id, name, kind, group_id, status, sort_order)
    values (${DEFAULT_HOUSEHOLD_ID}, ${cardName}, 'credit_card', ${group.id}, 'active', 100)
    returning id
  `;
  const [debit] = await database().sql<{ id: number }[]>`
    insert into accounts (household_id, name, kind, group_id, status, sort_order)
    values (${DEFAULT_HOUSEHOLD_ID}, ${debitName}, 'bank', ${group.id}, 'active', 110)
    returning id
  `;
  if (!card || !debit) throw new Error('card-filter accounts were not created');
  const cardUseMemo = `${reviewPrefix}card-use`;
  const cardRefundMemo = `${reviewPrefix}card-refund`;
  const debitMemo = `${reviewPrefix}debit-leak`;
  const paymentMemo = `${reviewPrefix}card-payment`;
  await database().sql`
    insert into transactions (
      household_id, type, amount, occurred_on, category_id, account_id, memo
    )
    values
      (${DEFAULT_HOUSEHOLD_ID}, 'expense', 120, '2098-04-01', ${expenseCategory.id}, ${card.id}, ${cardUseMemo}),
      (${DEFAULT_HOUSEHOLD_ID}, 'income', 40, '2098-04-02', ${incomeCategory.id}, ${card.id}, ${cardRefundMemo}),
      (${DEFAULT_HOUSEHOLD_ID}, 'expense', 120, '2098-04-03', ${expenseCategory.id}, ${debit.id}, ${debitMemo})
  `;
  await database().sql`
    insert into transfers (
      household_id, from_account_id, to_account_id, amount, occurred_on, memo
    )
    values (
      ${DEFAULT_HOUSEHOLD_ID}, ${debit.id}, ${card.id}, 120, '2098-04-04', ${paymentMemo}
    )
  `;

  await page.goto(`/transactions?account=${card.id}&month=all`);
  await expect(page.getByRole('heading', { name: cardName, exact: true })).toBeVisible();
  await expect(page.locator('.transaction-link')).toHaveCount(3);
  await expect(page.locator('.transaction-link').filter({ hasText: cardUseMemo })).toHaveCount(1);
  await expect(page.locator('.transaction-link').filter({ hasText: cardRefundMemo })).toHaveCount(
    1,
  );
  await expect(page.locator('.transaction-link').filter({ hasText: paymentMemo })).toHaveCount(1);
  await expect(page.locator('.transaction-link').filter({ hasText: debitMemo })).toHaveCount(0);
});
test('renames custom groups, moves and reorders accounts, and preserves balances', async ({
  page,
}) => {
  const groupA = `${reviewPrefix}グループA`;
  const groupB = `${reviewPrefix}グループB`;
  const renamedGroupA = `${reviewPrefix}グループA改名`;
  const temporaryGroup = `${reviewPrefix}削除グループ`;
  const firstName = `${reviewPrefix}移動口座`;
  const secondName = `${reviewPrefix}並び替え口座`;
  const [otherGroup] = await database().sql<{ id: number }[]>`
    select id from account_groups
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and default_kind = 'other'
    limit 1
  `;
  const [category] = await database().sql<{ id: number }[]>`
    select id from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and type = 'income'
    order by id limit 1
  `;
  if (!otherGroup || !category) throw new Error('group invariants fixtures are missing');

  await page.goto('/accounts');
  await page.getByLabel('新しいグループ').fill(groupA);
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.locator('.account-group-card h3', { hasText: groupA })).toBeVisible();
  await page.getByLabel('新しいグループ').fill(groupB);
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.locator('.account-group-card h3', { hasText: groupB })).toBeVisible();
  await page.getByLabel('新しいグループ').fill(temporaryGroup);
  await page.getByRole('button', { name: '追加', exact: true }).click();
  const temporaryCard = page
    .locator('.account-group-card')
    .filter({ has: page.getByRole('heading', { name: temporaryGroup, exact: true }) });
  await temporaryCard.getByText('削除', { exact: true }).click();
  await temporaryCard.getByRole('button', { name: '削除を確定', exact: true }).click();
  await expect(page.getByRole('heading', { name: temporaryGroup, exact: true })).toHaveCount(0);

  const groupACard = page
    .locator('.account-group-card')
    .filter({ has: page.getByRole('heading', { name: groupA, exact: true }) });
  await groupACard.getByText('名前を変更', { exact: true }).click();
  await groupACard.locator('input[name="name"]').fill(renamedGroupA);
  await groupACard.getByRole('button', { name: '名前を保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: renamedGroupA, exact: true })).toBeVisible();
  const renamedGroupACard = page
    .locator('.account-group-card')
    .filter({ has: page.getByRole('heading', { name: renamedGroupA, exact: true }) });
  await expect(renamedGroupACard.getByText('削除', { exact: true })).toBeVisible();

  await page.goto('/accounts/new');
  await page.getByLabel('口座名', { exact: true }).fill(firstName);
  await page.getByLabel('種類').selectOption('other');
  await page.getByLabel('グループ').selectOption({ label: renamedGroupA });
  await page.getByRole('button', { name: '登録する', exact: true }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  const firstAccount = await database().sql<{ id: number }[]>`
    select id from accounts
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and name = ${firstName}
  `;
  const firstId = firstAccount[0]?.id;
  if (!firstId) throw new Error('first group account was not created');
  await database().sql`
    insert into transactions (
      household_id, type, amount, occurred_on, category_id, account_id, memo
    )
    values (
      ${DEFAULT_HOUSEHOLD_ID}, 'income', 789, '2098-02-01', ${category.id},
      ${firstId}, ${`${reviewPrefix}group-total`}
    )
  `;
  await page.goto('/balances');
  const firstBalanceRow = page
    .getByRole('list', { name: '口座別残高' })
    .getByRole('listitem')
    .filter({ hasText: firstName });
  await expect(firstBalanceRow.locator('.balance-amount')).toContainText('789円');

  await page.goto(`/accounts/${firstId}/edit`);
  await page.getByLabel('グループ').selectOption({ label: groupB });
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await expect(page).toHaveURL(`/transactions?account=${firstId}&month=all&saved=1`);

  await page.goto('/accounts/new');
  await page.getByLabel('口座名', { exact: true }).fill(secondName);
  await page.getByLabel('種類').selectOption('other');
  await page.getByLabel('グループ').selectOption({ label: groupB });
  await page.getByRole('button', { name: '登録する', exact: true }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  const secondAccount = await database().sql<{ id: number }[]>`
    select id from accounts
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and name = ${secondName}
  `;
  const secondId = secondAccount[0]?.id;
  const [groupBRow] = await database().sql<{ id: number }[]>`
    select id from account_groups
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and name = ${groupB}
  `;
  if (!secondId || !groupBRow) throw new Error('second group account was not created');
  await page.getByRole('button', { name: `${secondName}を上へ`, exact: true }).click();
  await expect
    .poll(async () => {
      const rows = await database().sql<{ name: string }[]>`
        select name from accounts
        where household_id = ${DEFAULT_HOUSEHOLD_ID} and group_id = ${groupBRow.id}
        order by sort_order, id
      `;
      return rows.map((row) => row.name);
    })
    .toEqual([secondName, firstName]);
  await page.reload();
  const accountNames = await page
    .locator('.managed-account-row .managed-account-name')
    .allTextContents();
  expect(accountNames.indexOf(secondName)).toBeLessThan(accountNames.indexOf(firstName));

  await page
    .locator('.account-group-card')
    .filter({ hasText: groupB })
    .getByRole('button', {
      name: `${groupB}を上へ`,
      exact: true,
    })
    .click();
  await expect
    .poll(async () => {
      const rows = await database().sql<{ name: string }[]>`
        select name from account_groups
        where household_id = ${DEFAULT_HOUSEHOLD_ID}
        order by sort_order, id
      `;
      const names = rows.map((row) => row.name);
      return names.indexOf(groupB) < names.indexOf(renamedGroupA);
    })
    .toBe(true);
  await page.reload();
  const groupNames = await page.locator('.account-group-card h3').allTextContents();
  expect(groupNames.indexOf(groupB)).toBeLessThan(groupNames.indexOf(renamedGroupA));
  await page.goto('/balances');
  await expect(
    page
      .getByRole('list', { name: '口座別残高' })
      .getByRole('listitem')
      .filter({ hasText: firstName })
      .locator('.balance-amount'),
  ).toContainText('789円');
});
test('records unset and partial card conditions and confirms past corrections', async ({
  page,
}) => {
  const cardName = `${reviewPrefix}card`;
  const debitName = `${reviewPrefix}closed-debit`;
  const [group] = await database().sql<{ id: number }[]>`
    select id from account_groups
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and default_kind = 'other'
    limit 1
  `;
  if (!group) throw new Error('card group fixture is missing');
  const [card] = await database().sql<{ id: number }[]>`
    insert into accounts (household_id, name, kind, group_id, status, sort_order)
    values (${DEFAULT_HOUSEHOLD_ID}, ${cardName}, 'credit_card', ${group.id}, 'active', 60)
    returning id
  `;
  const [debit] = await database().sql<{ id: number }[]>`
    insert into accounts (household_id, name, kind, group_id, status, sort_order)
    values (${DEFAULT_HOUSEHOLD_ID}, ${debitName}, 'bank', ${group.id}, 'closed', 70)
    returning id
  `;
  if (!card || !debit) throw new Error('card condition fixtures were not created');
  await page.goto(`/accounts/${card.id}/card`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const requiredCardNote = 'kobako は請求額・支払予定日を計算しません。';
  await expect(page.getByText(requiredCardNote, { exact: true })).toBeVisible();
  const cardConditionsText = await page.locator('main').innerText();
  expect(cardConditionsText.replaceAll(requiredCardNote, '')).not.toMatch(
    /請求額[:：]|支払予定日[:：]|支払予定額|次回支払|\d[\d,]*円/,
  );
  await page.getByRole('button', { name: '条件を追加する', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/accounts/${card.id}/card\\?.*saved=1`));
  await expect(page.getByText('適用開始 未設定', { exact: false })).toBeVisible();

  await page.getByRole('textbox', { name: '適用開始日（未入力は初期条件）' }).fill('2025-01-01');
  await page.getByLabel('締め日').selectOption('last');
  await page.getByLabel('支払日').selectOption('10');
  await page.getByLabel('支払月').selectOption('next_month');
  await page.getByLabel('引き落とし口座').selectOption(String(debit.id));
  await expect(page.getByLabel('引き落とし口座').locator('option:checked')).toContainText(
    '利用終了',
  );
  await page.getByRole('button', { name: '条件を追加する', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/accounts/${card.id}/card\\?.*saved=1`));
  await expect(page.getByText('2025年1月1日の締め期間から', { exact: false })).toBeVisible();

  await page.getByRole('textbox', { name: '適用開始日（未入力は初期条件）' }).fill('2025-02-01');
  await page.getByRole('button', { name: '条件を追加する', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/accounts/${card.id}/card\\?.*saved=1`));
  const latestCondition = page
    .locator('.card-condition-history li')
    .filter({ hasText: '2025年2月1日の締め期間から' });
  await latestCondition.getByRole('link', { name: 'この条件を修正' }).click();
  await page.getByRole('textbox', { name: '適用開始日（未入力は初期条件）' }).fill('2025-03-01');
  await page.getByRole('button', { name: '変更内容を確認', exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/accounts/${card.id}/card\\?.*error=confirm_correction`),
  );
  await expect(page.getByText('変更前:', { exact: false })).toBeVisible();
  await expect(page.getByText('変更後:', { exact: false })).toBeVisible();
  await expect(page.getByText('影響期間:', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'この変更を確定する', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/accounts/${card.id}/card\\?.*saved=1`));
  await expect(page.getByText('2025年3月1日の締め期間から', { exact: false })).toBeVisible();
  const stored = await database().sql<{ effectiveFrom: string; debitAccountId: number | null }[]>`
    select effective_from as "effectiveFrom", debit_account_id as "debitAccountId"
    from account_card_conditions
    where household_id = ${DEFAULT_HOUSEHOLD_ID} and account_id = ${card.id}
    order by effective_from nulls first
  `;
  expect(stored).toEqual([
    { effectiveFrom: null, debitAccountId: null },
    { effectiveFrom: '2025-01-01', debitAccountId: debit.id },
    { effectiveFrom: '2025-03-01', debitAccountId: null },
  ]);
});
