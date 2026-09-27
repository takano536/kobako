import { describe, expect, it } from 'vitest';

import { calculateDifference } from './ledger.js';
import {
  MAX_SUPPORTED_YEAR,
  MIN_SUPPORTED_YEAR,
  currentTokyoDate,
  currentTokyoMonth,
  isValidMonth,
  monthRange,
  parseMonth,
  shiftMonth,
} from './month.js';

describe('calendar month helpers', () => {
  it('calculates ranges across year boundaries', () => {
    expect(monthRange('2026-12')).toEqual({
      month: '2026-12',
      start: '2026-12-01',
      endExclusive: '2027-01-01',
    });
    expect(monthRange('2027-01')).toEqual({
      month: '2027-01',
      start: '2027-01-01',
      endExclusive: '2027-02-01',
    });
  });

  it('moves months in both directions', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
    expect(shiftMonth('2026-03', -15)).toBe('2024-12');
  });

  it('uses Tokyo calendar values without a timezone shift', () => {
    const instant = new Date('2026-09-30T15:30:00.000Z');
    expect(currentTokyoDate(instant)).toBe('2026-10-01');
    expect(currentTokyoMonth(instant)).toBe('2026-10');
  });

  it('subtracts totals as bigint strings', () => {
    expect(calculateDifference('10000000000', '1')).toBe('9999999999');
    expect(calculateDifference('0', '250')).toBe('-250');
  });

  it('rejects months outside the supported year bounds', () => {
    expect(isValidMonth('0000-01')).toBe(false);
    expect(isValidMonth(`${MIN_SUPPORTED_YEAR - 1}-12`)).toBe(false);
    expect(isValidMonth(`${MAX_SUPPORTED_YEAR + 1}-01`)).toBe(false);
    expect(isValidMonth(`${MIN_SUPPORTED_YEAR}-01`)).toBe(true);
    expect(isValidMonth(`${MAX_SUPPORTED_YEAR}-12`)).toBe(true);
  });

  it('falls back to the given default when the month is out of bounds', () => {
    expect(parseMonth('0000-01', '2026-09')).toBe('2026-09');
    expect(parseMonth(`${MAX_SUPPORTED_YEAR + 1}-01`, '2026-09')).toBe('2026-09');
    expect(parseMonth('2026-09', '2020-01')).toBe('2026-09');
  });

  it('throws instead of shifting past the supported year bounds', () => {
    expect(() => shiftMonth(`${MIN_SUPPORTED_YEAR}-01`, -1)).toThrow();
    expect(() => shiftMonth(`${MAX_SUPPORTED_YEAR}-12`, 1)).toThrow();
  });
});
