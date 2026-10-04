import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from './client.js';
import {
  assertSafeTestDatabaseTarget,
  verifySafeTestDatabaseConnection,
} from './database-safety.js';
import { DEFAULT_HOUSEHOLD_ID, initializeDefaultLedger } from './ledger.js';
import { listAccountGroups } from './accounts.js';
import { findMoneyManagerImport } from './imports.js';

const HOUSEHOLD_ID = '11111111-1111-1111-1111-111111111111';
const MIGRATION_FILES = [
  '0000_blue_molecule_man.sql',
  '0001_elite_supernaut.sql',
  '0002_bitter_stryfe.sql',
  '0003_money_manager_import.sql',
  '0004_grey_mysterio.sql',
] as const;

async function executeMigrationFile(sql: Sql, fileName: string): Promise<void> {
  const filePath = fileURLToPath(new URL(`../drizzle/${fileName}`, import.meta.url));
  const source = await readFile(filePath, 'utf8');
  for (const statement of source
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .filter(Boolean)) {
    await sql.unsafe(statement);
  }
}
function summarizeBalances(rows: readonly { balance: string }[]) {
  let assets = 0n;
  let liabilities = 0n;
  let net = 0n;
  for (const row of rows) {
    const balance = BigInt(row.balance);
    net += balance;
    if (balance >= 0n) {
      assets += balance;
    } else {
      liabilities -= balance;
    }
  }
  return {
    assets: assets.toString(),
    liabilities: liabilities.toString(),
    net: net.toString(),
  };
}

