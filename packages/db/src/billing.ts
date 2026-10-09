import { and, asc, eq, isNull, or } from 'drizzle-orm';

import { AMOUNT_LIMIT } from './amount.js';
import {
  deriveBillingPeriod,
  type BillingMonthOffset,
  type BillingPeriodWindow,
} from './billing-calendar.js';
import type { Database } from './client.js';
import { currentTokyoDate } from './month.js';
import {
  accountCardSettings,
  accounts,
  cardAutoPaymentRuns,
  transactions,
  transfers,
  type AccountCardSetting,
  type CardPaymentMonthOffset,
  type TransactionType,
} from './schema.js';
import { lockCardSettingsForAccounts, lockHousehold, type LedgerExecutor } from './ledger.js';
import { isValidCardBillingSchedule } from './validation.js';
export type CardBillingPeriodStatus = 'unbilled' | 'billed-unpaid' | 'overdue' | 'paid';
export type CardBillingCalendarError = 'unsupported_range' | 'invalid_schedule';

export interface CardBillingTransactionInput {
  id?: number;
  type: TransactionType;
  amount: number | string | bigint;
  occurredOn: string;
}

export interface CardBillingTransferInput {
  id?: number;
  fromAccountId: number;
  toAccountId: number;
  amount: number | string | bigint;
  occurredOn: string;
}

export interface CardBillingSettings {
  closingDay: string | null;
  paymentDay: string | null;
  paymentMonthOffset: CardPaymentMonthOffset | null;
  debitAccountId: number | null;
  autoPaymentStartsOn: string;
}

export interface CardBillingPeriod {
  periodStart: string;
  periodEnd: string;
  dueOn: string;
  charge: string;
  paid: string;
  remaining: string;
  status: CardBillingPeriodStatus;
}

export interface CardBillingNextPayment {
  dueOn: string;
  amount: string;
  periodStart: string;
  periodEnd: string;
}

export interface CardAutoPaymentNotice {
  dueOn: string;
  reason: string | null;
}

export interface CardBillingSummary {
  accountId: number;
  accountName: string;
  settings: CardBillingSettings | null;
  settingsComplete: boolean;
  calendarError: CardBillingCalendarError | null;
  liability: string;
  periods: CardBillingPeriod[];
  nextPayment: CardBillingNextPayment | null;
  blockedAutoPayments: CardAutoPaymentNotice[];
}

export interface CardBalancePaymentSchedule {
  scheduledAmount: string;
  scheduledDueOn: string | null;
  unbilledAmount: string;
}

function positiveRemaining(period: CardBillingPeriod): bigint {
  const remaining = BigInt(period.remaining);
  return remaining > 0n ? remaining : 0n;
}

export function deriveCardBalancePaymentSchedule(
  periods: readonly CardBillingPeriod[],
  today: string,
): CardBalancePaymentSchedule {
  let scheduledAmount = 0n;
  let unbilledAmount = 0n;
  let scheduledDueOn: string | null = null;
  for (const period of periods) {
    const remaining = positiveRemaining(period);
    if (period.status === 'unbilled' && period.periodStart <= today && today <= period.periodEnd) {
      unbilledAmount += remaining;
      continue;
    }
    if (period.status !== 'billed-unpaid' && period.status !== 'overdue') continue;
    scheduledAmount += remaining;
    if (remaining > 0n && (scheduledDueOn === null || period.dueOn < scheduledDueOn)) {
      scheduledDueOn = period.dueOn;
    }
  }
  return {
    scheduledAmount: scheduledAmount.toString(),
    scheduledDueOn,
    unbilledAmount: unbilledAmount.toString(),
  };
}

export function aggregateBankPaymentSchedules(
  summaries: readonly CardBillingSummary[],
  currentMonth: string,
): ReadonlyMap<number, bigint> {
  const amounts = new Map<number, bigint>();
  for (const summary of summaries) {
    if (!summary.settingsComplete || summary.calendarError !== null) continue;
    const debitAccountId = summary.settings?.debitAccountId;
    if (debitAccountId === null || debitAccountId === undefined) continue;
    let amount = 0n;
    for (const period of summary.periods) {
      if (
        period.dueOn.startsWith(`${currentMonth}-`) &&
        (period.status === 'billed-unpaid' || period.status === 'overdue')
      ) {
        amount += positiveRemaining(period);
      }
    }
    amounts.set(debitAccountId, (amounts.get(debitAccountId) ?? 0n) + amount);
  }
  return amounts;
}

