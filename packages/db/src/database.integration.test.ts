import { asc } from 'drizzle-orm';
import type { MoneyManagerLedgerRow, MoneyManagerNormalizedRow } from './money-manager-format.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from './client.js';
import {
  DEFAULT_HOUSEHOLD_ID,
  convertTransactionToTransfer,
  convertTransferToTransaction,
  createTransaction,
  createTransfer,
  deleteTransaction,
  deleteTransfer,
  getAccountBalances,
  getExpenseCategoryTotals,
  getMonthlyTotals,
  getTransaction,
  getTransfer,
  initializeDefaultLedger,
  listCategories,
  listLedgerEntries,
  listTransactions,
  updateTransaction,
  updateTransfer,
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
import {
  AMOUNT_LIMIT,
  MAX_INT4_ID,
  transactionInputSchema,
  transferInputSchema,
  type TransactionInput,
  type TransferInput,
} from './validation.js';

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

  it('computes all-time balances for accounts in one household', async () => {
    expect(await getAccountBalances(client.db, DEFAULT_HOUSEHOLD_ID)).toEqual([]);

    const [largeAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, 'A very long account name that should wrap safely')
      returning id
    `;
    const [idleAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, 'M idle account')
      returning id
    `;
    const [sinkAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, 'N transfer sink')
      returning id
    `;
    const [negativeAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, 'Z negative account')
      returning id
    `;
    const expenseCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'expense'))[0];
    const incomeCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'income'))[0];
    if (!largeAccount || !idleAccount || !sinkAccount || !negativeAccount) {
      throw new Error('balance account fixtures were not created');
    }
    if (!expenseCategory || !incomeCategory) {
      throw new Error('balance category fixtures were not created');
    }

    for (const occurredOn of ['1900-01-01', '2999-12-31']) {
      await createTransaction(
        client.db,
        DEFAULT_HOUSEHOLD_ID,
        transactionInputSchema.parse({
          type: 'income',
          amount: '999999999',
          occurredOn,
          categoryId: String(incomeCategory.id),
          accountId: String(largeAccount.id),
          memo: '',
        }),
      );
    }
    await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '700',
        occurredOn: '2026-09-01',
        categoryId: String(expenseCategory.id),
        accountId: String(negativeAccount.id),
        memo: '',
      }),
    );
    await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '-200',
        occurredOn: '9998-12-31',
        categoryId: String(expenseCategory.id),
        accountId: String(negativeAccount.id),
        memo: '符号付き訂正',
      }),
    );
    await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '1234',
        occurredOn: '2026-09-02',
        categoryId: String(expenseCategory.id),
        memo: '口座未指定',
      }),
    );

    const firstTransfer = await createTransfer(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transferInputSchema.parse({
        fromAccountId: String(largeAccount.id),
        toAccountId: String(negativeAccount.id),
        amount: '300',
        occurredOn: '2026-09-03',
        memo: '振替入出金',
      }),
    );
    const secondTransfer = await createTransfer(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transferInputSchema.parse({
        fromAccountId: String(negativeAccount.id),
        toAccountId: String(sinkAccount.id),
        amount: '100',
        occurredOn: '9998-12-31',
        memo: '未来の振替',
      }),
    );
    expect(firstTransfer.status).toBe('ok');
    expect(secondTransfer.status).toBe('ok');

    const otherHouseholdId = '00000000-0000-0000-0000-000000000002';
    await client.sql`
      insert into households (id, slug, name)
      values (${otherHouseholdId}, 'balance-other', '別家計')
    `;
    const [otherAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${otherHouseholdId}, 'A very long account name that should wrap safely')
      returning id
    `;
    const [otherCategory] = await client.sql<{ id: number }[]>`
      insert into categories (household_id, type, name, sort_order)
      values (${otherHouseholdId}, 'income', '別家計収入', 999)
      returning id
    `;
    if (!otherAccount || !otherCategory) {
      throw new Error('other-household balance fixtures were not created');
    }
    await client.sql`
      insert into transactions
        (household_id, type, amount, occurred_on, category_id, account_id, memo)
      values
        (${otherHouseholdId}, 'income', 7777, '9998-12-31', ${otherCategory.id}, ${otherAccount.id}, '')
    `;

    const balances = await getAccountBalances(client.db, DEFAULT_HOUSEHOLD_ID);
    expect(balances.map(({ accountName }) => accountName)).toEqual([
      'A very long account name that should wrap safely',
      'M idle account',
      'N transfer sink',
      'Z negative account',
    ]);
    expect(
      balances.map(({ accountName, income, expense, transfersIn, transfersOut, balance }) => ({
        accountName,
        income,
        expense,
        transfersIn,
        transfersOut,
        balance,
      })),
    ).toEqual([
      {
        accountName: 'A very long account name that should wrap safely',
        income: '1999999998',
        expense: '0',
        transfersIn: '0',
        transfersOut: '300',
        balance: '1999999698',
      },
      {
        accountName: 'M idle account',
        income: '0',
        expense: '0',
        transfersIn: '0',
        transfersOut: '0',
        balance: '0',
      },
      {
        accountName: 'N transfer sink',
        income: '0',
        expense: '0',
        transfersIn: '100',
        transfersOut: '0',
        balance: '100',
      },
      {
        accountName: 'Z negative account',
        income: '0',
        expense: '500',
        transfersIn: '300',
        transfersOut: '100',
        balance: '-300',
      },
    ]);
    expect(balances.reduce((total, { balance }) => total + BigInt(balance), 0n)).toBe(1999999498n);
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

  it('preserves an account when omitted and clears it only when null is explicit', async () => {
    const expenseCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'expense'))[0];
    if (!expenseCategory) {
      throw new Error('expense category seed missing');
    }
    const [account] = await client.db
      .insert(accounts)
      .values({ householdId: DEFAULT_HOUSEHOLD_ID, name: '編集保持テスト口座' })
      .returning({ id: accounts.id });
    if (!account) {
      throw new Error('account fixture was not created');
    }
    const created = await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '500',
        occurredOn: '2026-09-14',
        categoryId: String(expenseCategory.id),
        accountId: String(account.id),
        memo: '口座保持',
      }),
    );

    const preserved = await updateTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      created.id,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '700',
        occurredOn: '2026-09-14',
        categoryId: String(expenseCategory.id),
        memo: '口座保持後',
      }),
    );
    expect(preserved).toMatchObject({ accountId: account.id, amount: 700 });

    const cleared = await updateTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      created.id,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '700',
        occurredOn: '2026-09-14',
        categoryId: String(expenseCategory.id),
        accountId: null,
        memo: '口座解除後',
      }),
    );
    expect(cleared).toMatchObject({ accountId: null, memo: '口座解除後' });
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

  it('creates, edits, and deletes transfers with household and balance boundaries', async () => {
    const [fromAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, '操作元')
      returning id
    `;
    const [toAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, '操作先')
      returning id
    `;
    const [alternateAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, '変更先')
      returning id
    `;
    if (!fromAccount || !toAccount || !alternateAccount) {
      throw new Error('transfer account fixtures were not created');
    }
    const expenseCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'expense'))[0];
    const incomeCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'income'))[0];
    if (!expenseCategory || !incomeCategory) {
      throw new Error('transfer category fixtures were not created');
    }
    await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'income',
        amount: '10000',
        occurredOn: '2026-09-01',
        categoryId: String(incomeCategory.id),
        accountId: String(fromAccount.id),
        memo: '',
      }),
    );
    await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '1000',
        occurredOn: '2026-09-02',
        categoryId: String(expenseCategory.id),
        accountId: String(fromAccount.id),
        memo: '',
      }),
    );

    const input = transferInputSchema.parse({
      fromAccountId: String(fromAccount.id),
      toAccountId: String(toAccount.id),
      amount: '3000',
      occurredOn: '2026-09-03',
      memo: '作成',
    });
    const sameCreateResult = await createTransfer(client.db, DEFAULT_HOUSEHOLD_ID, {
      ...input,
      toAccountId: fromAccount.id,
    });
    expect(sameCreateResult).toEqual({ status: 'validation_error', code: 'same_account' });
    const outOfRangeCreateResult = await createTransfer(client.db, DEFAULT_HOUSEHOLD_ID, {
      ...input,
      fromAccountId: 2_147_483_648,
    });
    expect(outOfRangeCreateResult).toEqual({
      status: 'validation_error',
      code: 'from_account_unavailable',
    });
    const bothUnavailableResult = await createTransfer(client.db, DEFAULT_HOUSEHOLD_ID, {
      ...input,
      fromAccountId: 2_147_483_648,
      toAccountId: 2_147_483_649,
    });
    expect(bothUnavailableResult).toEqual({
      status: 'validation_error',
      code: 'accounts_unavailable',
    });
    const createdResult = await createTransfer(client.db, DEFAULT_HOUSEHOLD_ID, input);
    expect(createdResult.status).toBe('ok');
    if (createdResult.status !== 'ok') {
      throw new Error('transfer was not created');
    }
    expect(
      await getTransfer(client.db, DEFAULT_HOUSEHOLD_ID, createdResult.transfer.id),
    ).toMatchObject({
      id: createdResult.transfer.id,
      fromAccountName: '操作元',
      toAccountName: '操作先',
      amount: 3000,
      memo: '作成',
    });
    expect(await getMonthlyTotals(client.db, DEFAULT_HOUSEHOLD_ID, '2026-09')).toEqual({
      income: '10000',
      expense: '1000',
      difference: '9000',
    });

    const initialBalances = await getAccountBalances(client.db, DEFAULT_HOUSEHOLD_ID);
    expect(initialBalances.find((balance) => balance.accountId === fromAccount.id)).toMatchObject({
      income: '10000',
      expense: '1000',
      transfersOut: '3000',
      transfersIn: '0',
      balance: '6000',
    });
    expect(initialBalances.find((balance) => balance.accountId === toAccount.id)).toMatchObject({
      balance: '3000',
    });
    expect(initialBalances.reduce((sum, balance) => sum + BigInt(balance.balance), 0n)).toBe(9000n);

    const updatedInput = transferInputSchema.parse({
      fromAccountId: String(toAccount.id),
      toAccountId: String(alternateAccount.id),
      amount: '2000',
      occurredOn: '2026-09-04',
      memo: '変更',
    });
    const updatedResult = await updateTransfer(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      createdResult.transfer.id,
      updatedInput,
    );
    expect(updatedResult.status).toBe('ok');
    expect(
      await getTransfer(client.db, DEFAULT_HOUSEHOLD_ID, createdResult.transfer.id),
    ).toMatchObject({
      fromAccountName: '操作先',
      toAccountName: '変更先',
      amount: 2000,
      occurredOn: '2026-09-04',
    });
    const outOfRangeUpdateResult = await updateTransfer(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      createdResult.transfer.id,
      {
        ...updatedInput,
        toAccountId: MAX_INT4_ID + 1,
      },
    );
    expect(outOfRangeUpdateResult).toEqual({
      status: 'validation_error',
      code: 'to_account_unavailable',
    });

    const sameAccountResult = await updateTransfer(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      createdResult.transfer.id,
      {
        ...updatedInput,
        fromAccountId: toAccount.id,
        toAccountId: toAccount.id,
      },
    );
    expect(sameAccountResult).toEqual({ status: 'validation_error', code: 'same_account' });
    const unavailableResult = await updateTransfer(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      createdResult.transfer.id,
      {
        ...updatedInput,
        toAccountId: 99999999,
      },
    );
    expect(unavailableResult).toEqual({
      status: 'validation_error',
      code: 'to_account_unavailable',
    });
    expect(
      await getTransfer(client.db, DEFAULT_HOUSEHOLD_ID, createdResult.transfer.id),
    ).toMatchObject({
      fromAccountId: toAccount.id,
      toAccountId: alternateAccount.id,
      amount: 2000,
    });

    const updatedBalances = await getAccountBalances(client.db, DEFAULT_HOUSEHOLD_ID);
    expect(updatedBalances.find((balance) => balance.accountId === fromAccount.id)?.balance).toBe(
      '9000',
    );
    expect(updatedBalances.find((balance) => balance.accountId === toAccount.id)?.balance).toBe(
      '-2000',
    );
    expect(
      updatedBalances.find((balance) => balance.accountId === alternateAccount.id)?.balance,
    ).toBe('2000');

    const deletedResult = await deleteTransfer(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      createdResult.transfer.id,
    );
    expect(deletedResult).toEqual({ status: 'ok', occurredOn: '2026-09-04' });
    expect(
      await getTransfer(client.db, DEFAULT_HOUSEHOLD_ID, createdResult.transfer.id),
    ).toBeNull();
    const revertedBalances = await getAccountBalances(client.db, DEFAULT_HOUSEHOLD_ID);
    expect(revertedBalances.find((balance) => balance.accountId === fromAccount.id)?.balance).toBe(
      '9000',
    );
    expect(revertedBalances.find((balance) => balance.accountId === toAccount.id)?.balance).toBe(
      '0',
    );
    expect(
      revertedBalances.find((balance) => balance.accountId === alternateAccount.id)?.balance,
    ).toBe('0');
    expect(revertedBalances.reduce((sum, balance) => sum + BigInt(balance.balance), 0n)).toBe(
      9000n,
    );
    expect(await getMonthlyTotals(client.db, DEFAULT_HOUSEHOLD_ID, '2026-09')).toEqual({
      income: '10000',
      expense: '1000',
      difference: '9000',
    });

    const otherHouseholdId = '00000000-0000-0000-0000-000000000002';
    await client.sql`
      insert into households (id, slug, name)
      values (${otherHouseholdId}, 'transfer-api-other', '別家計')
    `;
    const [otherFrom] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${otherHouseholdId}, '別家計元')
      returning id
    `;
    const [otherTo] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${otherHouseholdId}, '別家計先')
      returning id
    `;
    if (!otherFrom || !otherTo) {
      throw new Error('other household transfer fixtures were not created');
    }
    const otherTransferResult = await createTransfer(
      client.db,
      otherHouseholdId,
      transferInputSchema.parse({
        fromAccountId: String(otherFrom.id),
        toAccountId: String(otherTo.id),
        amount: '500',
        occurredOn: '2026-09-05',
        memo: '',
      }),
    );
    expect(otherTransferResult.status).toBe('ok');
    if (otherTransferResult.status !== 'ok') {
      throw new Error('other household transfer was not created');
    }
    expect(
      await getTransfer(client.db, DEFAULT_HOUSEHOLD_ID, otherTransferResult.transfer.id),
    ).toBeNull();
    expect(
      await updateTransfer(client.db, DEFAULT_HOUSEHOLD_ID, otherTransferResult.transfer.id, {
        ...input,
        fromAccountId: fromAccount.id,
        toAccountId: fromAccount.id,
      }),
    ).toEqual({ status: 'not_found' });
    expect(
      await updateTransfer(client.db, DEFAULT_HOUSEHOLD_ID, otherTransferResult.transfer.id, input),
    ).toEqual({ status: 'not_found' });
    expect(
      await deleteTransfer(client.db, DEFAULT_HOUSEHOLD_ID, otherTransferResult.transfer.id),
    ).toEqual({ status: 'not_found' });
    expect(
      await getTransfer(client.db, otherHouseholdId, otherTransferResult.transfer.id),
    ).not.toBeNull();
  });

  it('converts transactions and transfers in one household transaction', async () => {
    const [fromAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, '変換元')
      returning id
    `;
    const [toAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, '変換先')
      returning id
    `;
    const expenseCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'expense'))[0];
    const incomeCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'income'))[0];
    if (!fromAccount || !toAccount || !expenseCategory || !incomeCategory) {
      throw new Error('conversion fixtures were not created');
    }

    const sourceTransaction = await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '750',
        occurredOn: '2026-09-12',
        categoryId: String(expenseCategory.id),
        memo: '変換前',
      }),
    );
    const toTransferResult = await convertTransactionToTransfer(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      sourceTransaction.id,
      transferInputSchema.parse({
        fromAccountId: String(fromAccount.id),
        toAccountId: String(toAccount.id),
        amount: '750',
        occurredOn: sourceTransaction.occurredOn,
        memo: sourceTransaction.memo,
      }),
    );
    expect(toTransferResult.status).toBe('ok');
    if (toTransferResult.status !== 'ok') {
      throw new Error('transaction conversion did not create a transfer');
    }
    expect(await getTransaction(client.db, DEFAULT_HOUSEHOLD_ID, sourceTransaction.id)).toBeNull();
    expect(
      await getTransfer(client.db, DEFAULT_HOUSEHOLD_ID, toTransferResult.transfer.id),
    ).toMatchObject({ amount: 750, fromAccountName: '変換元', toAccountName: '変換先' });

    const sourceTransferResult = await createTransfer(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transferInputSchema.parse({
        fromAccountId: String(fromAccount.id),
        toAccountId: String(toAccount.id),
        amount: '500',
        occurredOn: '2026-09-13',
        memo: '振替前',
      }),
    );
    expect(sourceTransferResult.status).toBe('ok');
    if (sourceTransferResult.status !== 'ok') {
      throw new Error('transfer conversion source was not created');
    }
    const toTransactionResult = await convertTransferToTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      sourceTransferResult.transfer.id,
      transactionInputSchema.parse({
        type: 'income',
        amount: '500',
        occurredOn: '2026-09-13',
        categoryId: String(incomeCategory.id),
        memo: '変換後',
      }),
    );
    expect(toTransactionResult.status).toBe('ok');
    if (toTransactionResult.status !== 'ok') {
      throw new Error('transfer conversion did not create a transaction');
    }
    expect(
      await getTransfer(client.db, DEFAULT_HOUSEHOLD_ID, sourceTransferResult.transfer.id),
    ).toBeNull();
    expect(
      await getTransaction(client.db, DEFAULT_HOUSEHOLD_ID, toTransactionResult.transaction.id),
    ).toMatchObject({ amount: 500, type: 'income', categoryName: incomeCategory.name });

    const invalidSource = await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '100',
        occurredOn: '2026-09-14',
        categoryId: String(expenseCategory.id),
        memo: '',
      }),
    );
    expect(
      await convertTransactionToTransfer(
        client.db,
        DEFAULT_HOUSEHOLD_ID,
        invalidSource.id,
        transferInputSchema.parse({
          fromAccountId: '99999999',
          toAccountId: String(toAccount.id),
          amount: '100',
          occurredOn: invalidSource.occurredOn,
          memo: '',
        }),
      ),
    ).toEqual({ status: 'validation_error', code: 'from_account_unavailable' });
    expect(await getTransaction(client.db, DEFAULT_HOUSEHOLD_ID, invalidSource.id)).not.toBeNull();
  });

  it('converts ordinary and transfer entries in every direction with stable totals', async () => {
    const [fromAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, '集計元')
      returning id
    `;
    const [toAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, '集計先')
      returning id
    `;
    const expenseCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'expense'))[0];
    const incomeCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'income'))[0];
    if (!fromAccount || !toAccount || !expenseCategory || !incomeCategory) {
      throw new Error('direction conversion fixtures were not created');
    }

    const ordinary = await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '100',
        occurredOn: '2026-09-01',
        categoryId: String(expenseCategory.id),
        memo: '通常変換',
      }),
    );
    const asIncome = await updateTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      ordinary.id,
      transactionInputSchema.parse({
        type: 'income',
        amount: '100',
        occurredOn: ordinary.occurredOn,
        categoryId: String(incomeCategory.id),
        memo: ordinary.memo,
      }),
    );
    expect(asIncome).toMatchObject({ type: 'income', categoryId: incomeCategory.id });
    const asExpense = await updateTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      ordinary.id,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '100',
        occurredOn: ordinary.occurredOn,
        categoryId: String(expenseCategory.id),
        memo: ordinary.memo,
      }),
    );
    expect(asExpense).toMatchObject({ type: 'expense', categoryId: expenseCategory.id });

    const ordinaryToTransfer = await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '300',
        occurredOn: '2026-09-02',
        categoryId: String(expenseCategory.id),
        memo: '通常から振替',
      }),
    );
    const transferResult = await convertTransactionToTransfer(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      ordinaryToTransfer.id,
      transferInputSchema.parse({
        fromAccountId: String(fromAccount.id),
        toAccountId: String(toAccount.id),
        amount: '300',
        occurredOn: ordinaryToTransfer.occurredOn,
        memo: ordinaryToTransfer.memo,
      }),
    );
    expect(transferResult.status).toBe('ok');
    if (transferResult.status !== 'ok') {
      throw new Error('ordinary to transfer conversion failed');
    }
    expect(await getTransaction(client.db, DEFAULT_HOUSEHOLD_ID, ordinaryToTransfer.id)).toBeNull();
    expect(await getMonthlyTotals(client.db, DEFAULT_HOUSEHOLD_ID, '2026-09')).toEqual({
      income: '0',
      expense: '100',
      difference: '-100',
    });
    expect(await getExpenseCategoryTotals(client.db, DEFAULT_HOUSEHOLD_ID, '2026-09')).toEqual([
      { categoryId: expenseCategory.id, categoryName: expenseCategory.name, total: '100' },
    ]);

    const transferToIncome = await convertTransferToTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transferResult.transfer.id,
      transactionInputSchema.parse({
        type: 'income',
        amount: '300',
        occurredOn: '2026-09-02',
        categoryId: String(incomeCategory.id),
        memo: '振替から収入',
      }),
    );
    expect(transferToIncome.status).toBe('ok');
    if (transferToIncome.status !== 'ok') {
      throw new Error('transfer to income conversion failed');
    }
    expect(
      await getTransfer(client.db, DEFAULT_HOUSEHOLD_ID, transferResult.transfer.id),
    ).toBeNull();
    expect(
      await getTransaction(client.db, DEFAULT_HOUSEHOLD_ID, transferToIncome.transaction.id),
    ).toMatchObject({ type: 'income', categoryId: incomeCategory.id });

    const transferToExpense = await createTransfer(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transferInputSchema.parse({
        fromAccountId: String(fromAccount.id),
        toAccountId: String(toAccount.id),
        amount: '200',
        occurredOn: '2026-09-03',
        memo: '振替から支出',
      }),
    );
    expect(transferToExpense.status).toBe('ok');
    if (transferToExpense.status !== 'ok') {
      throw new Error('transfer fixture was not created');
    }
    const expenseResult = await convertTransferToTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transferToExpense.transfer.id,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '200',
        occurredOn: '2026-09-03',
        categoryId: String(expenseCategory.id),
        memo: '振替から支出',
      }),
    );
    expect(expenseResult.status).toBe('ok');
    if (expenseResult.status !== 'ok') {
      throw new Error('transfer to expense conversion failed');
    }
    expect(
      await getTransfer(client.db, DEFAULT_HOUSEHOLD_ID, transferToExpense.transfer.id),
    ).toBeNull();
    expect(await getMonthlyTotals(client.db, DEFAULT_HOUSEHOLD_ID, '2026-09')).toEqual({
      income: '300',
      expense: '300',
      difference: '0',
    });
    expect(await getExpenseCategoryTotals(client.db, DEFAULT_HOUSEHOLD_ID, '2026-09')).toEqual([
      { categoryId: expenseCategory.id, categoryName: expenseCategory.name, total: '300' },
    ]);
    const balances = await getAccountBalances(client.db, DEFAULT_HOUSEHOLD_ID);
    expect(balances.reduce((sum, balance) => sum + BigInt(balance.balance), 0n)).toBe(0n);
    expect(balances.find((balance) => balance.accountId === fromAccount.id)?.balance).toBe('0');
    expect(balances.find((balance) => balance.accountId === toAccount.id)?.balance).toBe('0');
  });

  it('rolls back conversion insert failures and rejects other-household resources', async () => {
    const [fromAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, '失敗元')
      returning id
    `;
    const [toAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, '失敗先')
      returning id
    `;
    const expenseCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'expense'))[0];
    if (!fromAccount || !toAccount || !expenseCategory) {
      throw new Error('rollback conversion fixtures were not created');
    }
    const sourceTransaction = await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '100',
        occurredOn: '2026-09-01',
        categoryId: String(expenseCategory.id),
        memo: 'insert失敗元',
      }),
    );
    const transferInput = transferInputSchema.parse({
      fromAccountId: String(fromAccount.id),
      toAccountId: String(toAccount.id),
      amount: '100',
      occurredOn: sourceTransaction.occurredOn,
      memo: sourceTransaction.memo,
    });
    const failedTransfer = await convertTransactionToTransfer(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      sourceTransaction.id,
      { ...transferInput, amount: AMOUNT_LIMIT + 1 } as TransferInput,
    );
    expect(failedTransfer).toEqual({ status: 'error' });
    expect(
      await getTransaction(client.db, DEFAULT_HOUSEHOLD_ID, sourceTransaction.id),
    ).not.toBeNull();
    expect(await client.db.select().from(transfers)).toHaveLength(0);

    const sourceTransfer = await createTransfer(client.db, DEFAULT_HOUSEHOLD_ID, transferInput);
    expect(sourceTransfer.status).toBe('ok');
    if (sourceTransfer.status !== 'ok') {
      throw new Error('rollback transfer fixture was not created');
    }
    const transactionInput = transactionInputSchema.parse({
      type: 'expense',
      amount: '100',
      occurredOn: '2026-09-02',
      categoryId: String(expenseCategory.id),
      memo: 'insert失敗振替',
    });
    const failedTransaction = await convertTransferToTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      sourceTransfer.transfer.id,
      { ...transactionInput, amount: AMOUNT_LIMIT + 1 } as TransactionInput,
    );
    expect(failedTransaction).toEqual({ status: 'error' });
    expect(
      await getTransfer(client.db, DEFAULT_HOUSEHOLD_ID, sourceTransfer.transfer.id),
    ).not.toBeNull();

    const otherHouseholdId = '00000000-0000-0000-0000-000000000003';
    await client.sql`
      insert into households (id, slug, name)
      values (${otherHouseholdId}, 'conversion-other', '変換別家計')
    `;
    const [otherFrom] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${otherHouseholdId}, '別元')
      returning id
    `;
    const [otherTo] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${otherHouseholdId}, '別先')
      returning id
    `;
    const [otherCategory] = await client.sql<{ id: number }[]>`
      insert into categories (household_id, type, name, sort_order)
      values (${otherHouseholdId}, 'expense', '別カテゴリ', 10)
      returning id
    `;
    if (!otherFrom || !otherTo || !otherCategory) {
      throw new Error('other household conversion fixtures were not created');
    }
    const householdSource = await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '50',
        occurredOn: '2026-09-03',
        categoryId: String(expenseCategory.id),
        memo: '別家計口座拒否',
      }),
    );
    expect(
      await convertTransactionToTransfer(
        client.db,
        DEFAULT_HOUSEHOLD_ID,
        householdSource.id,
        transferInputSchema.parse({
          fromAccountId: String(otherFrom.id),
          toAccountId: String(otherTo.id),
          amount: '50',
          occurredOn: householdSource.occurredOn,
          memo: householdSource.memo,
        }),
      ),
    ).toEqual({ status: 'validation_error', code: 'accounts_unavailable' });
    expect(
      await getTransaction(client.db, DEFAULT_HOUSEHOLD_ID, householdSource.id),
    ).not.toBeNull();

    const householdTransfer = await createTransfer(client.db, DEFAULT_HOUSEHOLD_ID, transferInput);
    expect(householdTransfer.status).toBe('ok');
    if (householdTransfer.status !== 'ok') {
      throw new Error('household transfer fixture was not created');
    }
    expect(
      await convertTransferToTransaction(
        client.db,
        DEFAULT_HOUSEHOLD_ID,
        householdTransfer.transfer.id,
        transactionInputSchema.parse({
          type: 'expense',
          amount: '100',
          occurredOn: '2026-09-04',
          categoryId: String(otherCategory.id),
          memo: '別家計カテゴリ拒否',
        }),
      ),
    ).toEqual({ status: 'validation_error', code: 'category_unavailable' });
    expect(
      await getTransfer(client.db, DEFAULT_HOUSEHOLD_ID, householdTransfer.transfer.id),
    ).not.toBeNull();
  });

  it('keeps unrelated ledger rows and orders mixed entries by date', async () => {
    const [fromAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, '並び元')
      returning id
    `;
    const [toAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, '並び先')
      returning id
    `;
    const [alternateAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, '並び別')
      returning id
    `;
    if (!fromAccount || !toAccount || !alternateAccount) {
      throw new Error('mixed ledger account fixtures were not created');
    }
    const expenseCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'expense'))[0];
    const incomeCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'income'))[0];
    if (!expenseCategory || !incomeCategory) {
      throw new Error('mixed ledger category fixtures were not created');
    }
    const incomeTransaction = await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'income',
        amount: '100',
        occurredOn: '2026-09-01',
        categoryId: String(incomeCategory.id),
        accountId: String(fromAccount.id),
        memo: '並び収入',
      }),
    );
    const expenseTransaction = await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '20',
        occurredOn: '2026-09-03',
        categoryId: String(expenseCategory.id),
        accountId: String(fromAccount.id),
        memo: '残す支出',
      }),
    );
    const survivorResult = await createTransfer(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transferInputSchema.parse({
        fromAccountId: String(fromAccount.id),
        toAccountId: String(toAccount.id),
        amount: '40',
        occurredOn: '2026-09-04',
        memo: '残す振替',
      }),
    );
    const targetResult = await createTransfer(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transferInputSchema.parse({
        fromAccountId: String(fromAccount.id),
        toAccountId: String(alternateAccount.id),
        amount: '30',
        occurredOn: '2026-09-02',
        memo: '削除対象',
      }),
    );
    if (
      survivorResult.status !== 'ok' ||
      targetResult.status !== 'ok' ||
      !incomeTransaction ||
      !expenseTransaction
    ) {
      throw new Error('mixed ledger fixtures were not created');
    }
    const mixedEntries = await listLedgerEntries(client.db, DEFAULT_HOUSEHOLD_ID, {
      month: '2026-09',
    });
    expect(mixedEntries.map((entry) => `${entry.occurredOn}:${entry.type}`)).toEqual([
      '2026-09-04:transfer',
      '2026-09-03:expense',
      '2026-09-02:transfer',
      '2026-09-01:income',
    ]);

    const transferOnly = await listLedgerEntries(client.db, DEFAULT_HOUSEHOLD_ID, {
      month: '2026-09',
      type: 'transfer',
      categoryId: expenseCategory.id,
    });
    expect(transferOnly.map((entry) => entry.type)).toEqual(['transfer', 'transfer']);

    await expect(
      deleteTransfer(client.db, DEFAULT_HOUSEHOLD_ID, targetResult.transfer.id),
    ).resolves.toEqual({ status: 'ok', occurredOn: '2026-09-02' });
    expect(
      await getTransfer(client.db, DEFAULT_HOUSEHOLD_ID, survivorResult.transfer.id),
    ).not.toBeNull();
    expect(
      await getTransaction(client.db, DEFAULT_HOUSEHOLD_ID, expenseTransaction.id),
    ).not.toBeNull();
    const remainingEntries = await listLedgerEntries(client.db, DEFAULT_HOUSEHOLD_ID, {
      month: '2026-09',
    });
    expect(remainingEntries.map((entry) => `${entry.occurredOn}:${entry.type}`)).toEqual([
      '2026-09-04:transfer',
      '2026-09-03:expense',
      '2026-09-01:income',
    ]);
  });

  it('orders same-date transfers and transactions deterministically', async () => {
    const [fromAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, '同日元')
      returning id
    `;
    const [toAccount] = await client.sql<{ id: number }[]>`
      insert into accounts (household_id, name)
      values (${DEFAULT_HOUSEHOLD_ID}, '同日先')
      returning id
    `;
    const expenseCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'expense'))[0];
    const incomeCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'income'))[0];
    if (!fromAccount || !toAccount || !expenseCategory || !incomeCategory) {
      throw new Error('same-date ordering fixtures were not created');
    }
    await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'income',
        amount: '10',
        occurredOn: '2026-09-10',
        categoryId: String(incomeCategory.id),
        memo: '同日収入1',
      }),
    );
    await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '20',
        occurredOn: '2026-09-10',
        categoryId: String(expenseCategory.id),
        memo: '同日支出2',
      }),
    );
    const firstTransfer = await createTransfer(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transferInputSchema.parse({
        fromAccountId: String(fromAccount.id),
        toAccountId: String(toAccount.id),
        amount: '30',
        occurredOn: '2026-09-10',
        memo: '同日振替1',
      }),
    );
    const secondTransfer = await createTransfer(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transferInputSchema.parse({
        fromAccountId: String(fromAccount.id),
        toAccountId: String(toAccount.id),
        amount: '40',
        occurredOn: '2026-09-10',
        memo: '同日振替2',
      }),
    );
    expect(firstTransfer.status).toBe('ok');
    expect(secondTransfer.status).toBe('ok');
    const first = await listLedgerEntries(client.db, DEFAULT_HOUSEHOLD_ID, { month: '2026-09' });
    const second = await listLedgerEntries(client.db, DEFAULT_HOUSEHOLD_ID, { month: '2026-09' });
    const describe = (entries: typeof first) =>
      entries.map((entry) => `${entry.type}:${entry.memo}`);
    expect(describe(second)).toEqual(describe(first));
    expect(describe(first)).toEqual([
      'transfer:同日振替2',
      'expense:同日支出2',
      'transfer:同日振替1',
      'income:同日収入1',
    ]);
  });

  it('allows imported transfers to use the same edit and delete operations', async () => {
    const imported = await commitMoneyManagerImport(client.db, {
      householdId: DEFAULT_HOUSEHOLD_ID,
      sha256: 'b'.repeat(64),
      originalFilename: 'transfer-edit.xlsx',
      rows: [
        {
          sourceRow: 2,
          type: 'transfer',
          amount: 700,
          occurredOn: '2026-09-06',
          fromAccountName: '取込元',
          toAccountName: '取込先',
          memo: '取込',
        },
      ],
    });
    expect(imported.status).toBe('imported');
    const entries = await listLedgerEntries(client.db, DEFAULT_HOUSEHOLD_ID, { month: '2026-09' });
    const transfer = entries.find((entry) => entry.type === 'transfer');
    if (!transfer || transfer.type !== 'transfer') {
      throw new Error('imported transfer was not created');
    }
    const edited = await updateTransfer(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transfer.id,
      transferInputSchema.parse({
        fromAccountId: String(transfer.fromAccountId),
        toAccountId: String(transfer.toAccountId),
        amount: '800',
        occurredOn: transfer.occurredOn,
        memo: '編集済み',
      }),
    );
    expect(edited.status).toBe('ok');
    expect(await getTransfer(client.db, DEFAULT_HOUSEHOLD_ID, transfer.id)).toMatchObject({
      amount: 800,
      memo: '編集済み',
    });
    const expenseCategory = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'expense'))[0];
    if (!expenseCategory) {
      throw new Error('import conversion category fixture is missing');
    }
    const converted = await convertTransferToTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transfer.id,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '800',
        occurredOn: transfer.occurredOn,
        categoryId: String(expenseCategory.id),
        memo: '変換済み',
      }),
    );
    expect(converted.status).toBe('ok');
    if (converted.status !== 'ok') {
      throw new Error('imported transfer conversion failed');
    }
    expect(await getTransfer(client.db, DEFAULT_HOUSEHOLD_ID, transfer.id)).toBeNull();
    expect(
      await deleteTransaction(client.db, DEFAULT_HOUSEHOLD_ID, converted.transaction.id),
    ).toMatchObject({ occurredOn: transfer.occurredOn });
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
