import { describe, expect, it } from 'vitest';

import {
  firstQueryValue,
  parseTransactionListFilters,
  parseTransactionType,
} from './transaction-query.js';

describe('transaction list query parsing', () => {
  it('uses the first value from array query parameters', () => {
    expect(firstQueryValue(['transfer', 'expense'])).toBe('transfer');
    expect(parseTransactionType(['income', 'expense'])).toBe('income');
  });

  it('rejects unsupported transaction types', () => {
    expect(parseTransactionType('deposit')).toBeUndefined();
    expect(parseTransactionListFilters({ type: 'deposit', category: '12' })).toEqual({
      type: undefined,
      categoryId: 12,
    });
  });

  it('ignores categories for transfer lists', () => {
    expect(parseTransactionListFilters({ type: 'transfer', category: '12' })).toEqual({
      type: 'transfer',
      categoryId: undefined,
    });
  });

  it('rejects malformed and out-of-range category ids', () => {
    expect(parseTransactionListFilters({ type: 'expense', category: '0' })).toEqual({
      type: 'expense',
      categoryId: undefined,
    });
    expect(parseTransactionListFilters({ type: 'expense', category: '2147483648' })).toEqual({
      type: 'expense',
      categoryId: undefined,
    });
  });
});