export interface DerivedCardBilling {
  settingsComplete: boolean;
  periods: CardBillingPeriod[];
  liability: string;
  calendarError: CardBillingCalendarError | null;
}

export interface ProcessDueCardPaymentsResult {
  cards: number;
  completed: number;
  settled: number;
  blocked: number;
  errors: number;
}

interface WorkingPeriod {
  window: BillingPeriodWindow;
  charge: bigint;
}

interface CardBillingRows {
  transactions: CardBillingTransactionInput[];
  transfers: CardBillingTransferInput[];
}

function amountAsBigInt(amount: number | string | bigint): bigint {
  return typeof amount === 'bigint' ? amount : BigInt(amount);
}

function settingsComplete(settings: CardBillingSettings | null): settings is CardBillingSettings & {
  closingDay: string;
  paymentDay: string;
  paymentMonthOffset: BillingMonthOffset;
} {
  return (
    settings !== null &&
    settings.closingDay !== null &&
    settings.paymentDay !== null &&
    settings.paymentMonthOffset !== null
  );
}

function settingsFromRow(row: AccountCardSetting): CardBillingSettings {
  return {
    closingDay: row.closingDay,
    paymentDay: row.paymentDay,
    paymentMonthOffset: row.paymentMonthOffset,
    debitAccountId: row.debitAccountId,
    autoPaymentStartsOn: row.autoPaymentStartsOn,
  };
}

function liabilityForRows(
  cardAccountId: number,
  cardTransactions: readonly CardBillingTransactionInput[],
  cardTransfers: readonly CardBillingTransferInput[],
): { charges: bigint; credit: bigint; liability: bigint } {
  let charges = 0n;
  for (const row of cardTransactions) {
    const amount = amountAsBigInt(row.amount);
    charges += row.type === 'expense' ? amount : -amount;
  }
  let credit = 0n;
  for (const row of cardTransfers) {
    const amount = amountAsBigInt(row.amount);
    if (row.toAccountId === cardAccountId) credit += amount;
    if (row.fromAccountId === cardAccountId) credit -= amount;
  }
  return { charges, credit, liability: charges - credit };
}

function statusForPeriod(
  periodEnd: string,
  dueOn: string,
  remaining: bigint,
  today: string,
): CardBillingPeriodStatus {
  if (today <= periodEnd) return 'unbilled';
  if (remaining > 0n && today > dueOn) return 'overdue';
  if (remaining > 0n) return 'billed-unpaid';
  return 'paid';
}

function deriveWorkingPeriods(
  settings: CardBillingSettings & {
    closingDay: string;
    paymentDay: string;
    paymentMonthOffset: BillingMonthOffset;
  },
  cardTransactions: readonly CardBillingTransactionInput[],
): { periods: WorkingPeriod[]; calendarError: CardBillingCalendarError | null } {
  if (
    !isValidCardBillingSchedule(
      settings.closingDay,
      settings.paymentDay,
      settings.paymentMonthOffset,
    )
  ) {
    return { periods: [], calendarError: 'invalid_schedule' };
  }
  const byKey = new Map<string, WorkingPeriod>();
  try {
    for (const row of cardTransactions) {
      const window = deriveBillingPeriod(
        row.occurredOn,
        settings.closingDay,
        settings.paymentDay,
        settings.paymentMonthOffset,
      );
      const key = `${window.periodStart}:${window.periodEnd}:${window.dueOn}`;
      const existing = byKey.get(key);
      const charge =
        row.type === 'expense' ? amountAsBigInt(row.amount) : -amountAsBigInt(row.amount);
      if (existing) {
        existing.charge += charge;
      } else {
        byKey.set(key, { window, charge });
      }
    }
  } catch {
    return { periods: [], calendarError: 'unsupported_range' };
  }
  return {
    periods: [...byKey.values()].sort((left, right) =>
      left.window.periodStart.localeCompare(right.window.periodStart),
    ),
    calendarError: null,
  };
}

