import { describe, expect, it } from 'vitest';

import { deriveBillingPeriod, derivePaymentDueOn, resolveBillingDay } from './billing-calendar.js';

describe('billing calendar', () => {
  it('includes the closing day and starts the next period on the following day', () => {
    expect(deriveBillingPeriod('2026-01-15', '15', '10', 'next_month')).toEqual({
      periodStart: '2025-12-16',
      periodEnd: '2026-01-15',
      dueOn: '2026-02-10',
    });
    expect(deriveBillingPeriod('2026-01-16', '15', '10', 'next_month')).toEqual({
      periodStart: '2026-01-16',
      periodEnd: '2026-02-15',
      dueOn: '2026-03-10',
    });
  });

  it('handles month end and leap years for last and numeric closing days', () => {
    expect(deriveBillingPeriod('2026-02-28', 'last', '10', 'next_month')).toEqual({
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      dueOn: '2026-03-10',
    });
    expect(deriveBillingPeriod('2028-02-29', '31', '10', 'next_month')).toEqual({
      periodStart: '2028-02-01',
      periodEnd: '2028-02-29',
      dueOn: '2028-03-10',
    });
    expect(resolveBillingDay('2026-04', '31')).toBe('2026-04-30');
    expect(resolveBillingDay('2028-02', 'last')).toBe('2028-02-29');
  });

  it('moves payment months across year boundaries and applies offsets', () => {
    expect(derivePaymentDueOn('2026-12-31', '10', 'next_month')).toBe('2027-01-10');
    expect(derivePaymentDueOn('2026-12-31', '10', 'two_months_later')).toBe('2027-02-10');
    expect(derivePaymentDueOn('2026-12-31', 'last', 'same_month')).toBe('2026-12-31');
  });

  it('rejects dates outside the supported calendar range', () => {
    expect(() => derivePaymentDueOn('9998-12-31', '10', 'next_month')).toThrow();
    expect(() => resolveBillingDay('1899-12', '1')).toThrow();
  });
});
