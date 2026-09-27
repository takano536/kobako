import { describe, expect, it } from 'vitest';

import {
  expenseBarWidth,
  formatExpenseShare,
  formatJapaneseDate,
  formatTransactionAmount,
  formatYen,
  groupTransactionsByDate,
  transactionAmountTone,
} from './format';

describe('amount display', () => {
  it('formats negative values without NaN and applies transaction direction once', () => {
    expect(formatYen(-1200)).toBe('−1,200円');
    expect(formatYen('-0')).toBe('0円');
    expect(formatTransactionAmount('expense', 500)).toBe('−500円');
    expect(formatTransactionAmount('expense', -500)).toBe('＋500円');
    expect(formatTransactionAmount('income', -500)).toBe('−500円');
    expect(formatTransactionAmount('income', 0)).toBe('0円');
    expect(transactionAmountTone('expense', 500)).toBe('negative');
    expect(transactionAmountTone('expense', -500)).toBe('positive');
    expect(transactionAmountTone('income', -500)).toBe('negative');
    expect(transactionAmountTone('income', 0)).toBe('neutral');
  });
});

describe('Japanese calendar date display', () => {
  it('formats month-end dates without a timezone shift', () => {
    expect(formatJapaneseDate('2026-04-30')).toBe('4月30日（木）');
    expect(formatJapaneseDate('2026-05-01')).toBe('5月1日（金）');
  });

  it('formats year-end and leap-day dates', () => {
    expect(formatJapaneseDate('2025-12-31')).toBe('12月31日（水）');
    expect(formatJapaneseDate('2028-02-29')).toBe('2月29日（火）');
  });

  it('leaves malformed dates safe to display', () => {
    expect(formatJapaneseDate('not-a-date')).toBe('not-a-date');
    expect(formatJapaneseDate('2028-02-30')).toBe('2028-02-30');
  });
});

describe('transaction date grouping', () => {
  it('keeps the database ordering and ordering within each date', () => {
    const transactions = [
      { id: 4, occurredOn: '2026-05-03' },
      { id: 3, occurredOn: '2026-05-03' },
      { id: 2, occurredOn: '2026-05-02' },
      { id: 1, occurredOn: '2026-05-01' },
    ];

    expect(groupTransactionsByDate(transactions)).toEqual([
      {
        occurredOn: '2026-05-03',
        transactions: [
          { id: 4, occurredOn: '2026-05-03' },
          { id: 3, occurredOn: '2026-05-03' },
        ],
      },
      { occurredOn: '2026-05-02', transactions: [{ id: 2, occurredOn: '2026-05-02' }] },
      { occurredOn: '2026-05-01', transactions: [{ id: 1, occurredOn: '2026-05-01' }] },
    ]);
  });
});

describe('expense share display', () => {
  it('rounds actual category share and handles non-positive totals', () => {
    expect(formatExpenseShare('12', '100')).toBe('12%');
    expect(formatExpenseShare('1', '1000')).toBe('<1%');
    expect(formatExpenseShare('0', '100')).toBe('0%');
    expect(formatExpenseShare('-40', '100')).toBe('—');
    expect(formatExpenseShare('0', '0')).toBe('—');
    expect(formatExpenseShare('40', '-1')).toBe('—');
  });

  it('clamps category bars to a safe CSS percentage', () => {
    expect(expenseBarWidth('50', '100')).toBe(50);
    expect(expenseBarWidth('-50', '100')).toBe(0);
    expect(expenseBarWidth('50', '0')).toBe(0);
    expect(expenseBarWidth('200', '100')).toBe(100);
  });
});
