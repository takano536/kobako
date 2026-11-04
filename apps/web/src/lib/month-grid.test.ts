import { describe, expect, it } from 'vitest';

import {
  MONTH_GRID_MAX_YEAR,
  MONTH_GRID_MIN_YEAR,
  monthGrid,
  shiftGridYear,
  yearOfMonth,
} from './month-grid';

describe('monthGrid', () => {
  it('lists the twelve months of the year as YYYY-MM with Japanese labels', () => {
    const cells = monthGrid(2026, null);
    expect(cells.map((cell) => cell.value)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    expect(cells[0]?.label).toBe('1月');
    expect(cells[11]?.label).toBe('12月');
  });

  it('marks only the selected month, and nothing in another year', () => {
    expect(monthGrid(2026, '2026-10').filter((cell) => cell.selected)).toEqual([
      { value: '2026-10', label: '10月', selected: true },
    ]);
    expect(monthGrid(2025, '2026-10').some((cell) => cell.selected)).toBe(false);
  });
});

describe('shiftGridYear', () => {
  it('moves the year back and forward', () => {
    expect(shiftGridYear(2026, -1)).toBe(2025);
    expect(shiftGridYear(2026, 1)).toBe(2027);
  });

  it('stops at the supported range', () => {
    expect(shiftGridYear(MONTH_GRID_MIN_YEAR, -1)).toBeNull();
    expect(shiftGridYear(MONTH_GRID_MAX_YEAR, 1)).toBeNull();
    expect(shiftGridYear(MONTH_GRID_MIN_YEAR, 1)).toBe(MONTH_GRID_MIN_YEAR + 1);
  });
});

describe('yearOfMonth', () => {
  it('reads the year from a YYYY-MM value and rejects other forms', () => {
    expect(yearOfMonth('2026-10')).toBe(2026);
    expect(yearOfMonth('2026-13')).toBeNull();
    expect(yearOfMonth('all')).toBeNull();
    expect(yearOfMonth('2026/10')).toBeNull();
  });
});