export function deriveCardBillingPeriods(
  cardAccountId: number,
  settings: CardBillingSettings | null,
  cardTransactions: readonly CardBillingTransactionInput[],
  cardTransfers: readonly CardBillingTransferInput[],
  today: string,
): DerivedCardBilling {
  const { liability } = liabilityForRows(cardAccountId, cardTransactions, cardTransfers);
  if (!settingsComplete(settings)) {
    return {
      settingsComplete: false,
      periods: [],
      liability: liability.toString(),
      calendarError: null,
    };
  }

  const working = deriveWorkingPeriods(settings, cardTransactions);
  if (working.calendarError) {
    return {
      settingsComplete: true,
      periods: [],
      liability: liability.toString(),
      calendarError: working.calendarError,
    };
  }

  let pool = liabilityForRows(cardAccountId, cardTransactions, cardTransfers).credit;
  for (const period of working.periods) {
    if (period.charge < 0n) pool += -period.charge;
  }
  const rows = working.periods.map((period) => ({
    window: period.window,
    charge: period.charge,
    remaining: 0n,
  }));
  for (const row of rows) {
    if (row.charge <= 0n) continue;
    const remaining = row.charge - pool;
    if (remaining >= 0n) {
      row.remaining = remaining;
      pool = 0n;
    } else {
      row.remaining = 0n;
      pool = -remaining;
    }
  }
  if (rows.length > 0 && pool !== 0n) {
    rows[rows.length - 1]!.remaining += -pool;
  }

  const periods = rows.map((row) => {
    const paid = row.charge > 0n ? row.charge - (row.remaining > 0n ? row.remaining : 0n) : 0n;
    return {
      periodStart: row.window.periodStart,
      periodEnd: row.window.periodEnd,
      dueOn: row.window.dueOn,
      charge: row.charge.toString(),
      paid: (paid > 0n ? paid : 0n).toString(),
      remaining: row.remaining.toString(),
      status: statusForPeriod(row.window.periodEnd, row.window.dueOn, row.remaining, today),
    } satisfies CardBillingPeriod;
  });

  return {
    settingsComplete: true,
    periods,
    liability: liability.toString(),
    calendarError: null,
  };
}

async function loadCardBillingRows(
  db: LedgerExecutor,
  householdId: string,
  cardAccountId: number,
): Promise<CardBillingRows> {
  const [transactionRows, transferRows] = await Promise.all([
    db
      .select({
        id: transactions.id,
        type: transactions.type,
        amount: transactions.amount,
        occurredOn: transactions.occurredOn,
      })
      .from(transactions)
      .where(
        and(eq(transactions.householdId, householdId), eq(transactions.accountId, cardAccountId)),
      )
      .orderBy(asc(transactions.occurredOn), asc(transactions.id)),
    db
      .select({
        id: transfers.id,
        fromAccountId: transfers.fromAccountId,
        toAccountId: transfers.toAccountId,
        amount: transfers.amount,
        occurredOn: transfers.occurredOn,
      })
      .from(transfers)
      .where(
        and(
          eq(transfers.householdId, householdId),
          or(eq(transfers.fromAccountId, cardAccountId), eq(transfers.toAccountId, cardAccountId)),
        ),
      )
      .orderBy(asc(transfers.occurredOn), asc(transfers.id)),
  ]);
  return { transactions: transactionRows, transfers: transferRows };
}

function nextPayment(periods: readonly CardBillingPeriod[]): CardBillingNextPayment | null {
  const candidate = periods
    .filter(
      (period) =>
        (period.status === 'billed-unpaid' || period.status === 'overdue') &&
        BigInt(period.remaining) > 0n,
    )
    .sort(
      (left, right) =>
        left.dueOn.localeCompare(right.dueOn) || left.periodStart.localeCompare(right.periodStart),
    )[0];
  return candidate
    ? {
        dueOn: candidate.dueOn,
        amount: candidate.remaining,
        periodStart: candidate.periodStart,
        periodEnd: candidate.periodEnd,
      }
    : null;
}

export async function getCardBillingSummary(
  db: Database,
  householdId: string,
  accountId: number,
  today = currentTokyoDate(),
): Promise<CardBillingSummary | null> {
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name, kind: accounts.kind })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)))
    .limit(1);
  const account = accountRows[0];
  if (!account || account.kind !== 'credit_card') return null;

  const [settingRows, rows, blockedRuns] = await Promise.all([
    db
      .select()
      .from(accountCardSettings)
      .where(
        and(
          eq(accountCardSettings.householdId, householdId),
          eq(accountCardSettings.accountId, accountId),
        ),
      )
      .limit(1),
    loadCardBillingRows(db, householdId, accountId),
    db
      .select({ dueOn: cardAutoPaymentRuns.dueOn, reason: cardAutoPaymentRuns.reason })
      .from(cardAutoPaymentRuns)
      .where(
        and(
          eq(cardAutoPaymentRuns.householdId, householdId),
          eq(cardAutoPaymentRuns.cardAccountId, accountId),
          eq(cardAutoPaymentRuns.status, 'blocked'),
        ),
      )
      .orderBy(asc(cardAutoPaymentRuns.dueOn)),
  ]);
  const settings = settingRows[0] ? settingsFromRow(settingRows[0]) : null;
  const derived = deriveCardBillingPeriods(
    accountId,
    settings,
    rows.transactions,
    rows.transfers,
    today,
  );
  return {
    accountId,
    accountName: account.name,
    settings,
    settingsComplete: derived.settingsComplete,
    calendarError: derived.calendarError,
    liability: derived.liability,
    periods: derived.periods,
    nextPayment: derived.calendarError ? null : nextPayment(derived.periods),
    blockedAutoPayments: derived.calendarError ? [] : blockedRuns,
  };
}

