import { describe, expect, it } from 'vitest';

import {
  deriveCardBillingPeriods,
  type CardBillingSettings,
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
  autoPaymentEnabled: false,
  autoPaymentEnabledOn: null,
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
