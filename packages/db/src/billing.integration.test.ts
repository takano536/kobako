import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_HOUSEHOLD_ID,
  createAccount,
  createTransaction,
  createTransfer,
  getCardBillingSummary,
  getExpenseCategoryTotals,
  getMonthlyTotals,
  initializeDefaultLedger,
  processDueCardPayments,
  updateAccount,
  type DatabaseClient,
} from '@kobako/db';
import { createDatabaseClient } from './client.js';
import {
  assertSafeTestDatabaseTarget,
  verifySafeTestDatabaseConnection,
  type DatabaseTarget,
} from './database-safety.js';
import { runMigrations } from './migrate.js';
import { listCategories } from './ledger.js';
import { accountCardSettings, accounts, cardAutoPaymentRuns, transfers } from './schema.js';
import type { AccountCardConditionInput } from './validation.js';

interface CardFixture {
  cardId: number;
  debitId: number;
  expenseCategoryId: number;
  incomeCategoryId: number;
}

const HOUSEHOLD_ID = DEFAULT_HOUSEHOLD_ID;

async function createConfiguredCard(
  client: DatabaseClient,
  condition: AccountCardConditionInput = {
    closingDay: '15',
    paymentDay: '10',
    paymentMonthOffset: 'next_month',
    debitAccountId: undefined,
  },
): Promise<CardFixture> {
  const cardResult = await createAccount(client.db, HOUSEHOLD_ID, {
    name: 'テストカード',
    kind: 'credit_card',
  });
  const debitResult = await createAccount(client.db, HOUSEHOLD_ID, {
    name: '引落銀行',
    kind: 'bank',
  });
  if (cardResult.status !== 'ok' || debitResult.status !== 'ok') {
    throw new Error('failed to create billing fixtures');
  }
  const cardCondition = {
    ...condition,
    debitAccountId:
      condition.debitAccountId === undefined ? debitResult.account.id : condition.debitAccountId,
  };
  const updateResult = await updateAccount(
    client.db,
    HOUSEHOLD_ID,
    cardResult.account.id,
    {
      name: cardResult.account.name,
      kind: 'credit_card',
      expectedKind: 'credit_card',
      confirmKindChange: false,
    },
    cardCondition,
  );
  if (updateResult.status !== 'ok') {
    throw new Error(`failed to save billing settings: ${updateResult.status}`);
  }
  const categories = await listCategories(client.db, HOUSEHOLD_ID);
  const expenseCategory = categories.find((category) => category.type === 'expense');
  const incomeCategory = categories.find((category) => category.type === 'income');
  if (!expenseCategory || !incomeCategory) throw new Error('billing categories are missing');
  return {
    cardId: cardResult.account.id,
    debitId: debitResult.account.id,
    expenseCategoryId: expenseCategory.id,
    incomeCategoryId: incomeCategory.id,
  };
}

async function enableAutoPayment(client: DatabaseClient, cardId: number, enabledOn = '2026-01-01') {
  await client.db
    .update(accountCardSettings)
    .set({ autoPaymentEnabled: true, autoPaymentEnabledOn: enabledOn })
    .where(
      and(
        eq(accountCardSettings.householdId, HOUSEHOLD_ID),
        eq(accountCardSettings.accountId, cardId),
      ),
    );
}

async function addExpense(
  client: DatabaseClient,
  fixture: CardFixture,
  occurredOn: string,
  amount: number,
) {
  return createTransaction(client.db, HOUSEHOLD_ID, {
    type: 'expense',
    amount,
    occurredOn,
    categoryId: fixture.expenseCategoryId,
    accountId: fixture.cardId,
    memo: '',
  });
}

async function addIncome(
  client: DatabaseClient,
  fixture: CardFixture,
  occurredOn: string,
  amount: number,
) {
  return createTransaction(client.db, HOUSEHOLD_ID, {
    type: 'income',
    amount,
    occurredOn,
    categoryId: fixture.incomeCategoryId,
    accountId: fixture.cardId,
    memo: '',
  });
}

