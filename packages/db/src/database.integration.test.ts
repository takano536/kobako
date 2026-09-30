import { asc } from 'drizzle-orm';
import type { MoneyManagerLedgerRow, MoneyManagerNormalizedRow } from './money-manager-format.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from './client.js';
import {
  DEFAULT_HOUSEHOLD_ID,
  createTransaction,
  deleteTransaction,
  getMonthlyTotals,
  getExpenseCategoryTotals,
  getAccountBalances,
  getTransaction,
  initializeDefaultLedger,
  listCategories,
  listLedgerEntries,
  listTransactions,
  updateTransaction,
} from './ledger.js';
import { commitMoneyManagerImport } from './imports.js';
import { runMigrations } from './migrate.js';
import {
  assertSafeTestDatabaseTarget,
  verifySafeTestDatabaseConnection,
  type DatabaseTarget,
} from './database-safety.js';
import {
  accounts,
  categories,
  transactionImports,
  systemHealthchecks,
  transactions,
  transfers,
} from './schema.js';
import { transactionInputSchema } from './validation.js';

interface PostgresErrorLike {
  code?: string;
  constraint_name?: string;
}

function pgError(error: unknown): PostgresErrorLike {
  return error as PostgresErrorLike;
}

function importedRow(
  overrides: Partial<MoneyManagerLedgerRow> = {},
  sourceRow = 2,
): MoneyManagerLedgerRow {
  return {
    sourceRow,
    type: 'expense',
    amount: 720,
    occurredOn: '2026-09-29',
    accountName: '現金',
    categoryName: '取込テスト',
    memo: 'テスト',
    ...overrides,
  };
}

