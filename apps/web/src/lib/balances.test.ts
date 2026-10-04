import { describe, expect, it } from 'vitest';

import { calculateBalanceSummary } from './balances';

describe('calculateBalanceSummary', () => {
  it('separates positive, negative, and zero balances', () => {
    expect(
      calculateBalanceSummary([
        { balance: '125000' },
        { balance: '-30000' },
        { balance: '0' },
        { balance: '7000' },
      ]),
    ).toEqual({
      assets: '132000',
      liabilities: '30000',
      net: '102000',
    });
  });

  it('returns all zero values for all-zero balances', () => {
    expect(calculateBalanceSummary([{ balance: '0' }, { balance: '0' }])).toEqual({
      assets: '0',
      liabilities: '0',
      net: '0',
    });
  });

  it('returns all zero values for an empty account list', () => {
    expect(calculateBalanceSummary([])).toEqual({
      assets: '0',
      liabilities: '0',
      net: '0',
    });
  });

  it('totals all-negative balances as positive liabilities', () => {
    expect(calculateBalanceSummary([{ balance: '-500' }, { balance: '-1250' }])).toEqual({
      assets: '0',
      liabilities: '1750',
      net: '-1750',
    });
  });

  it('preserves values beyond Number.MAX_SAFE_INTEGER exactly', () => {
    expect(
      calculateBalanceSummary([{ balance: '9007199254740993' }, { balance: '-9007199254740994' }]),
    ).toEqual({
      assets: '9007199254740993',
      liabilities: '9007199254740994',
      net: '-1',
    });
  });

  it('returns a negative net when liabilities exceed assets', () => {
    expect(calculateBalanceSummary([{ balance: '5' }, { balance: '-12' }])).toEqual({
      assets: '5',
      liabilities: '12',
      net: '-7',
    });
  });

  it('uses account kinds for liability presentation while net remains raw balance sum', () => {
    expect(
      calculateBalanceSummary([
        { balance: '8000', kind: 'bank' },
        { balance: '12000', kind: 'credit_card' },
        { balance: '-3000', kind: 'credit_card' },
      ]),
    ).toEqual({
      assets: '8000',
      liabilities: '-9000',
      net: '17000',
    });
  });
});