async function addTransfer(
  client: DatabaseClient,
  fromAccountId: number,
  toAccountId: number,
  occurredOn: string,
  amount: number,
) {
  const result = await createTransfer(client.db, HOUSEHOLD_ID, {
    fromAccountId,
    toAccountId,
    occurredOn,
    amount,
    memo: '',
  });
  if (result.status !== 'ok') throw new Error(`failed to create transfer: ${result.status}`);
  return result.transfer;
}

async function cardTransferRows(client: DatabaseClient, cardId: number) {
  return client.db
    .select({
      id: transfers.id,
      fromAccountId: transfers.fromAccountId,
      toAccountId: transfers.toAccountId,
      amount: transfers.amount,
    })
    .from(transfers)
    .where(eq(transfers.toAccountId, cardId));
}

describe('derived card billing worker', () => {
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
    await client.sql`truncate table households restart identity cascade`;
    await initializeDefaultLedger(client.db);
  });

  afterAll(async () => {
    await client?.close();
  });

  it('keeps auto payment off by default and does not create a run', async () => {
    const fixture = await createConfiguredCard(client);
    await addExpense(client, fixture, '2026-01-10', 100);
    const result = await processDueCardPayments(client.db, '2026-03-01');
    expect(result.completed).toBe(0);
    expect(await cardTransferRows(client, fixture.cardId)).toEqual([]);
  });

  it('skips a card that is no longer active without creating an auto-payment run', async () => {
    const fixture = await createConfiguredCard(client);
    await addExpense(client, fixture, '2026-01-10', 100);
    await enableAutoPayment(client, fixture.cardId);
    await client.db
      .update(accounts)
      .set({ status: 'closed' })
      .where(and(eq(accounts.householdId, HOUSEHOLD_ID), eq(accounts.id, fixture.cardId)));

    const result = await processDueCardPayments(client.db, '2026-03-01');
    expect(result).toEqual({
      cards: 1,
      completed: 0,
      settled: 0,
      blocked: 0,
      errors: 0,
    });
    expect(await cardTransferRows(client, fixture.cardId)).toEqual([]);
    expect(
      await client.db
        .select()
        .from(cardAutoPaymentRuns)
        .where(
          and(
            eq(cardAutoPaymentRuns.householdId, HOUSEHOLD_ID),
            eq(cardAutoPaymentRuns.cardAccountId, fixture.cardId),
          ),
        ),
    ).toEqual([]);
  });

  it('hides unsupported billing periods and skips the worker', async () => {
    const fixture = await createConfiguredCard(client, {
      closingDay: '31',
      paymentDay: '10',
      paymentMonthOffset: 'next_month',
    });
    await addExpense(client, fixture, '9998-12-31', 100);
    await enableAutoPayment(client, fixture.cardId, '9998-01-01');

    const summary = await getCardBillingSummary(
      client.db,
      HOUSEHOLD_ID,
      fixture.cardId,
      '9998-12-31',
    );
    expect(summary).toEqual(
      expect.objectContaining({
        calendarError: 'unsupported_range',
        liability: '100',
        periods: [],
        nextPayment: null,
        blockedAutoPayments: [],
      }),
    );

    const result = await processDueCardPayments(client.db, '9998-12-31');
    expect(result).toEqual({
      cards: 1,
      completed: 0,
      settled: 0,
      blocked: 0,
      errors: 0,
    });
    expect(await cardTransferRows(client, fixture.cardId)).toEqual([]);
  });

  it('hides an invalid stored same-month schedule and skips the worker', async () => {
    const fixture = await createConfiguredCard(client);
    await addExpense(client, fixture, '2026-01-10', 100);
    await enableAutoPayment(client, fixture.cardId);
    await client.db
      .update(accountCardSettings)
      .set({ closingDay: '30', paymentDay: '31', paymentMonthOffset: 'same_month' })
      .where(
        and(
          eq(accountCardSettings.householdId, HOUSEHOLD_ID),
          eq(accountCardSettings.accountId, fixture.cardId),
        ),
      );

    const summary = await getCardBillingSummary(
      client.db,
      HOUSEHOLD_ID,
      fixture.cardId,
      '2026-02-01',
    );
    expect(summary).toEqual(
      expect.objectContaining({
        calendarError: 'invalid_schedule',
        liability: '100',
        periods: [],
        nextPayment: null,
        blockedAutoPayments: [],
      }),
    );
    expect(await processDueCardPayments(client.db, '2026-02-01')).toEqual({
      cards: 1,
      completed: 0,
      settled: 0,
      blocked: 0,
      errors: 0,
    });
    expect(await cardTransferRows(client, fixture.cardId)).toEqual([]);
  });

  it('settles a due period already paid by a manual transfer', async () => {
    const fixture = await createConfiguredCard(client);
    await addExpense(client, fixture, '2026-01-10', 100);
    await enableAutoPayment(client, fixture.cardId);
    await addTransfer(client, fixture.debitId, fixture.cardId, '2026-02-01', 100);
    const result = await processDueCardPayments(client.db, '2026-03-01');
    expect(result.settled).toBe(1);
    expect(await cardTransferRows(client, fixture.cardId)).toHaveLength(1);
    expect(
      await client.sql`select status from card_auto_payment_runs where card_account_id = ${fixture.cardId}`,
    ).toEqual([{ status: 'settled' }]);
  });

  it('auto pays only the remaining amount after a partial manual payment', async () => {
    const fixture = await createConfiguredCard(client);
    await addExpense(client, fixture, '2026-01-10', 100);
    await enableAutoPayment(client, fixture.cardId);
    await addTransfer(client, fixture.debitId, fixture.cardId, '2026-02-01', 40);
    const result = await processDueCardPayments(client.db, '2026-03-01');
    expect(result.completed).toBe(1);
    expect(await cardTransferRows(client, fixture.cardId)).toEqual([
      expect.objectContaining({ amount: 40 }),
      expect.objectContaining({ amount: 60 }),
    ]);
  });

  it('is idempotent when the worker is rerun', async () => {
    const fixture = await createConfiguredCard(client);
    await addExpense(client, fixture, '2026-01-10', 100);
    await enableAutoPayment(client, fixture.cardId);
    await processDueCardPayments(client.db, '2026-03-01');
    const second = await processDueCardPayments(client.db, '2026-03-01');
    expect(second.completed).toBe(0);
    expect(await cardTransferRows(client, fixture.cardId)).toHaveLength(1);
  });

  it('allows concurrent worker calls to create one transfer', async () => {
    const fixture = await createConfiguredCard(client);
    await addExpense(client, fixture, '2026-01-10', 100);
    await enableAutoPayment(client, fixture.cardId);
    await Promise.all([
      processDueCardPayments(client.db, '2026-03-01'),
      processDueCardPayments(client.db, '2026-03-01'),
    ]);
    expect(await cardTransferRows(client, fixture.cardId)).toHaveLength(1);
  });

  it('serializes a manual transfer before auto payment and pays the amount once', async () => {
    const fixture = await createConfiguredCard(client);
    await addExpense(client, fixture, '2026-01-10', 100);
    await enableAutoPayment(client, fixture.cardId);
    const manual = addTransfer(client, fixture.debitId, fixture.cardId, '2026-02-10', 100);
    const worker = processDueCardPayments(client.db, '2026-03-01');
    await Promise.all([manual, worker]);
    const rows = await cardTransferRows(client, fixture.cardId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe(100);
  });

  it('catches up multiple due dates after downtime', async () => {
    const fixture = await createConfiguredCard(client);
    await addExpense(client, fixture, '2026-01-10', 100);
    await addExpense(client, fixture, '2026-02-10', 80);
    await enableAutoPayment(client, fixture.cardId);
    const result = await processDueCardPayments(client.db, '2026-04-01');
    expect(result.completed).toBe(2);
    expect(await cardTransferRows(client, fixture.cardId)).toEqual([
      expect.objectContaining({ amount: 100 }),
      expect.objectContaining({ amount: 80 }),
    ]);
  });

  it('respects the enabled-on boundary', async () => {
    const fixture = await createConfiguredCard(client);
    await addExpense(client, fixture, '2026-01-10', 100);
    await addExpense(client, fixture, '2026-02-10', 80);
    await enableAutoPayment(client, fixture.cardId, '2026-03-01');
    const result = await processDueCardPayments(client.db, '2026-04-01');
    expect(result.completed).toBe(1);
    expect((await cardTransferRows(client, fixture.cardId))[0]?.amount).toBe(80);
  });

  it('blocks a missing debit account, then retries after settings recovery', async () => {
    const fixture = await createConfiguredCard(client, {
      closingDay: '15',
      paymentDay: '10',
      paymentMonthOffset: 'next_month',
      debitAccountId: null,
    });
    await addExpense(client, fixture, '2026-01-10', 100);
    await enableAutoPayment(client, fixture.cardId);
    const blocked = await processDueCardPayments(client.db, '2026-03-01');
    expect(blocked.blocked).toBe(1);
    expect(
      (await getCardBillingSummary(client.db, HOUSEHOLD_ID, fixture.cardId, '2026-03-01'))
        ?.blockedAutoPayments,
    ).toEqual([{ dueOn: '2026-02-10', reason: '引落口座を設定してください。' }]);
    await client.db
      .update(accountCardSettings)
      .set({ debitAccountId: fixture.debitId })
      .where(eq(accountCardSettings.accountId, fixture.cardId));
    const recovered = await processDueCardPayments(client.db, '2026-03-01');
    expect(recovered.completed).toBe(1);
  });

  it('blocks and recovers a deleted debit account and a card debit account', async () => {
    const fixture = await createConfiguredCard(client);
    await addExpense(client, fixture, '2026-01-10', 100);
    await enableAutoPayment(client, fixture.cardId);
    await client.db
      .update(accounts)
      .set({ deletedAt: new Date() })
      .where(eq(accounts.id, fixture.debitId));
    expect((await processDueCardPayments(client.db, '2026-03-01')).blocked).toBe(1);
    await client.db
      .update(accounts)
      .set({ deletedAt: null })
      .where(eq(accounts.id, fixture.debitId));
    expect((await processDueCardPayments(client.db, '2026-03-01')).completed).toBe(1);

    const second = await createConfiguredCard(client);
    await addExpense(client, second, '2026-01-10', 100);
    await enableAutoPayment(client, second.cardId);
    await client.db
      .update(accountCardSettings)
      .set({ debitAccountId: second.cardId })
      .where(eq(accountCardSettings.accountId, second.cardId));
    expect((await processDueCardPayments(client.db, '2026-03-01')).blocked).toBe(1);
  });

  it('keeps payment transfers out of monthly and category expense totals', async () => {
    const fixture = await createConfiguredCard(client);
    await addExpense(client, fixture, '2026-02-10', 100);
    await addTransfer(client, fixture.debitId, fixture.cardId, '2026-02-20', 100);
    const totals = await getMonthlyTotals(client.db, HOUSEHOLD_ID, '2026-02');
    expect(totals.expense).toBe('100');
    const expenseCategory = (await listCategories(client.db, HOUSEHOLD_ID, 'expense'))[0];
    expect(expenseCategory).toBeDefined();
    await expect(getExpenseCategoryTotals(client.db, HOUSEHOLD_ID, '2026-02')).resolves.toEqual([
      {
        categoryId: expenseCategory!.id,
        categoryName: expenseCategory!.name,
        total: '100',
      },
    ]);
  });

  it('includes an income refund in the derived balance', async () => {
    const fixture = await createConfiguredCard(client);
    await addExpense(client, fixture, '2026-01-10', 100);
    await addIncome(client, fixture, '2026-01-12', 25);
    const summary = await getCardBillingSummary(
      client.db,
      HOUSEHOLD_ID,
      fixture.cardId,
      '2026-02-01',
    );
    expect(summary?.liability).toBe('75');
    expect(summary?.periods[0]?.remaining).toBe('75');
  });
});
