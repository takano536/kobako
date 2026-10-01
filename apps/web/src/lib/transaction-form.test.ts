import { describe, expect, it } from 'vitest';

import {
  firstTransactionFieldError,
  switchTransactionType,
  transactionFormValuesFromFormData,
  transferValidationErrors,
} from './transaction-form.js';
import {
  isAmountText,
  isAmountTextWhileEditing,
  normalizeAmountInput,
} from '../../../../packages/db/src/validation.js';

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

describe('unified transaction form values', () => {
  it('keeps category fields for ordinary transactions and ignores account fields', () => {
    const formData = new FormData();
    formData.set('type', 'expense');
    formData.set('amount', '1200');
    formData.set('occurredOn', '2026-09-01');
    formData.set('categoryId', '3');
    formData.set('fromAccountId', '11');
    formData.set('toAccountId', '12');
    formData.set('memo', '食費');
    expect(transactionFormValuesFromFormData(formData)).toEqual({
      type: 'expense',
      amount: '1200',
      occurredOn: '2026-09-01',
      categoryId: '3',
      fromAccountId: '',
      toAccountId: '',
      memo: '食費',
    });
  });

  it('keeps transfer accounts and ignores stale category fields', () => {
    const formData = new FormData();
    formData.set('type', 'transfer');
    formData.set('amount', '1200');
    formData.set('occurredOn', '2026-09-01');
    formData.set('categoryId', '3');
    formData.set('fromAccountId', '11');
    formData.set('toAccountId', '12');
    formData.set('memo', '移動');
    expect(transactionFormValuesFromFormData(formData)).toEqual({
      type: 'transfer',
      amount: '1200',
      occurredOn: '2026-09-01',
      categoryId: '',
      fromAccountId: '11',
      toAccountId: '12',
      memo: '移動',
    });
  });

  it('extracts income values while ignoring account ids', () => {
    const formData = new FormData();
    formData.set('type', 'income');
    formData.set('amount', '500');
    formData.set('occurredOn', '2026-09-01');
    formData.append('categoryId', 'expense-category');
    formData.append('categoryId', 'income-category');
    formData.set('fromAccountId', '11');
    formData.set('toAccountId', '12');
    formData.set('memo', '給与');
    expect(transactionFormValuesFromFormData(formData)).toEqual({
      type: 'income',
      amount: '500',
      occurredOn: '2026-09-01',
      categoryId: 'income-category',
      fromAccountId: '',
      toAccountId: '',
      memo: '給与',
    });
  });

  it('switches types while preserving shared values and selecting the first category', () => {
    const values = {
      type: 'expense',
      amount: '1200',
      occurredOn: '2026-09-01',
      categoryId: '3',
      fromAccountId: '11',
      toAccountId: '12',
      memo: '維持',
    };
    const categories = [
      { id: 10, type: 'expense' as const },
      { id: 20, type: 'income' as const },
    ];
    expect(switchTransactionType(values, 'income', categories)).toEqual({
      ...values,
      type: 'income',
      categoryId: '20',
      fromAccountId: '',
      toAccountId: '',
    });
    expect(
      switchTransactionType(
        switchTransactionType(values, 'transfer', categories),
        'expense',
        categories,
      ),
    ).toEqual({
      ...values,
      type: 'expense',
      categoryId: '10',
      fromAccountId: '',
      toAccountId: '',
    });
  });

  it('maps every transfer validation endpoint to its corresponding field', () => {
    expect(transferValidationErrors('from_account_unavailable')).toEqual({
      fromAccountId: ['選択した口座は利用できません。'],
    });
    expect(transferValidationErrors('to_account_unavailable')).toEqual({
      toAccountId: ['選択した口座は利用できません。'],
    });
    expect(transferValidationErrors('accounts_unavailable')).toEqual({
      fromAccountId: ['選択した口座は利用できません。'],
      toAccountId: ['選択した口座は利用できません。'],
    });
    expect(transferValidationErrors('same_account')).toEqual({
      toAccountId: ['振替元と振替先は別の口座を選択してください。'],
    });
  });
  it('maps field errors for expense, income, and transfer forms', () => {
    expect(firstTransactionFieldError({ categoryId: ['支出カテゴリ'] }, 'categoryId')).toBe(
      '支出カテゴリ',
    );
    expect(firstTransactionFieldError({ categoryId: ['収入カテゴリ'] }, 'categoryId')).toBe(
      '収入カテゴリ',
    );
    expect(firstTransactionFieldError({ fromAccountId: ['振替元'] }, 'fromAccountId')).toBe(
      '振替元',
    );
  });
});
