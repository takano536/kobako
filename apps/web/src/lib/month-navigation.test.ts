import { describe, expect, it } from 'vitest';

import { isValidDisplayMonth, withSelectedMonth } from './month-navigation';

describe('selected month navigation URLs', () => {
  it('carries a valid month without copying screen-specific filters', () => {
    expect(withSelectedMonth('/', '2024-06')).toBe('/?month=2024-06');
    expect(withSelectedMonth('/transactions', '2024-06')).toBe('/transactions?month=2024-06');
    expect(withSelectedMonth('/balances', '2024-06')).toBe('/balances?month=2024-06');
    expect(withSelectedMonth('/accounts/new', '2024-06')).toBe('/accounts/new?month=2024-06');
  });

  it('omits invalid and month-independent values', () => {
    expect(isValidDisplayMonth('2024-06')).toBe(true);
    expect(isValidDisplayMonth('bad')).toBe(false);
    expect(isValidDisplayMonth('all')).toBe(false);
    expect(withSelectedMonth('/transactions', 'bad')).toBe('/transactions');
    expect(withSelectedMonth('/transactions', 'all')).toBe('/transactions');
  });
});
