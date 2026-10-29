import { describe, expect, it } from 'vitest';
import { fixedCostOccurrenceOn, isFixedCostDueOn, summarizeFixedCosts } from './fixed-costs.js';

describe('fixed cost schedules', () => {
  it('clamps day 31 to the end of shorter months', () => {
    const fixedCost = {
      startMonth: '2023-01-01',
      day: 31,
      intervalCount: 1,
      intervalUnit: 'month' as const,
    };
    expect(fixedCostOccurrenceOn(fixedCost, '2024-02')).toBe('2024-02-29');
    expect(fixedCostOccurrenceOn(fixedCost, '2023-02')).toBe('2023-02-28');
  });

  it('handles N-month and N-year intervals without backfilling', () => {
    const everyThreeMonths = {
      startMonth: '2026-01-01',
      day: 10,
      intervalCount: 3,
      intervalUnit: 'month' as const,
    };
    expect(isFixedCostDueOn(everyThreeMonths, '2026-04-10')).toBe(true);
    expect(isFixedCostDueOn(everyThreeMonths, '2026-03-10')).toBe(false);
    const everyTwoYears = {
      startMonth: '2024-01-01',
      day: 1,
      intervalCount: 2,
      intervalUnit: 'year' as const,
    };
    expect(isFixedCostDueOn(everyTwoYears, '2026-01-01')).toBe(true);
    expect(isFixedCostDueOn(everyTwoYears, '2025-01-01')).toBe(false);
    expect(isFixedCostDueOn(everyTwoYears, '2023-01-01')).toBe(false);
  });

  it('matches the representative fixed cost summary', () => {
    const rows = [
      [85000, 1, 'month'],
      [3240, 2, 'month'],
      [7800, 1, 'month'],
      [3278, 1, 'month'],
      [12000, 3, 'month'],
      [1490, 1, 'month'],
      [1080, 1, 'month'],
      [7700, 1, 'month'],
      [5900, 1, 'year'],
    ] as const;
    expect(
      summarizeFixedCosts(
        rows.map(([amount, intervalCount, intervalUnit]) => ({
          amount,
          intervalCount,
          intervalUnit,
        })),
      ),
    ).toEqual({ monthly: 112460, annual: 1349516 });
  });
});
