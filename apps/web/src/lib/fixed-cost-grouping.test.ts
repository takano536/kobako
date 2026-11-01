import { describe, expect, it } from 'vitest';

import { groupFixedCostsByFrequency } from './fixed-cost-grouping.js';

type TestRow = {
  id: number;
  intervalCount: number;
  intervalUnit: 'month' | 'year';
  day: number;
  startMonth: string;
};

const row = (
  id: number,
  intervalCount: number,
  intervalUnit: TestRow['intervalUnit'],
  day: number,
  startMonth: string,
): TestRow => ({ id, intervalCount, intervalUnit, day, startMonth });

describe('groupFixedCostsByFrequency', () => {
  it('groups monthly fixed costs together regardless of payment day', () => {
    const groups = groupFixedCostsByFrequency([
      row(1, 1, 'month', 27, '2026-01-01'),
      row(2, 1, 'month', 15, '2026-01-01'),
    ]);

    expect([...groups.entries()]).toEqual([
      ['毎月', [row(1, 1, 'month', 27, '2026-01-01'), row(2, 1, 'month', 15, '2026-01-01')]],
    ]);
  });

  it('groups each interval together regardless of its start month', () => {
    const groups = groupFixedCostsByFrequency([
      row(1, 2, 'month', 10, '2026-01-01'),
      row(2, 2, 'month', 20, '2026-03-01'),
      row(3, 2, 'year', 10, '2026-01-01'),
      row(4, 2, 'year', 20, '2027-01-01'),
    ]);

    expect([...groups.entries()]).toEqual([
      ['2か月ごと', [row(1, 2, 'month', 10, '2026-01-01'), row(2, 2, 'month', 20, '2026-03-01')]],
      ['2年ごと', [row(3, 2, 'year', 10, '2026-01-01'), row(4, 2, 'year', 20, '2027-01-01')]],
    ]);
  });

  it('orders monthly, month intervals, yearly, then year intervals', () => {
    const groups = groupFixedCostsByFrequency([
      row(1, 3, 'year', 1, '2026-01-01'),
      row(2, 12, 'month', 1, '2026-01-01'),
      row(3, 1, 'year', 1, '2026-01-01'),
      row(4, 2, 'month', 1, '2026-01-01'),
      row(5, 1, 'month', 1, '2026-01-01'),
      row(6, 3, 'month', 1, '2026-01-01'),
      row(7, 2, 'year', 1, '2026-01-01'),
    ]);

    expect([...groups.keys()]).toEqual([
      '毎月',
      '2か月ごと',
      '3か月ごと',
      '12か月ごと',
      '毎年',
      '2年ごと',
      '3年ごと',
    ]);
  });
});