describe('PostgreSQL migrations and ledger', () => {
  let client: DatabaseClient;
  let developmentUrl: string | undefined;
  let testDatabaseTarget: DatabaseTarget;
  let testDatabaseUrl: string;

  beforeAll(async () => {
    const safeTestDatabase = assertSafeTestDatabaseTarget();
    testDatabaseTarget = safeTestDatabase.target;
    const testUrl = safeTestDatabase.url;
    testDatabaseUrl = testUrl;
    developmentUrl = process.env.DATABASE_URL;

    // Prove migrations apply to a genuinely empty database, not just a truncated one.
    // This block only ever runs against TEST_DATABASE_URL (guarded above).
    const resetClient = createDatabaseClient(testUrl);
    try {
      await verifySafeTestDatabaseConnection(resetClient.sql, testDatabaseTarget, developmentUrl);
      await resetClient.sql`drop schema if exists drizzle cascade`;
      await resetClient.sql`drop schema public cascade`;
      await resetClient.sql`create schema public`;
    } finally {
      await resetClient.close();
    }

    await runMigrations(testUrl);
    client = createDatabaseClient(testUrl);
  });

  beforeEach(async () => {
    try {
      await verifySafeTestDatabaseConnection(client.sql, testDatabaseTarget, developmentUrl);
    } catch (error) {
      await client.close();
      throw error;
    }
    await client.sql`
      truncate table "transaction_imports", "transactions", "categories", "households", "system_healthchecks"
      restart identity cascade
    `;
    await initializeDefaultLedger(client.db);
  });

  afterAll(async () => {
    await client?.close();
  });

  it('keeps the system healthcheck table available', async () => {
    const key = `integration-${Date.now()}`;
    await client.db.insert(systemHealthchecks).values({ key });

    const rows = await client.db
      .select()
      .from(systemHealthchecks)
      .orderBy(asc(systemHealthchecks.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe(key);
    expect(rows[0]?.id).toBe(1);
  });

  it('seeds one default household and categories idempotently', async () => {
    await initializeDefaultLedger(client.db);
    await initializeDefaultLedger(client.db);

    const households = await client.sql`select id, slug from households`;
    const seededCategories = await listCategories(client.db, DEFAULT_HOUSEHOLD_ID);
    expect(households).toHaveLength(1);
    expect(households[0]?.id).toBe(DEFAULT_HOUSEHOLD_ID);
    expect(households[0]?.slug).toBe('local');
    expect(seededCategories).toHaveLength(12);
    expect(seededCategories.filter((category) => category.type === 'expense')).toHaveLength(9);
    expect(seededCategories.filter((category) => category.type === 'income')).toHaveLength(3);
  });

  it('starts each test with isolated ledger and healthcheck data', async () => {
    const rows = await client.db.select().from(systemHealthchecks);
    const ledgerRows = await client.db.select().from(transactions);
    expect(rows).toEqual([]);
    expect(ledgerRows).toEqual([]);
  });

  it('creates, reads, updates, and deletes a transaction', async () => {
    const expenseCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'expense'))[0];
    if (!expenseCategory) {
      throw new Error('expense category seed missing');
    }
    const input = transactionInputSchema.parse({
      type: 'expense',
      amount: '12,345',
      occurredOn: '2026-09-12',
      categoryId: String(expenseCategory.id),
      memo: '  買い物  ',
    });

    const created = await createTransaction(client.db, DEFAULT_HOUSEHOLD_ID, input);
    expect(created.amount).toBe(12_345);
    expect(created.occurredOn).toBe('2026-09-12');
    expect(created.memo).toBe('買い物');

    const fetched = await getTransaction(client.db, DEFAULT_HOUSEHOLD_ID, created.id);
    expect(fetched).toMatchObject({
      id: created.id,
      type: 'expense',
      amount: 12_345,
      occurredOn: '2026-09-12',
      categoryName: expenseCategory.name,
      memo: '買い物',
    });

    const updated = await updateTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      created.id,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '20000',
        occurredOn: '2026-09-13',
        categoryId: String(expenseCategory.id),
        memo: '',
      }),
    );
    expect(updated).toMatchObject({ amount: 20_000, occurredOn: '2026-09-13', memo: '' });
    await verifySafeTestDatabaseConnection(client.sql, testDatabaseTarget, developmentUrl);
    const deleted = await deleteTransaction(client.db, DEFAULT_HOUSEHOLD_ID, created.id);
    expect(deleted).toMatchObject({ occurredOn: '2026-09-13' });
    expect(await getTransaction(client.db, DEFAULT_HOUSEHOLD_ID, created.id)).toBeNull();
    await verifySafeTestDatabaseConnection(client.sql, testDatabaseTarget, developmentUrl);
    expect(await deleteTransaction(client.db, DEFAULT_HOUSEHOLD_ID, created.id)).toBeNull();
  });

  it('separates monthly income and expense totals and category breakdowns', async () => {
    const expenseCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'expense'))[0];
    const incomeCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'income'))[0];
    if (!expenseCategory || !incomeCategory) {
      throw new Error('category seeds missing');
    }
    await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '1200',
        occurredOn: '2026-09-01',
        categoryId: String(expenseCategory.id),
        memo: '',
      }),
    );
    await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '800',
        occurredOn: '2026-09-20',
        categoryId: String(expenseCategory.id),
        memo: '',
      }),
    );
    await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'income',
        amount: '5000',
        occurredOn: '2026-09-15',
        categoryId: String(incomeCategory.id),
        memo: '',
      }),
    );
    await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '9999',
        occurredOn: '2026-08-31',
        categoryId: String(expenseCategory.id),
        memo: '',
      }),
    );
    const [fromAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, 'Monthly source')
      returning id
    `;
    const [toAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, 'Monthly destination')
      returning id
    `;
    if (!fromAccount || !toAccount) {
      throw new Error('monthly transfer accounts were not created');
    }
    await client.sql`
      insert into transfers
        (household_id, from_account_id, to_account_id, amount, occurred_on, memo)
      values
        (${DEFAULT_HOUSEHOLD_ID}, ${fromAccount.id}, ${toAccount.id}, 9000, '2026-09-10', '移動')
    `;
    const ledgerEntries = await listLedgerEntries(client.db, DEFAULT_HOUSEHOLD_ID, {
      month: '2026-09',
    });
    expect(ledgerEntries).toHaveLength(4);
    expect(ledgerEntries.filter((entry) => entry.type === 'transfer')).toMatchObject([
      {
        amount: 9000,
        fromAccountName: 'Monthly source',
        toAccountName: 'Monthly destination',
      },
    ]);
    expect(
      await listLedgerEntries(client.db, DEFAULT_HOUSEHOLD_ID, {
        month: '2026-09',
        type: 'expense',
      }),
    ).toHaveLength(2);
    expect(
      await listLedgerEntries(client.db, DEFAULT_HOUSEHOLD_ID, {
        month: '2026-09',
        categoryId: expenseCategory.id,
      }),
    ).toHaveLength(2);

    expect(await getMonthlyTotals(client.db, DEFAULT_HOUSEHOLD_ID, '2026-09')).toEqual({
      income: '5000',
      expense: '2000',
      difference: '3000',
    });
    expect(
      await listTransactions(client.db, DEFAULT_HOUSEHOLD_ID, { month: '2026-09' }),
    ).toHaveLength(3);
    expect(
      await listTransactions(client.db, DEFAULT_HOUSEHOLD_ID, { month: '2026-09', type: 'income' }),
    ).toHaveLength(1);
    expect(
      await listTransactions(client.db, DEFAULT_HOUSEHOLD_ID, {
        month: '2026-09',
        categoryId: expenseCategory.id,
      }),
    ).toHaveLength(2);
    expect(await getExpenseCategoryTotals(client.db, DEFAULT_HOUSEHOLD_ID, '2026-09')).toEqual([
      { categoryId: expenseCategory.id, categoryName: expenseCategory.name, total: '2000' },
    ]);
  });
  it('keeps large sums exact and orders category totals numerically', async () => {
    const expenseCategories = await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'expense');
    const [largestCategory, lowerCategory, middleCategory] = expenseCategories;
    if (!largestCategory || !lowerCategory || !middleCategory) {
      throw new Error('expense category seeds missing');
    }

    for (const amount of ['999999999', '999999999', '999999999']) {
      await createTransaction(
        client.db,
        DEFAULT_HOUSEHOLD_ID,
        transactionInputSchema.parse({
          type: 'expense',
          amount,
          occurredOn: '2026-09-01',
          categoryId: String(largestCategory.id),
          memo: '',
        }),
      );
    }
    for (const [category, amount] of [
      [lowerCategory, '900'],
      [middleCategory, '1000'],
    ] as const) {
      await createTransaction(
        client.db,
        DEFAULT_HOUSEHOLD_ID,
        transactionInputSchema.parse({
          type: 'expense',
          amount,
          occurredOn: '2026-09-02',
          categoryId: String(category.id),
          memo: '',
        }),
      );
    }

    await expect(getMonthlyTotals(client.db, DEFAULT_HOUSEHOLD_ID, '2026-09')).resolves.toEqual({
      income: '0',
      expense: '3000001897',
      difference: '-3000001897',
    });
    await expect(
      getExpenseCategoryTotals(client.db, DEFAULT_HOUSEHOLD_ID, '2026-09'),
    ).resolves.toEqual([
      { categoryId: largestCategory.id, categoryName: largestCategory.name, total: '2999999997' },
      { categoryId: middleCategory.id, categoryName: middleCategory.name, total: '1000' },
      { categoryId: lowerCategory.id, categoryName: lowerCategory.name, total: '900' },
    ]);
  });

  it('stores zero and negative amounts in PostgreSQL', async () => {
    const expenseCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'expense'))[0];
    if (!expenseCategory) {
      throw new Error('expense category seed missing');
    }

    const rows = await client.sql`
      insert into transactions
        (household_id, type, amount, occurred_on, category_id, memo)
      values
        (${DEFAULT_HOUSEHOLD_ID}, 'expense', 0, '2026-09-01', ${expenseCategory.id}, ''),
        (${DEFAULT_HOUSEHOLD_ID}, 'expense', -500, '2026-09-02', ${expenseCategory.id}, '')
      returning amount
    `;
    expect(rows.map((row) => Number(row.amount)).sort((left, right) => left - right)).toEqual([
      -500, 0,
    ]);
  });

  it('lets PostgreSQL reject amounts outside the symmetric limit', async () => {
    const expenseCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'expense'))[0];
    if (!expenseCategory) {
      throw new Error('expense category seed missing');
    }

    for (const amount of [1_000_000_000, -1_000_000_000]) {
      await expect(async () => {
        try {
          await client.sql`
            insert into transactions
              (household_id, type, amount, occurred_on, category_id, memo)
            values
              (${DEFAULT_HOUSEHOLD_ID}, 'expense', ${amount}, '2026-09-01', ${expenseCategory.id}, '')
          `;
        } catch (error) {
          expect(pgError(error).code).toBe('23514');
          expect(pgError(error).constraint_name).toBe('transactions_amount_limit_check');
          throw error;
        }
      }).rejects.toThrow();
    }
  });

  it('lets PostgreSQL reject an unknown category with a foreign key violation', async () => {
    await expect(async () => {
      try {
        await client.sql`
          insert into transactions
            (household_id, type, amount, occurred_on, category_id, memo)
          values
            (${DEFAULT_HOUSEHOLD_ID}, 'expense', 100, '2026-09-01', 99999999, '')
        `;
      } catch (error) {
        expect(pgError(error).code).toBe('23503');
        expect(pgError(error).constraint_name).toBe('transactions_category_household_type_fk');
        throw error;
      }
    }).rejects.toThrow();
  });

  it('lets PostgreSQL reject an income category on an expense transaction with a foreign key violation', async () => {
    const incomeCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'income'))[0];
    if (!incomeCategory) {
      throw new Error('income category seed missing');
    }

    await expect(async () => {
      try {
        await client.sql`
          insert into transactions
            (household_id, type, amount, occurred_on, category_id, memo)
          values
            (${DEFAULT_HOUSEHOLD_ID}, 'expense', 100, '2026-09-01', ${incomeCategory.id}, '')
        `;
      } catch (error) {
        expect(pgError(error).code).toBe('23503');
        expect(pgError(error).constraint_name).toBe('transactions_category_household_type_fk');
        throw error;
      }
    }).rejects.toThrow();
  });
  it('lets PostgreSQL reject a category from another household', async () => {
    const otherHouseholdId = '00000000-0000-0000-0000-000000000002';
    await client.sql`
      insert into households (id, slug, name)
      values (${otherHouseholdId}, 'other', 'Other household')
    `;
    const [category] = await client.sql<{ id: number }[]>`
      insert into categories (household_id, type, name, sort_order)
      values (${otherHouseholdId}, 'expense', 'Other expense', 1)
      returning id
    `;
    if (!category) {
      throw new Error('other household category was not created');
    }

    await expect(async () => {
      try {
        await client.sql`
          insert into transactions
            (household_id, type, amount, occurred_on, category_id, memo)
          values
            (${DEFAULT_HOUSEHOLD_ID}, 'expense', 100, '2026-09-01', ${category.id}, '')
        `;
      } catch (error) {
        expect(pgError(error).code).toBe('23503');
        expect(pgError(error).constraint_name).toBe('transactions_category_household_type_fk');
        throw error;
      }
    }).rejects.toThrow();
  });
  it('rejects transfer endpoints from another household', async () => {
    const otherHouseholdId = '00000000-0000-0000-0000-000000000002';
    await client.sql`
      insert into households (id, slug, name)
      values (${otherHouseholdId}, 'other-transfer', 'Other transfer household')
    `;
    const [defaultAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, 'Default account')
      returning id
    `;
    const [otherAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${otherHouseholdId}, 'Other account')
      returning id
    `;
    if (!defaultAccount || !otherAccount) {
      throw new Error('accounts were not created');
    }
    await expect(async () => {
      try {
        await client.sql`
          insert into transfers
            (household_id, from_account_id, to_account_id, amount, occurred_on, memo)
          values
            (${DEFAULT_HOUSEHOLD_ID}, ${defaultAccount.id}, ${otherAccount.id}, 100, '2026-09-01', '')
        `;
      } catch (error) {
        expect(pgError(error).code).toBe('23503');
        expect(pgError(error).constraint_name).toBe('transfers_to_account_household_fk');
        throw error;
      }
    }).rejects.toThrow();
  });

  it('rejects a transaction account from another household', async () => {
    const otherHouseholdId = '00000000-0000-0000-0000-000000000002';
    await client.sql`
      insert into households (id, slug, name)
      values (${otherHouseholdId}, 'other-account', 'Other account household')
    `;
    const [otherAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${otherHouseholdId}, 'Other account')
      returning id
    `;
    const expenseCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'expense'))[0];
    if (!otherAccount || !expenseCategory) {
      throw new Error('cross-household account fixtures were not created');
    }

    await expect(async () => {
      try {
        await client.sql`
          insert into transactions
            (household_id, type, amount, occurred_on, category_id, account_id, memo)
          values
            (
              ${DEFAULT_HOUSEHOLD_ID},
              'expense',
              100,
              '2026-09-01',
              ${expenseCategory.id},
              ${otherAccount.id},
              ''
            )
        `;
      } catch (error) {
        expect(pgError(error).code).toBe('23503');
        expect(pgError(error).constraint_name).toBe('transactions_account_household_fk');
        throw error;
      }
    }).rejects.toThrow();
  });

  it('rejects a transfer whose source and destination are the same account', async () => {
    const [account] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, 'Same account')
      returning id
    `;
    if (!account) {
      throw new Error('same account was not created');
    }
    await expect(async () => {
      try {
        await client.sql`
          insert into transfers
            (household_id, from_account_id, to_account_id, amount, occurred_on, memo)
          values
            (${DEFAULT_HOUSEHOLD_ID}, ${account.id}, ${account.id}, 100, '2026-09-01', '')
        `;
      } catch (error) {
        expect(pgError(error).code).toBe('23514');
        expect(pgError(error).constraint_name).toBe('transfers_distinct_accounts_check');
        throw error;
      }
    }).rejects.toThrow();
  });

  it('restricts referenced accounts and cascades accounts and transfers with a household', async () => {
    const [fromAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, 'Referenced source')
      returning id
    `;
    const [toAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, 'Referenced destination')
      returning id
    `;
    if (!fromAccount || !toAccount) {
      throw new Error('referenced accounts were not created');
    }
    await client.sql`
      insert into transfers
        (household_id, from_account_id, to_account_id, amount, occurred_on, memo)
      values
        (${DEFAULT_HOUSEHOLD_ID}, ${fromAccount.id}, ${toAccount.id}, 100, '2026-09-01', '')
    `;
    await expect(async () => {
      try {
        await client.sql`delete from accounts where id = ${fromAccount.id}`;
      } catch (error) {
        expect(pgError(error).code).toBe('23503');
        expect(pgError(error).constraint_name).toBe('transfers_from_account_household_fk');
        throw error;
      }
    }).rejects.toThrow();

    const cascadeHouseholdId = '00000000-0000-0000-0000-000000000002';
    await client.sql`
      insert into households (id, slug, name)
      values (${cascadeHouseholdId}, 'cascade', 'Cascade household')
    `;
    const [cascadeFrom] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${cascadeHouseholdId}, 'Cascade source')
      returning id
    `;
    const [cascadeTo] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${cascadeHouseholdId}, 'Cascade destination')
      returning id
    `;
    if (!cascadeFrom || !cascadeTo) {
      throw new Error('cascade accounts were not created');
    }
    await client.sql`
      insert into transfers
        (household_id, from_account_id, to_account_id, amount, occurred_on, memo)
      values
        (${cascadeHouseholdId}, ${cascadeFrom.id}, ${cascadeTo.id}, 200, '2026-09-01', '')
    `;
    await client.sql`delete from households where id = ${cascadeHouseholdId}`;
    expect(
      await client.sql`select id from accounts where household_id = ${cascadeHouseholdId}`,
    ).toEqual([]);
    expect(
      await client.sql`select id from transfers where household_id = ${cascadeHouseholdId}`,
    ).toEqual([]);
  });

  it('imports new categories and transactions atomically', async () => {
    const result = await commitMoneyManagerImport(client.db, {
      householdId: DEFAULT_HOUSEHOLD_ID,
      sha256: 'a'.repeat(64),
      originalFilename: 'import.xlsx',
      rows: [
        importedRow({ categoryName: '食費', amount: 120 }),
        importedRow({
          sourceRow: 3,
          type: 'income',
          categoryName: 'Imported Salary',
          amount: 5000,
          occurredOn: '2026-09-30',
        }),
        {
          sourceRow: 4,
          type: 'transfer',
          amount: 300,
          occurredOn: '2026-09-29',
          fromAccountName: '現金',
          toAccountName: '銀行',
          memo: '入金',
        },
      ],
    });
    if (result.status !== 'imported') {
      throw new Error('expected the import to commit');
    }
    expect(result.transactionCount).toBe(3);
    expect(result.counts).toEqual({
      income: { count: 1, total: '5000' },
      expense: { count: 1, total: '120' },
      transfer: { count: 1, total: '300' },
    });
    expect(result.accounts.map((account) => account.name)).toEqual(['現金', '銀行']);
    expect(result.createdAccounts).toBe(2);
    expect(result.categories).toHaveLength(2);
    expect(result.categories.map((category) => category.action)).toEqual(['reused', 'created']);
    expect(
      await listTransactions(client.db, DEFAULT_HOUSEHOLD_ID, { month: '2026-09' }),
    ).toHaveLength(2);
    expect(await client.db.select().from(transfers)).toHaveLength(1);
    const importedEntries = await listLedgerEntries(client.db, DEFAULT_HOUSEHOLD_ID, {
      month: '2026-09',
    });
    expect(importedEntries.filter((entry) => entry.type === 'transfer')).toMatchObject([
      {
        amount: 300,
        fromAccountName: '現金',
        toAccountName: '銀行',
        memo: '入金',
      },
    ]);
    expect(importedEntries.filter((entry) => entry.type !== 'transfer')).toHaveLength(2);
    expect(await getMonthlyTotals(client.db, DEFAULT_HOUSEHOLD_ID, '2026-09')).toEqual({
      income: '5000',
      expense: '120',
      difference: '4880',
    });
    expect(await getAccountBalances(client.db, DEFAULT_HOUSEHOLD_ID)).toEqual([
      {
        accountId: expect.any(Number),
        accountName: '現金',
        income: '5000',
        expense: '120',
        transfersIn: '0',
        transfersOut: '300',
        balance: '4580',
      },
      {
        accountId: expect.any(Number),
        accountName: '銀行',
        income: '0',
        expense: '0',
        transfersIn: '300',
        transfersOut: '0',
        balance: '300',
      },
    ]);
  });

  it('keeps imported categories and transactions isolated by household', async () => {
    const otherHouseholdId = '00000000-0000-0000-0000-000000000002';
    await client.sql`
      insert into households (id, slug, name)
      values (${otherHouseholdId}, 'other', 'Other household')
    `;
    const row = importedRow({ categoryName: 'Same category' });
    await commitMoneyManagerImport(client.db, {
      householdId: DEFAULT_HOUSEHOLD_ID,
      sha256: 'b'.repeat(64),
      originalFilename: 'default.xlsx',
      rows: [row],
    });
    await commitMoneyManagerImport(client.db, {
      householdId: otherHouseholdId,
      sha256: 'c'.repeat(64),
      originalFilename: 'other.xlsx',
      rows: [row],
    });
    expect(
      await listTransactions(client.db, DEFAULT_HOUSEHOLD_ID, { month: '2026-09' }),
    ).toHaveLength(1);
    expect(await listTransactions(client.db, otherHouseholdId, { month: '2026-09' })).toHaveLength(
      1,
    );
    expect(
      (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID)).filter(
        (category) => category.name === 'Same category',
      ),
    ).toHaveLength(1);
    expect(
      (await listCategories(client.db, otherHouseholdId)).filter(
        (category) => category.name === 'Same category',
      ),
    ).toHaveLength(1);
  });

  it('reuses same-name household accounts but creates accounts for other households locally', async () => {
    const otherHouseholdId = '00000000-0000-0000-0000-000000000002';
    await client.sql`
      insert into households (id, slug, name)
      values (${otherHouseholdId}, 'account-other', 'Other account household')
    `;
    const [existingAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, 'Existing account')
      returning id
    `;
    const [otherHouseholdAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${otherHouseholdId}, 'Other-only account')
      returning id
    `;
    if (!existingAccount || !otherHouseholdAccount) {
      throw new Error('account reuse fixtures were not created');
    }

    const result = await commitMoneyManagerImport(client.db, {
      householdId: DEFAULT_HOUSEHOLD_ID,
      sha256: 'a'.repeat(64),
      originalFilename: 'account-reuse.xlsx',
      rows: [
        importedRow({ accountName: 'Existing account', categoryName: 'Account reuse' }),
        {
          sourceRow: 3,
          type: 'transfer',
          amount: 400,
          occurredOn: '2026-09-29',
          fromAccountName: 'Existing account',
          toAccountName: 'Other-only account',
          memo: 'household scope',
        },
      ],
    });
    if (result.status !== 'imported') {
      throw new Error('expected account reuse import to commit');
    }
    expect(result.accounts).toEqual([
      { name: 'Existing account', action: 'reused', id: existingAccount.id },
      { name: 'Other-only account', action: 'created', id: expect.any(Number) },
    ]);
    const [localOtherAccount] = await client.sql<{ id: number }[]>`
      select id
      from accounts
      where household_id = ${DEFAULT_HOUSEHOLD_ID} and name = 'Other-only account'
    `;
    expect(localOtherAccount?.id).toBeDefined();
    expect(localOtherAccount?.id).not.toBe(otherHouseholdAccount.id);
    expect(
      await client.sql`
        select count(*)::int as count
        from accounts
        where household_id = ${DEFAULT_HOUSEHOLD_ID} and name = 'Existing account'
      `,
    ).toEqual([{ count: 1 }]);
  });

  it('does not conflate categories with the same name across income and expense types', async () => {
    const result = await commitMoneyManagerImport(client.db, {
      householdId: DEFAULT_HOUSEHOLD_ID,
      sha256: 'd'.repeat(64),
      originalFilename: 'same-name.xlsx',
      rows: [
        importedRow({ categoryName: 'Same name', amount: 100 }),
        importedRow({ sourceRow: 3, type: 'income', categoryName: 'Same name', amount: 200 }),
      ],
    });
    if (result.status !== 'imported') {
      throw new Error('expected the import to commit');
    }
    expect(result.categories).toHaveLength(2);
    expect(
      (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID)).filter(
        (category) => category.name === 'Same name',
      ),
    ).toHaveLength(2);
    expect(
      await listTransactions(client.db, DEFAULT_HOUSEHOLD_ID, { month: '2026-09' }),
    ).toHaveLength(2);
  });

  it('returns a duplicate result and leaves the database constraint enforceable', async () => {
    const input = {
      householdId: DEFAULT_HOUSEHOLD_ID,
      sha256: 'e'.repeat(64),
      originalFilename: 'duplicate.xlsx',
      rows: [
        importedRow({ accountName: 'Duplicate source', categoryName: 'Duplicate category' }),
        {
          sourceRow: 3,
          type: 'transfer' as const,
          amount: 250,
          occurredOn: '2026-09-29',
          fromAccountName: 'Duplicate source',
          toAccountName: 'Duplicate destination',
          memo: 'duplicate transfer',
        },
      ],
    };
    const first = await commitMoneyManagerImport(client.db, input);
    const countsAfterFirst = {
      accounts: (await client.db.select().from(accounts)).length,
      transfers: (await client.db.select().from(transfers)).length,
      transactions: (await client.db.select().from(transactions)).length,
      imports: (await client.db.select().from(transactionImports)).length,
    };
    const second = await commitMoneyManagerImport(client.db, input);
    expect(first.status).toBe('imported');
    expect(second.status).toBe('duplicate');
    expect({
      accounts: (await client.db.select().from(accounts)).length,
      transfers: (await client.db.select().from(transfers)).length,
      transactions: (await client.db.select().from(transactions)).length,
      imports: (await client.db.select().from(transactionImports)).length,
    }).toEqual(countsAfterFirst);
    await expect(
      client.db.insert(transactionImports).values({
        householdId: DEFAULT_HOUSEHOLD_ID,
        source: 'realbyte-money-manager',
        sha256: input.sha256,
        originalFilename: input.originalFilename,
        transactionCount: 2,
      }),
    ).rejects.toMatchObject({
      cause: {
        code: '23505',
        constraint_name: 'transaction_imports_household_source_sha256_unique',
      },
    });
  });
  it('rejects import hashes outside the lowercase SHA-256 format', async () => {
    await expect(
      client.db.insert(transactionImports).values({
        householdId: DEFAULT_HOUSEHOLD_ID,
        source: 'realbyte-money-manager',
        sha256: 'A'.repeat(64),
        originalFilename: 'invalid-hash.xlsx',
        transactionCount: 0,
      }),
    ).rejects.toMatchObject({
      cause: {
        code: '23514',
        constraint_name: 'transaction_imports_sha256_check',
      },
    });
  });

  it('serializes concurrent imports so only one creates categories and transactions', async () => {
    const input = {
      householdId: DEFAULT_HOUSEHOLD_ID,
      sha256: 'f'.repeat(64),
      originalFilename: 'concurrent.xlsx',
      rows: [importedRow({ categoryName: 'Concurrent category' })],
    };
    const results = await Promise.all([
      commitMoneyManagerImport(client.db, input),
      commitMoneyManagerImport(client.db, input),
    ]);
    expect(results.filter((result) => result.status === 'imported')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'duplicate')).toHaveLength(1);
    const categoriesForImport = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID)).filter(
      (category) => category.name === 'Concurrent category',
    );
    expect(categoriesForImport).toHaveLength(1);
    expect(new Set(categoriesForImport.map((category) => category.sortOrder)).size).toBe(1);
    expect(
      await listTransactions(client.db, DEFAULT_HOUSEHOLD_ID, { month: '2026-09' }),
    ).toHaveLength(1);
    const distinctResults = await Promise.all([
      commitMoneyManagerImport(client.db, {
        ...input,
        sha256: '2'.repeat(64),
        originalFilename: 'concurrent-2.xlsx',
        rows: [importedRow({ categoryName: 'Concurrent category 2' })],
      }),
      commitMoneyManagerImport(client.db, {
        ...input,
        sha256: '3'.repeat(64),
        originalFilename: 'concurrent-3.xlsx',
        rows: [importedRow({ categoryName: 'Concurrent category 3' })],
      }),
    ]);
    expect(distinctResults.every((result) => result.status === 'imported')).toBe(true);
    const distinctCategories = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID)).filter(
      (category) => category.name.startsWith('Concurrent category'),
    );
    expect(new Set(distinctCategories.map((category) => category.sortOrder)).size).toBe(3);
    expect(
      await listTransactions(client.db, DEFAULT_HOUSEHOLD_ID, { month: '2026-09' }),
    ).toHaveLength(3);
  });

  it('rolls back new accounts, transfers, categories, transactions, and the import on failure', async () => {
    const rows: MoneyManagerNormalizedRow[] = Array.from({ length: 500 }, (_, index) =>
      importedRow({
        sourceRow: index + 2,
        accountName: 'Rollback normal account',
        categoryName: 'Atomic rollback',
        amount: 1,
      }),
    );
    rows.push({
      sourceRow: 502,
      type: 'transfer',
      amount: 100,
      occurredOn: '2026-09-29',
      fromAccountName: 'Rollback source',
      toAccountName: 'Rollback destination',
      memo: 'valid transfer rolled back',
    });
    rows.push({
      sourceRow: 503,
      type: 'transfer',
      amount: 1_000_000_000,
      occurredOn: '2026-09-29',
      fromAccountName: 'Rollback source',
      toAccountName: 'Rollback destination',
      memo: 'late failing transfer',
    });
    const before = {
      accounts: (await client.db.select().from(accounts)).length,
      transfers: (await client.db.select().from(transfers)).length,
      transactions: (await client.db.select().from(transactions)).length,
      categories: (await client.db.select().from(categories)).length,
      imports: (await client.db.select().from(transactionImports)).length,
    };
    await expect(
      commitMoneyManagerImport(client.db, {
        householdId: DEFAULT_HOUSEHOLD_ID,
        sha256: '0'.repeat(64),
        originalFilename: 'rollback.xlsx',
        rows,
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    expect({
      accounts: (await client.db.select().from(accounts)).length,
      transfers: (await client.db.select().from(transfers)).length,
      transactions: (await client.db.select().from(transactions)).length,
      categories: (await client.db.select().from(categories)).length,
      imports: (await client.db.select().from(transactionImports)).length,
    }).toEqual(before);
  });

  it('re-runs migrations without changing imported data or balances', async () => {
    const result = await commitMoneyManagerImport(client.db, {
      householdId: DEFAULT_HOUSEHOLD_ID,
      sha256: 'b'.repeat(64),
      originalFilename: 'migration-rerun.xlsx',
      rows: [
        importedRow({
          accountName: 'Migration source',
          categoryName: 'Migration expense',
          amount: 800,
        }),
        {
          sourceRow: 3,
          type: 'transfer',
          amount: 300,
          occurredOn: '2026-09-29',
          fromAccountName: 'Migration source',
          toAccountName: 'Migration destination',
          memo: 'migration transfer',
        },
      ],
    });
    expect(result.status).toBe('imported');
    const before = {
      accounts: (await client.db.select().from(accounts)).length,
      transfers: (await client.db.select().from(transfers)).length,
      transactions: (await client.db.select().from(transactions)).length,
      categories: (await client.db.select().from(categories)).length,
      imports: (await client.db.select().from(transactionImports)).length,
      balances: await getAccountBalances(client.db, DEFAULT_HOUSEHOLD_ID),
    };
    await runMigrations(testDatabaseUrl);
    expect({
      accounts: (await client.db.select().from(accounts)).length,
      transfers: (await client.db.select().from(transfers)).length,
      transactions: (await client.db.select().from(transactions)).length,
      categories: (await client.db.select().from(categories)).length,
      imports: (await client.db.select().from(transactionImports)).length,
      balances: await getAccountBalances(client.db, DEFAULT_HOUSEHOLD_ID),
    }).toEqual(before);
  });

  it('exposes imported totals and rows immediately after commit', async () => {
    await commitMoneyManagerImport(client.db, {
      householdId: DEFAULT_HOUSEHOLD_ID,
      sha256: '1'.repeat(64),
      originalFilename: 'totals.xlsx',
      rows: [
        importedRow({ categoryName: 'Immediate', amount: 300, memo: 'first' }),
        importedRow({ sourceRow: 3, categoryName: 'Immediate', amount: -50, memo: 'second' }),
      ],
    });
    expect(await getMonthlyTotals(client.db, DEFAULT_HOUSEHOLD_ID, '2026-09')).toEqual({
      income: '0',
      expense: '250',
      difference: '-250',
    });
    expect(
      await listTransactions(client.db, DEFAULT_HOUSEHOLD_ID, { month: '2026-09' }),
    ).toMatchObject([
      { amount: -50, memo: 'second', categoryName: 'Immediate' },
      { amount: 300, memo: 'first', categoryName: 'Immediate' },
    ]);
  });
});
