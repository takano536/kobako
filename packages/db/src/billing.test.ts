import { describe, expect, it } from 'vitest';

import {
  aggregateBankPaymentSchedules,
  deriveCardBalancePaymentSchedule,
  deriveCardBillingPeriods,
  type CardBillingPeriod,
  type CardBillingSettings,
  type CardBillingSummary,
  type CardBillingTransactionInput,
  type CardBillingTransferInput,
  type DerivedCardBilling,
} from './billing.js';

const CARD_ID = 10;
const settings: CardBillingSettings = {
  closingDay: '15',
  paymentDay: '10',
  paymentMonthOffset: 'next_month',
  debitAccountId: 1,
  autoPaymentStartsOn: '2026-01-01',
};

function expense(occurredOn: string, amount: number): CardBillingTransactionInput {
  return { type: 'expense', amount, occurredOn };
}

function income(occurredOn: string, amount: number): CardBillingTransactionInput {
  return { type: 'income', amount, occurredOn };
}

function transfer(
  fromAccountId: number,
  toAccountId: number,
  amount: number,
  occurredOn: string,
): CardBillingTransferInput {
  return { fromAccountId, toAccountId, amount, occurredOn };
}

function remaining(result: DerivedCardBilling): string[] {
  return result.periods.map((period) => period.remaining);
}

function period(
  status: CardBillingPeriod['status'],
  remainingAmount: string,
  dueOn: string,
  periodStart = '2026-01-01',
  periodEnd = '2026-01-31',
): CardBillingPeriod {
  return {
    periodStart,
    periodEnd,
    dueOn,
    charge: remainingAmount,
    paid: '0',
    remaining: remainingAmount,
    status,
  };
}

function summary(
  accountId: number,
  debitAccountId: number | null,
  periods: CardBillingPeriod[],
): CardBillingSummary {
  return {
    accountId,
    accountName: `カード${accountId}`,
    settings: { ...settings, debitAccountId },
    settingsComplete: true,
    calendarError: null,
    liability: '0',
    periods,
    nextPayment: null,
    blockedAutoPayments: [],
  };
}

