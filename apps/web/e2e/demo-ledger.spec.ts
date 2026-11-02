import { expect, test } from '@playwright/test';
import {
  assertSafeTestDatabaseTarget,
  createDatabaseClient,
  currentTokyoDate,
  deleteHousehold,
  deriveCardBalancePaymentSchedule,
  getAccountBalances,
  getCardBillingSummary,
  initializeDefaultLedger,
  verifySafeTestDatabaseConnection,
  type DatabaseClient,
} from '@kobako/db';
import { seedDemoLedger } from '../src/lib/demo-ledger';

test.describe.configure({ mode: 'serial' });

let databaseClient: DatabaseClient | undefined;

test.beforeAll(async () => {
  const safeTestDatabase = assertSafeTestDatabaseTarget();
  databaseClient = createDatabaseClient(safeTestDatabase.url);
  try {
    await verifySafeTestDatabaseConnection(
      databaseClient.sql,
      safeTestDatabase.target,
      process.env.DATABASE_URL,
    );
  } catch (error) {
    await databaseClient.close();
    databaseClient = undefined;
    throw error;
  }
});

test.afterAll(async () => {
  await databaseClient?.close();
  databaseClient = undefined;
});

test('シード結果に口座残高とカード請求の紐付けが反映される', async () => {
  if (!databaseClient) throw new Error('demo ledger E2E database is not initialized');

  const householdId = crypto.randomUUID();
  try {
    await initializeDefaultLedger(databaseClient.db, {
      id: householdId,
      slug: `demo-e2e-${householdId.slice(0, 8)}`,
      name: 'デモE2E',
    });
    await seedDemoLedger(databaseClient, { householdId });

    const balances = await getAccountBalances(databaseClient.db, householdId);
    const balanceByName = Object.fromEntries(
      balances.map((balance) => [balance.accountName, balance.balance]),
    );
    expect(balanceByName).toEqual({
      給与口座: '444000',
      生活費口座: '94700',
      現金: '13500',
      クレジットカード: '-128600',
    });
    expect(
      balances
        .filter((balance) => balance.accountName !== 'クレジットカード')
        .every((balance) => BigInt(balance.balance) >= 0n),
    ).toBe(true);

    const [card] = await databaseClient.sql<{ id: number }[]>`
      select id from accounts
      where household_id = ${householdId} and name = 'クレジットカード'
    `;
    if (!card) throw new Error('demo card account was not seeded');

    const settings = await databaseClient.sql<
      {
        closing_day: string;
        payment_day: string;
        payment_month_offset: string;
        debit_account_id: number;
        auto_payment_starts_on: string;
      }[]
    >`
      select closing_day, payment_day, payment_month_offset, debit_account_id, auto_payment_starts_on
      from account_card_settings
      where household_id = ${householdId} and account_id = ${card.id}
    `;
    expect(settings).toHaveLength(1);
    expect(settings[0]).toMatchObject({
      closing_day: 'last',
      payment_day: '27',
      payment_month_offset: 'next_month',
      debit_account_id: balances.find((balance) => balance.accountName === '生活費口座')?.accountId,
    });
    expect(settings[0]?.auto_payment_starts_on).toMatch(/^\d{4}-\d{2}-01$/);

    const runs = await databaseClient.sql<
      {
        status: string;
        due_on: string;
        transfer_id: number;
        amount: number;
        from_account_id: number;
        to_account_id: number;
        memo: string;
      }[]
    >`
      select r.status, r.due_on, r.transfer_id, t.amount, t.from_account_id, t.to_account_id, t.memo
      from card_auto_payment_runs r
      join transfers t on t.id = r.transfer_id
      where r.household_id = ${householdId} and r.card_account_id = ${card.id}
    `;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: 'completed',
      amount: 64300,
      from_account_id: settings[0]?.debit_account_id,
      to_account_id: card.id,
      memo: '自動引落',
    });
    expect(runs[0]?.due_on).toMatch(/^\d{4}-\d{2}-27$/);
    expect(runs[0]?.transfer_id).toBeGreaterThan(0);

    const summary = await getCardBillingSummary(
      databaseClient.db,
      householdId,
      card.id,
      currentTokyoDate(),
    );
    if (!summary) throw new Error('demo card billing summary was not returned');
    const schedule = deriveCardBalancePaymentSchedule(summary.periods, currentTokyoDate());
    expect(schedule).toMatchObject({
      scheduledAmount: '64300',
      unbilledAmount: '64300',
      scheduledDueOn: expect.stringMatching(/^\d{4}-\d{2}-27$/),
    });
    expect(summary.nextPayment).toMatchObject({ amount: '64300' });
  } finally {
    await deleteHousehold(databaseClient.db, householdId);
  }
});
