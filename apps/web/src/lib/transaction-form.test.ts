import { describe, expect, it } from 'vitest';

import {
  isAmountText,
  isAmountTextWhileEditing,
  normalizeAmountInput,
} from '@kobako/db/validation';

describe('amount input format', () => {
  it('accepts normal, zero, negative, and comma-grouped integers', () => {
    expect(isAmountText('1200')).toBe(true);
    expect(isAmountText('0')).toBe(true);
    expect(isAmountText('-500')).toBe(true);
    expect(isAmountText('-1,200')).toBe(true);
    expect(normalizeAmountInput('-1,200')).toBe(-1200);
  });

  it('rejects decimals, exponents, letters, invalid symbols, and bad minus signs', () => {
    for (const value of ['1.5', '1e3', '12abc', '1_200', '1-2', '--2', '−200']) {
      expect(isAmountText(value), value).toBe(false);
      expect(isAmountTextWhileEditing(value), value).toBe(false);
    }
  });

  it('allows transient empty and leading-minus states only while editing', () => {
    expect(isAmountTextWhileEditing('')).toBe(true);
    expect(isAmountTextWhileEditing('-')).toBe(true);
    expect(isAmountText('')).toBe(false);
    expect(isAmountText('-')).toBe(false);
    expect(isAmountTextWhileEditing('1,')).toBe(true);
    expect(isAmountTextWhileEditing('1,20')).toBe(true);
  });
});