describe('balance payment schedules', () => {
  it('splits billed and unbilled remaining amounts and chooses the earliest due date', () => {
    expect(
      deriveCardBalancePaymentSchedule(
        [
          period('billed-unpaid', '30', '2026-02-20'),
          period('overdue', '20', '2026-02-10'),
          period('billed-unpaid', '0', '2026-02-05'),
          period('unbilled', '45', '2026-02-27'),
        ],
        '2026-01-20',
      ),
    ).toEqual({
      scheduledAmount: '50',
      scheduledDueOn: '2026-02-10',
      unbilledAmount: '45',
    });
  });

  it('does not show negative period remaining as a payment schedule after overpayment', () => {
    expect(
      deriveCardBalancePaymentSchedule([period('paid', '-50', '2026-02-10')], '2026-01-20'),
    ).toEqual({
      scheduledAmount: '0',
      scheduledDueOn: null,
      unbilledAmount: '0',
    });
  });
  it('separates a confirmed bill from current usage and excludes future-period usage', () => {
    expect(
      deriveCardBalancePaymentSchedule(
        [
          period('billed-unpaid', '12000', '2026-02-10', '2025-12-16', '2026-01-15'),
          period('unbilled', '3000', '2026-03-10', '2026-01-16', '2026-02-15'),
          period('unbilled', '7000', '2026-04-10', '2026-02-16', '2026-03-15'),
        ],
        '2026-02-01',
      ),
    ).toEqual({
      scheduledAmount: '12000',
      scheduledDueOn: '2026-02-10',
      unbilledAmount: '3000',
    });
  });

  it('keeps scheduled bills unchanged when new usage is added and reduces them on payment', () => {
    const usage = [expense('2026-01-10', 12000), expense('2026-01-20', 3000)];
    const before = deriveCardBillingPeriods(CARD_ID, settings, usage, [], '2026-01-25');
    expect(deriveCardBalancePaymentSchedule(before.periods, '2026-01-25')).toMatchObject({
      scheduledAmount: '12000',
      unbilledAmount: '3000',
    });

    const addedUsage = deriveCardBillingPeriods(
      CARD_ID,
      settings,
      [...usage, expense('2026-01-25', 2000)],
      [],
      '2026-01-25',
    );
    expect(deriveCardBalancePaymentSchedule(addedUsage.periods, '2026-01-25')).toMatchObject({
      scheduledAmount: '12000',
      unbilledAmount: '5000',
    });

    const paid = deriveCardBillingPeriods(
      CARD_ID,
      settings,
      usage,
      [transfer(settings.debitAccountId!, CARD_ID, 5000, '2026-01-25')],
      '2026-01-25',
    );
    expect(deriveCardBalancePaymentSchedule(paid.periods, '2026-01-25')).toMatchObject({
      scheduledAmount: '7000',
      unbilledAmount: '3000',
    });
  });

  it('moves usage at the configured closing boundary without loss or double counting', () => {
    const usage = [expense('2026-01-15', 3000)];
    const dayBefore = deriveCardBillingPeriods(CARD_ID, settings, usage, [], '2026-01-14');
    const closingDay = deriveCardBillingPeriods(CARD_ID, settings, usage, [], '2026-01-15');
    const dayAfter = deriveCardBillingPeriods(CARD_ID, settings, usage, [], '2026-01-16');

    expect(deriveCardBalancePaymentSchedule(dayBefore.periods, '2026-01-14')).toMatchObject({
      scheduledAmount: '0',
      unbilledAmount: '3000',
    });
    expect(deriveCardBalancePaymentSchedule(closingDay.periods, '2026-01-15')).toMatchObject({
      scheduledAmount: '0',
      unbilledAmount: '3000',
    });
    expect(deriveCardBalancePaymentSchedule(dayAfter.periods, '2026-01-16')).toMatchObject({
      scheduledAmount: '3000',
      unbilledAmount: '0',
    });
  });

  it('keeps past overdue charges in the scheduled amount', () => {
    const result = deriveCardBillingPeriods(
      CARD_ID,
      settings,
      [expense('2026-01-10', 80)],
      [],
      '2026-03-01',
    );

    expect(result.periods[0]?.status).toBe('overdue');
    expect(deriveCardBalancePaymentSchedule(result.periods, '2026-03-01')).toEqual({
      scheduledAmount: '80',
      scheduledDueOn: '2026-02-10',
      unbilledAmount: '0',
    });
  });

  it('aggregates same-bank cards with different due dates and excludes other banks, future months, and paid periods', () => {
    const amounts = aggregateBankPaymentSchedules(
      [
        summary(1, 10, [
          period('billed-unpaid', '30', '2026-02-10'),
          period('overdue', '20', '2026-02-20'),
        ]),
        summary(2, 10, [period('billed-unpaid', '25', '2026-03-10')]),
        summary(3, 11, [period('billed-unpaid', '40', '2026-02-10')]),
        summary(4, 11, [period('paid', '0', '2026-02-10')]),
        summary(5, null, [period('billed-unpaid', '99', '2026-02-10')]),
      ],
      '2026-02',
    );
    expect(amounts).toEqual(
      new Map([
        [10, 50n],
        [11, 40n],
      ]),
    );
  });
});