export async function getCardBillingSummaries(
  db: Database,
  householdId: string,
  accountIds: readonly number[],
  today = currentTokyoDate(),
): Promise<CardBillingSummary[]> {
  const summaries = await Promise.all(
    accountIds.map((accountId) => getCardBillingSummary(db, householdId, accountId, today)),
  );
  return summaries.filter((summary): summary is CardBillingSummary => summary !== null);
}

async function upsertAutoPaymentRun(
  transaction: LedgerExecutor,
  householdId: string,
  cardAccountId: number,
  dueOn: string,
  status: 'completed' | 'settled' | 'blocked',
  transferId: number | null,
  reason: string | null,
): Promise<void> {
  await transaction
    .insert(cardAutoPaymentRuns)
    .values({
      householdId,
      cardAccountId,
      dueOn,
      status,
      transferId,
      reason,
    })
    .onConflictDoUpdate({
      target: [
        cardAutoPaymentRuns.householdId,
        cardAutoPaymentRuns.cardAccountId,
        cardAutoPaymentRuns.dueOn,
      ],
      set: {
        status,
        transferId,
        reason,
        updatedAt: new Date(),
      },
    });
}

function dueAmount(periods: readonly CardBillingPeriod[], dueOn: string): bigint {
  return periods
    .filter((period) => period.dueOn === dueOn)
    .reduce((total, period) => {
      const remaining = BigInt(period.remaining);
      return total + (remaining > 0n ? remaining : 0n);
    }, 0n);
}

