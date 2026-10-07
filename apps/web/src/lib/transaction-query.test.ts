import { describe, expect, it } from 'vitest';

import {
  firstQueryValue,
  parseTransactionListFilters,
  parseTransactionType,
  validatedTransactionReturn,
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
      accountId: undefined,
    });
  });

  it('ignores categories for transfer lists', () => {
    expect(parseTransactionListFilters({ type: 'transfer', category: '12' })).toEqual({
      type: 'transfer',
      categoryId: undefined,
      accountId: undefined,
    });
  });

  it('rejects malformed and out-of-range category ids', () => {
    expect(parseTransactionListFilters({ type: 'expense', category: '0' })).toEqual({
      type: 'expense',
      categoryId: undefined,
      accountId: undefined,
    });
    expect(parseTransactionListFilters({ type: 'expense', category: '2147483648' })).toEqual({
      type: 'expense',
      categoryId: undefined,
      accountId: undefined,
    });
  });

  it('parses account filters and ignores legacy page parameters', () => {
    expect(parseTransactionListFilters({ account: '24', page: '3' })).toEqual({
      type: undefined,
      categoryId: undefined,
      accountId: 24,
    });
    expect(parseTransactionListFilters({ account: '0', page: '-1' })).toEqual({
      type: undefined,
      categoryId: undefined,
      accountId: undefined,
    });
    expect(parseTransactionListFilters({ page: '2x' })).toEqual({
      type: undefined,
      categoryId: undefined,
      accountId: undefined,
    });
  });

  it('accepts only a transaction return path for the same account', () => {
    expect(
      validatedTransactionReturn(
        '/transactions?month=all&type=expense&category=12&account=24&page=3',
        24,
      ),
    ).toBe('/transactions?account=24&month=all&type=expense&category=12');
    expect(validatedTransactionReturn('/transactions?month=all&account=25', 24)).toBeUndefined();
    expect(validatedTransactionReturn('/transactions?month=bad&account=24', 24)).toBeUndefined();
    expect(validatedTransactionReturn('/accounts/24/edit', 24)).toBeUndefined();
  });
});