describe('derived card billing FIFO', () => {
  it('returns no periods when closing or payment settings are incomplete', () => {
    const result = deriveCardBillingPeriods(
      CARD_ID,
      { ...settings, paymentDay: null },
      [expense('2026-01-10', 100)],
      [],
      '2026-02-01',
    );
    expect(result.settingsComplete).toBe(false);
    expect(result.periods).toEqual([]);
    expect(result.liability).toBe('100');
  });

  it('rejects same-month schedules whose resolved payment date is not after close', () => {
    const result = deriveCardBillingPeriods(
      CARD_ID,
      {
        ...settings,
        closingDay: '30',
        paymentDay: '31',
        paymentMonthOffset: 'same_month',
      },
      [expense('2026-01-10', 100)],
      [],
      '2026-02-01',
    );
    expect(result).toMatchObject({
      settingsComplete: true,
      calendarError: 'invalid_schedule',
      periods: [],
      liability: '100',
    });
  });

  it('allocates a partial payment to the oldest charge', () => {
    const result = deriveCardBillingPeriods(
      CARD_ID,
      settings,
      [expense('2026-01-10', 100)],
      [transfer(1, CARD_ID, 40, '2026-01-20')],
      '2026-02-01',
    );
    expect(remaining(result)).toEqual(['60']);
    expect(result.periods[0]).toMatchObject({ charge: '100', paid: '40', remaining: '60' });
    expect(result.liability).toBe('60');
  });

  it('reflects payment transfer edits and deletion without any stored link', () => {
    const usage = [expense('2026-01-10', 100)];
    const full = deriveCardBillingPeriods(
      CARD_ID,
      settings,
      usage,
      [transfer(1, CARD_ID, 100, '2026-02-01')],
      '2026-02-02',
    );
    const edited = deriveCardBillingPeriods(
      CARD_ID,
      settings,
      usage,
      [transfer(1, CARD_ID, 70, '2026-02-01')],
      '2026-02-02',
    );
    const deleted = deriveCardBillingPeriods(CARD_ID, settings, usage, [], '2026-02-02');
    expect(remaining(full)).toEqual(['0']);
    expect(remaining(edited)).toEqual(['30']);
    expect(remaining(deleted)).toEqual(['100']);
  });

  it('allocates credits oldest-first across periods and carries overpayment', () => {
    const result = deriveCardBillingPeriods(
      CARD_ID,
      settings,
      [expense('2026-01-10', 100), expense('2026-02-10', 100)],
      [transfer(1, CARD_ID, 150, '2026-03-01')],
      '2026-04-01',
    );
    expect(remaining(result)).toEqual(['0', '50']);
    expect(result.liability).toBe('50');

    const overpaid = deriveCardBillingPeriods(
      CARD_ID,
      settings,
      [expense('2026-01-10', 100)],
      [transfer(1, CARD_ID, 150, '2026-02-01')],
      '2026-03-01',
    );
    expect(remaining(overpaid)).toEqual(['-50']);
    expect(overpaid.liability).toBe('-50');
    expect(overpaid.periods[0]?.status).toBe('paid');
  });

  it('treats refunds as negative charges and preserves the liability identity', () => {
    const result = deriveCardBillingPeriods(
      CARD_ID,
      settings,
      [expense('2026-01-10', 100), income('2026-02-10', 30)],
      [],
      '2026-03-01',
    );
    expect(remaining(result)).toEqual(['70', '0']);
    expect(result.periods[0]?.paid).toBe('30');
  });

  it('uses future-dated ledger rows like the all-time account balance query', () => {
    const result = deriveCardBillingPeriods(
      CARD_ID,
      settings,
      [expense('2027-01-10', 100)],
      [transfer(1, CARD_ID, 40, '2027-02-01')],
      '2026-01-01',
    );
    expect(result.liability).toBe('60');
    expect(result.periods[0]?.status).toBe('unbilled');
  });

  it('keeps all period remainings equal to card liability', () => {
    const result = deriveCardBillingPeriods(
      CARD_ID,
      settings,
      [expense('2026-01-01', 100), income('2026-01-20', 20), expense('2026-02-01', 80)],
      [transfer(1, CARD_ID, 50, '2026-02-05'), transfer(CARD_ID, 1, 10, '2026-02-20')],
      '2026-04-01',
    );
    const sum = result.periods.reduce((total, period) => total + BigInt(period.remaining), 0n);
    expect(sum.toString()).toBe(result.liability);
  });
});