async function processCardDuePayments(
  db: Database,
  householdId: string,
  cardAccountId: number,
  today: string,
): Promise<Pick<ProcessDueCardPaymentsResult, 'completed' | 'settled' | 'blocked'>> {
  return db.transaction(async (transaction) => {
    await lockHousehold(transaction, householdId);

    // The settings row is the same lock used by account mutations, imports, and
    // manual transfers. This serializes a due payment with edits/deletes.
    await lockCardSettingsForAccounts(transaction, householdId, [cardAccountId]);
    const settingRows = await transaction
      .select()
      .from(accountCardSettings)
      .where(
        and(
          eq(accountCardSettings.householdId, householdId),
          eq(accountCardSettings.accountId, cardAccountId),
        ),
      )
      .for('update')
      .limit(1);
    const setting = settingRows[0];
    if (!setting) return { completed: 0, settled: 0, blocked: 0 };

    const accountRows = await transaction
      .select({
        id: accounts.id,
        kind: accounts.kind,
        status: accounts.status,
        deletedAt: accounts.deletedAt,
      })
      .from(accounts)
      .where(and(eq(accounts.id, cardAccountId), eq(accounts.householdId, householdId)))
      .for('update')
      .limit(1);
    const card = accountRows[0];
    if (
      !card ||
      card.kind !== 'credit_card' ||
      card.status !== 'active' ||
      card.deletedAt !== null
    ) {
      return { completed: 0, settled: 0, blocked: 0 };
    }

    let completed = 0;
    let settled = 0;
    let blocked = 0;
    const settingView = settingsFromRow(setting);
    const initialRows = await loadCardBillingRows(transaction, householdId, cardAccountId);
    const initialDerived = deriveCardBillingPeriods(
      cardAccountId,
      settingView,
      initialRows.transactions,
      initialRows.transfers,
      today,
    );
    if (!initialDerived.settingsComplete || initialDerived.calendarError) {
      return { completed, settled, blocked };
    }

    // The migration stamps legacy settings with the deployment date, while
    // settings created by the asset form stamp their creation date. Updating
    // closing/payment/debit fields preserves this boundary, so a deployment
    // or settings edit never bulk-creates payments for earlier due dates.
    const effectiveFrom = setting.autoPaymentStartsOn;
    const dueDates = [
      ...new Set(
        initialDerived.periods
          .map((period) => period.dueOn)
          .filter((dueOn) => dueOn >= effectiveFrom && dueOn <= today),
      ),
    ].sort();

    for (const dueOn of dueDates) {
      const runRows = await transaction
        .select({ status: cardAutoPaymentRuns.status })
        .from(cardAutoPaymentRuns)
        .where(
          and(
            eq(cardAutoPaymentRuns.householdId, householdId),
            eq(cardAutoPaymentRuns.cardAccountId, cardAccountId),
            eq(cardAutoPaymentRuns.dueOn, dueOn),
          ),
        )
        .for('update')
        .limit(1);
      const existingRun = runRows[0];
      // A completed run remains authoritative even if its transfer is edited
      // or deleted from the normal transfer UI; do not create a surprise
      // replacement on the next worker tick.
      if (existingRun?.status === 'completed' || existingRun?.status === 'settled') continue;

      const rows = await loadCardBillingRows(transaction, householdId, cardAccountId);
      const derived = deriveCardBillingPeriods(
        cardAccountId,
        settingView,
        rows.transactions,
        rows.transfers,
        today,
      );
      const amount = dueAmount(derived.periods, dueOn);
      if (amount <= 0n) {
        await upsertAutoPaymentRun(
          transaction,
          householdId,
          cardAccountId,
          dueOn,
          'settled',
          null,
          null,
        );
        settled += 1;
        continue;
      }

      const debitAccountId = setting.debitAccountId;
      const debitRows = debitAccountId
        ? await transaction
            .select({
              id: accounts.id,
              kind: accounts.kind,
              status: accounts.status,
              deletedAt: accounts.deletedAt,
            })
            .from(accounts)
            .where(and(eq(accounts.id, debitAccountId), eq(accounts.householdId, householdId)))
            .limit(1)
        : [];
      const debit = debitRows[0];
      if (
        !debit ||
        debit.deletedAt !== null ||
        debit.status !== 'active' ||
        debit.kind !== 'bank'
      ) {
        await upsertAutoPaymentRun(
          transaction,
          householdId,
          cardAccountId,
          dueOn,
          'blocked',
          null,
          '引落銀行口座を設定してください。',
        );
        blocked += 1;
        continue;
      }
      if (amount > BigInt(AMOUNT_LIMIT)) {
        await upsertAutoPaymentRun(
          transaction,
          householdId,
          cardAccountId,
          dueOn,
          'blocked',
          null,
          '支払額が上限を超えています。',
        );
        blocked += 1;
        continue;
      }

      // Transfers are intentionally allowed to overdraw the bank account. A
      // normal ledger transfer updates both account balances without creating a
      // second expense.
      const inserted = await transaction
        .insert(transfers)
        .values({
          householdId,
          fromAccountId: debit.id,
          toAccountId: cardAccountId,
          amount: Number(amount),
          occurredOn: dueOn,
          memo: '自動引落',
        })
        .returning({ id: transfers.id });
      const transfer = inserted[0];
      if (!transfer) throw new Error('Auto payment transfer insert returned no row');
      await upsertAutoPaymentRun(
        transaction,
        householdId,
        cardAccountId,
        dueOn,
        'completed',
        transfer.id,
        null,
      );
      completed += 1;
    }
    return { completed, settled, blocked };
  });
}

export async function processDueCardPayments(
  db: Database,
  today = currentTokyoDate(),
): Promise<ProcessDueCardPaymentsResult> {
  const cards = await db
    .select({ householdId: accounts.householdId, accountId: accounts.id })
    .from(accounts)
    .innerJoin(
      accountCardSettings,
      and(
        eq(accountCardSettings.householdId, accounts.householdId),
        eq(accountCardSettings.accountId, accounts.id),
      ),
    )
    .where(and(eq(accounts.kind, 'credit_card'), isNull(accounts.deletedAt)));
  const result: ProcessDueCardPaymentsResult = {
    cards: cards.length,
    completed: 0,
    settled: 0,
    blocked: 0,
    errors: 0,
  };
  for (const card of cards) {
    try {
      const cardResult = await processCardDuePayments(db, card.householdId, card.accountId, today);
      result.completed += cardResult.completed;
      result.settled += cardResult.settled;
      result.blocked += cardResult.blocked;
    } catch (error) {
      result.errors += 1;
      console.error('[billing/processDueCardPayments] card failed', {
        householdId: card.householdId,
        cardAccountId: card.accountId,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }
  return result;
}
