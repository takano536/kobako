import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_HOUSEHOLD_ID,
  createAccount,
  ingestApiBatch,
  initializeDefaultLedger,
  listLedgerEntries,
  type ApiRowResult,
  type DatabaseClient,
} from '@kobako/db';
import { createDatabaseClient } from './client.js';
import {
  assertSafeTestDatabaseTarget,
  verifySafeTestDatabaseConnection,
  type DatabaseTarget,
} from './database-safety.js';
import { listCategories } from './ledger.js';
import { runMigrations } from './migrate.js';
import { apiBatches, assetCategories, transactions, transfers } from './schema.js';

const HOUSEHOLD_ID = DEFAULT_HOUSEHOLD_ID;
const MONTH = '2026-09';

async function createBankAccount(client: DatabaseClient, name: string): Promise<number> {
  const rows = await client.db
    .select({ id: assetCategories.id })
    .from(assetCategories)
    .where(
      and(eq(assetCategories.householdId, HOUSEHOLD_ID), eq(assetCategories.systemKey, 'bank')),
    )
    .limit(1);
  const category = rows[0];
  if (!category) throw new Error('asset category seed missing: bank');
  const result = await createAccount(client.db, HOUSEHOLD_ID, {
    name,
    assetCategoryId: category.id,
  });
  if (result.status !== 'ok') throw new Error(`failed to create account: ${result.status}`);
  return result.account.id;
}

async function expenseCategoryName(client: DatabaseClient): Promise<string> {
  const categories = await listCategories(client.db, HOUSEHOLD_ID);
  const expense = categories.find((category) => category.type === 'expense');
  if (!expense) throw new Error('expense category seed missing');
  return expense.name;
}

async function transactionCount(client: DatabaseClient): Promise<number> {
  const rows = await client.db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.householdId, HOUSEHOLD_ID));
  return rows.length;
}

function statuses(rows: readonly ApiRowResult[]): string[] {
  return rows.map((row) => row.status);
}

