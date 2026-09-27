import { describe, expect, it } from 'vitest';

import { formatJapaneseDate, groupTransactionsByDate } from './format';

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