describe('legacy account migration', () => {
  let adminSql: Sql | undefined;
  let legacyClient: DatabaseClient | undefined;
  let legacyDatabase: string | undefined;

  beforeAll(async () => {
    const safeTestDatabase = assertSafeTestDatabaseTarget();
    const developmentUrl = process.env.DATABASE_URL;
    const safetyClient = createDatabaseClient(safeTestDatabase.url);
    try {
      await verifySafeTestDatabaseConnection(
        safetyClient.sql,
        safeTestDatabase.target,
        developmentUrl,
      );
    } finally {
      await safetyClient.close();
    }

    const baseUrl = new URL(safeTestDatabase.url);
    legacyDatabase = `kobako_migration_${process.pid}_${Date.now()}`;
    const adminUrl = new URL(baseUrl);
    adminUrl.pathname = '/postgres';
    adminSql = postgres(adminUrl.toString(), { connect_timeout: 3, max: 1 });
    await adminSql.unsafe(`create database "${legacyDatabase}"`);

    const legacyUrl = new URL(baseUrl);
    legacyUrl.pathname = `/${legacyDatabase}`;
    legacyClient = createDatabaseClient(legacyUrl.toString());
    for (const fileName of MIGRATION_FILES.slice(0, 4)) {
      await executeMigrationFile(legacyClient.sql, fileName);
    }
  });

  afterAll(async () => {
    await legacyClient?.close();
    if (adminSql && legacyDatabase) {
      try {
        await adminSql.unsafe(`drop database if exists "${legacyDatabase}"`);
      } finally {
        await adminSql.end({ timeout: 5 });
      }
    }
  });

  it('migrates legacy account data and preserves whitespace-name collisions, balances, transfers, and imports', async () => {
    if (!legacyClient) {
      throw new Error('legacy migration database was not initialized');
    }
    await legacyClient.sql`
      insert into households (id, slug, name)
      values (${HOUSEHOLD_ID}, 'legacy-migration', '移行テスト')
    `;
    const [expenseCategory] = await legacyClient.sql<{ id: number }[]>`
      insert into categories (household_id, type, name, sort_order)
      values (${HOUSEHOLD_ID}, 'expense', '移行支出', 10)
      returning id
    `;
    const [incomeCategory] = await legacyClient.sql<{ id: number }[]>`
      insert into categories (household_id, type, name, sort_order)
      values (${HOUSEHOLD_ID}, 'income', '移行収入', 10)
      returning id
    `;
    const [whitespaceAccount] = await legacyClient.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${HOUSEHOLD_ID}, ' \t ')
      returning id
    `;
    if (!whitespaceAccount) {
      throw new Error('whitespace legacy account was not inserted');
    }
    const [collisionAccount] = await legacyClient.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${HOUSEHOLD_ID}, ${`口座（移行）${whitespaceAccount.id}`})
      returning id
    `;
    const [regularAccount] = await legacyClient.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${HOUSEHOLD_ID}, '移行銀行')
      returning id
    `;
    if (
      !expenseCategory ||
      !incomeCategory ||
      !whitespaceAccount ||
      !collisionAccount ||
      !regularAccount
    ) {
      throw new Error('legacy fixtures were not inserted');
    }
    await legacyClient.sql`
      insert into transactions (household_id, type, amount, occurred_on, category_id, account_id, memo)
      values
        (${HOUSEHOLD_ID}, 'income', 500, '2026-01-01', ${incomeCategory.id}, ${whitespaceAccount.id}, '収入'),
        (${HOUSEHOLD_ID}, 'expense', 120, '2026-01-02', ${expenseCategory.id}, ${whitespaceAccount.id}, '支出'),
        (${HOUSEHOLD_ID}, 'income', 200, '2026-01-03', ${incomeCategory.id}, ${regularAccount.id}, '銀行収入'),
        (${HOUSEHOLD_ID}, 'expense', 50, '2026-01-04', ${expenseCategory.id}, ${regularAccount.id}, '銀行支出'),
        (${HOUSEHOLD_ID}, 'expense', -7, '2099-12-31', ${expenseCategory.id}, null, '未割当・将来・負数')
    `;
    await legacyClient.sql`
      insert into transfers (household_id, from_account_id, to_account_id, amount, occurred_on, memo)
      values
        (${HOUSEHOLD_ID}, ${whitespaceAccount.id}, ${regularAccount.id}, 300, '2026-01-05', '振替1'),
        (${HOUSEHOLD_ID}, ${regularAccount.id}, ${whitespaceAccount.id}, 40, '2026-01-06', '振替2')
    `;
    const importHash = 'c'.repeat(64);
    await legacyClient.sql`
      insert into transaction_imports (
        household_id, source, sha256, original_filename, transaction_count,
        income_count, expense_count, transfer_count
      )
      values (${HOUSEHOLD_ID}, 'realbyte-money-manager', ${importHash}, 'legacy.xlsx', 6, 2, 2, 2)
    `;
    const accountBalanceRows = async () =>
      legacyClient!.sql<{ id: number; balance: string }[]>`
        select
          a.id,
          (
            coalesce((
              select sum(case when type = 'income' then amount else 0 end)
              from transactions
              where household_id = ${HOUSEHOLD_ID} and account_id = a.id
            ), 0)
            - coalesce((
              select sum(case when type = 'expense' then amount else 0 end)
              from transactions
              where household_id = ${HOUSEHOLD_ID} and account_id = a.id
            ), 0)
            - coalesce((
              select sum(amount)
              from transfers
              where household_id = ${HOUSEHOLD_ID} and from_account_id = a.id
            ), 0)
            + coalesce((
              select sum(amount)
              from transfers
              where household_id = ${HOUSEHOLD_ID} and to_account_id = a.id
            ), 0)
          )::text as balance
        from accounts a
        where a.household_id = ${HOUSEHOLD_ID}
        order by a.id
      `;
    const beforeBalances = await accountBalanceRows();
    const beforeTransactionRows = await legacyClient.sql<
      {
        type: string;
        amount: number;
        occurredOn: string;
        accountId: number | null;
        memo: string;
      }[]
    >`
      select
        type,
        amount,
        occurred_on as "occurredOn",
        account_id as "accountId",
        memo
      from transactions
      where household_id = ${HOUSEHOLD_ID}
      order by id
    `;
    const beforeTransferRows = await legacyClient.sql<
      { fromAccountId: number; toAccountId: number; amount: number; memo: string }[]
    >`
      select
        from_account_id as "fromAccountId",
        to_account_id as "toAccountId",
        amount,
        memo
      from transfers
      where household_id = ${HOUSEHOLD_ID}
      order by id
    `;
    const beforeImports = await legacyClient.sql<
      {
        source: string;
        sha256: string;
        originalFilename: string;
        transactionCount: number;
        incomeCount: number;
        expenseCount: number;
        transferCount: number;
      }[]
    >`
      select
        source,
        sha256,
        original_filename as "originalFilename",
        transaction_count as "transactionCount",
        income_count as "incomeCount",
        expense_count as "expenseCount",
        transfer_count as "transferCount"
      from transaction_imports
      where household_id = ${HOUSEHOLD_ID}
    `;

    await executeMigrationFile(legacyClient.sql, MIGRATION_FILES[4]);

    const afterBalances = await accountBalanceRows();
    const afterTransactionRows = await legacyClient.sql<
      {
        type: string;
        amount: number;
        occurredOn: string;
        accountId: number | null;
        memo: string;
      }[]
    >`
      select
        type,
        amount,
        occurred_on as "occurredOn",
        account_id as "accountId",
        memo
      from transactions
      where household_id = ${HOUSEHOLD_ID}
      order by id
    `;
    const migratedAccounts = await legacyClient.sql<
      {
        id: number;
        name: string;
        groupName: string;
        kind: string;
        status: string;
      }[]
    >`
      select
        a.id,
        a.name,
        g.name as "groupName",
        a.kind,
        a.status
      from accounts a
      inner join account_groups g on g.id = a.group_id and g.household_id = a.household_id
      where a.household_id = ${HOUSEHOLD_ID}
      order by a.id
    `;
    const afterTransferRows = await legacyClient.sql<
      { fromAccountId: number; toAccountId: number; amount: number; memo: string }[]
    >`
      select
        from_account_id as "fromAccountId",
        to_account_id as "toAccountId",
        amount,
        memo
      from transfers
      where household_id = ${HOUSEHOLD_ID}
      order by id
    `;
    const afterImports = await legacyClient.sql<
      {
        source: string;
        sha256: string;
        originalFilename: string;
        transactionCount: number;
        incomeCount: number;
        expenseCount: number;
        transferCount: number;
      }[]
    >`
      select
        source,
        sha256,
        original_filename as "originalFilename",
        transaction_count as "transactionCount",
        income_count as "incomeCount",
        expense_count as "expenseCount",
        transfer_count as "transferCount"
      from transaction_imports
      where household_id = ${HOUSEHOLD_ID}
    `;
    const mappings = await legacyClient.sql<{ sourceAccountName: string; accountId: number }[]>`
      select source_account_name as "sourceAccountName", account_id as "accountId"
      from account_import_mappings
      where household_id = ${HOUSEHOLD_ID}
      order by account_id
    `;
    const duplicateLookup = await findMoneyManagerImport(legacyClient.db, HOUSEHOLD_ID, importHash);

    expect(migratedAccounts).toEqual([
      {
        id: whitespaceAccount.id,
        name: `口座（移行）${whitespaceAccount.id}`,
        groupName: 'その他',
        kind: 'other',
        status: 'active',
      },
      {
        id: collisionAccount.id,
        name: `口座（移行）${whitespaceAccount.id}`,
        groupName: 'その他',
        kind: 'other',
        status: 'active',
      },
      {
        id: regularAccount.id,
        name: '移行銀行',
        groupName: 'その他',
        kind: 'other',
        status: 'active',
      },
    ]);
    expect(afterTransactionRows).toEqual(beforeTransactionRows);
    expect(afterBalances).toEqual(beforeBalances);
    expect(summarizeBalances(afterBalances)).toEqual(summarizeBalances(beforeBalances));
    expect(afterTransferRows).toEqual(beforeTransferRows);
    expect(afterImports).toEqual(beforeImports);
    expect(mappings).toEqual([
      {
        sourceAccountName: `口座（移行）${whitespaceAccount.id}`,
        accountId: collisionAccount.id,
      },
      { sourceAccountName: '移行銀行', accountId: regularAccount.id },
    ]);
    expect(new Set(mappings.map((mapping) => mapping.accountId))).toEqual(
      new Set([collisionAccount.id, regularAccount.id]),
    );
    expect(duplicateLookup).toMatchObject({
      source: 'realbyte-money-manager',
      sha256: importHash,
      originalFilename: 'legacy.xlsx',
    });
    await expect(
      legacyClient.sql`
        insert into transaction_imports (
          household_id, source, sha256, original_filename, transaction_count
        )
        values (${HOUSEHOLD_ID}, 'realbyte-money-manager', ${importHash}, 'duplicate.xlsx', 0)
      `,
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('migrates an empty database and initializes default groups afterwards', async () => {
    if (!adminSql) {
      throw new Error('migration admin connection was not initialized');
    }
    const emptyDatabase = `kobako_migration_empty_${process.pid}_${Date.now()}`;
    await adminSql.unsafe(`create database "${emptyDatabase}"`);
    const baseUrl = new URL(assertSafeTestDatabaseTarget().url);
    const emptyUrl = new URL(baseUrl);
    emptyUrl.pathname = `/${emptyDatabase}`;
    const emptyClient = createDatabaseClient(emptyUrl.toString());
    try {
      for (const fileName of MIGRATION_FILES) {
        await executeMigrationFile(emptyClient.sql, fileName);
      }
      expect(await emptyClient.sql`select count(*)::int as count from households`).toEqual([
        { count: 0 },
      ]);
      await initializeDefaultLedger(emptyClient.db);
      expect(
        (await listAccountGroups(emptyClient.db, DEFAULT_HOUSEHOLD_ID)).map((group) => group.name),
      ).toEqual(['現金', '銀行', 'クレジットカード', '電子マネー', 'その他']);
    } finally {
      await emptyClient.close();
      await adminSql.unsafe(`drop database if exists "${emptyDatabase}"`);
    }
  });
});