describe('API batch ingest', () => {
  let client: DatabaseClient;
  let target: DatabaseTarget;
  let developmentUrl: string | undefined;

  beforeAll(async () => {
    const safeTarget = assertSafeTestDatabaseTarget();
    target = safeTarget.target;
    developmentUrl = process.env.DATABASE_URL;
    const probe = createDatabaseClient(safeTarget.url);
    try {
      await verifySafeTestDatabaseConnection(probe.sql, target, developmentUrl);
    } finally {
      await probe.close();
    }
    await runMigrations(safeTarget.url);
    client = createDatabaseClient(safeTarget.url);
  });

  beforeEach(async () => {
    try {
      await verifySafeTestDatabaseConnection(client.sql, target, developmentUrl);
    } catch (error) {
      await client.close();
      throw error;
    }
    await client.sql`truncate table households restart identity cascade`;
    await initializeDefaultLedger(client.db);
  });

  afterAll(async () => {
    await client?.close();
  });

  it('replays a repeated Idempotency-Key without adding rows', async () => {
    const category = await expenseCategoryName(client);
    const input = {
      idempotencyKey: 'agent-run-1',
      transactions: [
        {
          type: 'expense' as const,
          amount: 480,
          occurredOn: `${MONTH}-03`,
          category,
          memo: '昼食',
        },
      ],
    };

    const first = await ingestApiBatch(client.db, HOUSEHOLD_ID, input);
    expect(first.status).toBe('ok');
    expect(first.created).toBe(1);

    const second = await ingestApiBatch(client.db, HOUSEHOLD_ID, input);
    expect(second).toMatchObject({ status: 'replayed', batchId: first.batchId, created: 0 });
    expect(await transactionCount(client)).toBe(1);
    const batches = await client.db.select({ id: apiBatches.id }).from(apiBatches);
    expect(batches).toHaveLength(1);
  });

  it('keeps identical rows without externalId apart and skips them on resend', async () => {
    const category = await expenseCategoryName(client);
    const row = {
      type: 'expense' as const,
      amount: 150,
      occurredOn: `${MONTH}-04`,
      category,
      memo: 'コーヒー',
    };

    const first = await ingestApiBatch(client.db, HOUSEHOLD_ID, { transactions: [row, row] });
    expect(statuses(first.rows)).toEqual(['created', 'created']);
    expect(await transactionCount(client)).toBe(2);

    const resent = await ingestApiBatch(client.db, HOUSEHOLD_ID, { transactions: [row, row] });
    expect(resent).toMatchObject({ status: 'ok', created: 0, skipped: 2 });
    expect(statuses(resent.rows)).toEqual(['skipped', 'skipped']);
    expect(await transactionCount(client)).toBe(2);
  });

  it('rejects only the row with an unknown category and hints near names', async () => {
    const category = await expenseCategoryName(client);
    const misspelled = `${category}x`;

    const result = await ingestApiBatch(client.db, HOUSEHOLD_ID, {
      transactions: [
        { type: 'expense', amount: 300, occurredOn: `${MONTH}-05`, category },
        { type: 'expense', amount: 400, occurredOn: `${MONTH}-05`, category: misspelled },
        { type: 'expense', amount: 500, occurredOn: `${MONTH}-05`, category },
      ],
    });

    expect(result).toMatchObject({ status: 'ok', created: 2, errors: 1 });
    expect(statuses(result.rows)).toEqual(['created', 'error', 'created']);
    const error = result.rows[1];
    expect(error).toMatchObject({ status: 'error', code: 'unknown_category', field: 'category' });
    expect(error?.status === 'error' ? error.hint : undefined).toContain(category);
    expect(await transactionCount(client)).toBe(2);
  });

  it('does not consume the Idempotency-Key when every row is rejected', async () => {
    const category = await expenseCategoryName(client);
    const key = 'agent-run-typo';
    const row = { type: 'expense' as const, amount: 700, occurredOn: `${MONTH}-06` };

    const rejected = await ingestApiBatch(client.db, HOUSEHOLD_ID, {
      idempotencyKey: key,
      transactions: [{ ...row, category: `${category}x` }],
    });
    expect(rejected).toMatchObject({ status: 'ok', created: 0, errors: 1 });
    expect(rejected.batchId).toBeUndefined();

    const corrected = await ingestApiBatch(client.db, HOUSEHOLD_ID, {
      idempotencyKey: key,
      transactions: [{ ...row, category }],
    });
    expect(corrected).toMatchObject({ status: 'ok', created: 1 });
    expect(await transactionCount(client)).toBe(1);
  });

  it('stamps created transactions as api rows visible to the origin filter', async () => {
    const category = await expenseCategoryName(client);
    const accountId = await createBankAccount(client, 'API銀行');
    await client.db.insert(transactions).values({
      householdId: HOUSEHOLD_ID,
      type: 'expense',
      amount: 999,
      occurredOn: `${MONTH}-07`,
      categoryId: (await listCategories(client.db, HOUSEHOLD_ID)).find(
        (row) => row.name === category && row.type === 'expense',
      )!.id,
      memo: '手入力',
    });

    const result = await ingestApiBatch(client.db, HOUSEHOLD_ID, {
      transactions: [
        {
          type: 'expense',
          amount: 1200,
          occurredOn: `${MONTH}-08`,
          category,
          account: 'api銀行',
          externalId: 'receipt-42',
        },
      ],
    });
    const created = result.rows[0];
    if (created?.status !== 'created') throw new Error('expected a created row');

    const stored = await client.db
      .select({
        origin: transactions.origin,
        externalId: transactions.externalId,
        apiBatchId: transactions.apiBatchId,
        accountId: transactions.accountId,
      })
      .from(transactions)
      .where(eq(transactions.id, created.id));
    expect(stored[0]).toEqual({
      origin: 'api',
      externalId: 'receipt-42',
      apiBatchId: result.batchId,
      accountId,
    });

    const apiOnly = await listLedgerEntries(client.db, HOUSEHOLD_ID, {
      month: MONTH,
      origin: 'api',
    });
    expect(apiOnly.map((entry) => entry.id)).toEqual([created.id]);
    expect(apiOnly[0]?.origin).toBe('api');
    const all = await listLedgerEntries(client.db, HOUSEHOLD_ID, { month: MONTH });
    expect(all).toHaveLength(2);
  });

  it('stamps created transfers with the api origin and batch', async () => {
    const fromId = await createBankAccount(client, '振替元銀行');
    const toId = await createBankAccount(client, '振替先銀行');

    const result = await ingestApiBatch(client.db, HOUSEHOLD_ID, {
      transfers: [
        { amount: 5000, occurredOn: `${MONTH}-10`, from: '振替元銀行', to: '振替先銀行' },
      ],
    });
    const created = result.rows[0];
    if (created?.status !== 'created') throw new Error('expected a created transfer');
    expect(result.batchId).toBeTypeOf('number');

    const stored = await client.db
      .select({
        origin: transfers.origin,
        apiBatchId: transfers.apiBatchId,
        fromAccountId: transfers.fromAccountId,
        toAccountId: transfers.toAccountId,
      })
      .from(transfers)
      .where(eq(transfers.id, created.id));
    expect(stored[0]).toEqual({
      origin: 'api',
      apiBatchId: result.batchId,
      fromAccountId: fromId,
      toAccountId: toId,
    });
    const apiOnly = await listLedgerEntries(client.db, HOUSEHOLD_ID, {
      month: MONTH,
      type: 'transfer',
      origin: 'api',
    });
    expect(apiOnly.map((entry) => entry.id)).toEqual([created.id]);
  });
});
