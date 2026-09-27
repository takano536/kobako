import { asc } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from './client.js';
import {
  DEFAULT_HOUSEHOLD_ID,
  createTransaction,
  deleteTransaction,
  getExpenseCategoryTotals,
  getMonthlyTotals,
  getTransaction,
  initializeDefaultLedger,
  listCategories,
  listTransactions,
  updateTransaction,
} from './ledger.js';
import { runMigrations } from './migrate.js';
import {
  assertSafeTestDatabaseTarget,
  verifySafeTestDatabaseConnection,
  type DatabaseTarget,
} from './database-safety.js';
import { systemHealthchecks, transactions } from './schema.js';
import { transactionInputSchema } from './validation.js';

interface PostgresErrorLike {
  code?: string;
  constraint_name?: string;
}

function pgError(error: unknown): PostgresErrorLike {
  return error as PostgresErrorLike;
}

describe('PostgreSQL migrations and ledger', () => {
  let client: DatabaseClient;
  let developmentUrl: string | undefined;
  let testDatabaseTarget: DatabaseTarget;

  beforeAll(async () => {
    const safeTestDatabase = assertSafeTestDatabaseTarget();
    testDatabaseTarget = safeTestDatabase.target;
    const testUrl = safeTestDatabase.url;
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
      truncate table "transactions", "categories", "households", "system_healthchecks"
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

  it('returns newest dates first with a stable id tiebreaker', async () => {
    const category = (await listCategories(client.db, DEFAULT_HOUSEHOLD_ID, 'expense'))[0];
    if (!category) {
      throw new Error('category seed missing');
    }
    const first = await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '100',
        occurredOn: '2026-09-01',
        categoryId: String(category.id),
        memo: 'first',
      }),
    );
    const second = await createTransaction(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      transactionInputSchema.parse({
        type: 'expense',
        amount: '200',
        occurredOn: '2026-09-01',
        categoryId: String(category.id),
        memo: 'second',
      }),
    );
    const rows = await listTransactions(client.db, DEFAULT_HOUSEHOLD_ID, { month: '2026-09' });
    expect(rows.map((row) => row.id)).toEqual([second.id, first.id]);
  });
});
