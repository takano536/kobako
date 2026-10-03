import { describe, expect, it } from 'vitest';

import { calculateBalanceTotal } from './balances';

describe('calculateBalanceTotal', () => {
  it('sums positive and negative integer strings without floating-point conversion', () => {
    expect(
      calculateBalanceTotal([
        { balance: '9007199254740993' },
        { balance: '-9007199254740992' },
        { balance: '-7' },
      ]),
    ).toBe('-6');
  });

  it('preserves large totals exactly', () => {
    expect(calculateBalanceTotal([{ balance: '999999999' }, { balance: '999999999' }])).toBe(
      '1999999998',
    );
  });

  it('returns zero for no accounts', () => {
    expect(calculateBalanceTotal([])).toBe('0');
  });
});
