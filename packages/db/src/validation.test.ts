import { describe, expect, it } from 'vitest';

import { MAX_SUPPORTED_YEAR, MIN_SUPPORTED_YEAR } from './month.js';
import {
  AMOUNT_LIMIT,
  transactionInputFromFormData,
  transactionInputSchema,
  transferInputSchema,
  normalizeAmountInput,
} from './validation.js';

describe('transaction input validation', () => {
  it('normalizes accepted ASCII integer input forms, including signed amounts', () => {
    expect(normalizeAmountInput('1,2345')).toBeUndefined();
    expect(normalizeAmountInput('1,200')).toBe(1_200);
    expect(normalizeAmountInput('1,000,000')).toBe(1_000_000);
    expect(normalizeAmountInput('0001')).toBe(1);
    expect(normalizeAmountInput('-100')).toBe(-100);
    expect(normalizeAmountInput('-1,200')).toBe(-1_200);
    expect(normalizeAmountInput('0')).toBe(0);
  });

  it('ignores account ids from ordinary transaction form posts', () => {
    const formData = new FormData();
    formData.set('type', 'expense');
    formData.set('amount', '100');
    formData.set('occurredOn', '2026-09-01');
    formData.set('categoryId', '1');
    formData.set('accountId', '2147483647');
    formData.set('memo', '');
    expect(transactionInputFromFormData(formData)).toMatchObject({ accountId: undefined });
  });

  it('rejects malformed amounts while allowing zero and negative integers', () => {
    expect(normalizeAmountInput('')).toBeUndefined();
    expect(normalizeAmountInput('1,00')).toBeUndefined();
    expect(normalizeAmountInput('1234,567')).toBeUndefined();
    expect(normalizeAmountInput('0,100')).toBeUndefined();
    expect(normalizeAmountInput('01,000')).toBeUndefined();
    expect(normalizeAmountInput(' 100')).toBeUndefined();
    expect(normalizeAmountInput('+100')).toBeUndefined();
    expect(normalizeAmountInput('１．５')).toBeUndefined();
    expect(normalizeAmountInput('−１，２００')).toBeUndefined();
    expect(normalizeAmountInput('1.5')).toBeUndefined();
    expect(normalizeAmountInput('1.')).toBeUndefined();
    expect(normalizeAmountInput('.5')).toBeUndefined();
    expect(normalizeAmountInput('1e3')).toBeUndefined();
    expect(normalizeAmountInput('1,2345')).toBeUndefined();
    expect(normalizeAmountInput('¥¥100')).toBeUndefined();
    expect(normalizeAmountInput('￥¥100')).toBeUndefined();
    expect(normalizeAmountInput('12a')).toBeUndefined();
    expect(normalizeAmountInput('１２ａ')).toBeUndefined();
    expect(normalizeAmountInput('¥')).toBeUndefined();

    const zero = transactionInputSchema.safeParse({
      type: 'expense',
      amount: '0',
      occurredOn: '2026-09-01',
      categoryId: '1',
      memo: '',
    });
    expect(zero.success).toBe(true);

    const negative = transactionInputSchema.safeParse({
      type: 'income',
      amount: '-100',
      occurredOn: '2026-09-01',
      categoryId: '2',
      memo: '',
    });
    expect(negative.success).toBe(true);

    const amountCases = [
      ['1', true, undefined],
      ['1.0', true, undefined],
      ['1.00', true, undefined],
      ['1.5', false, '金額は整数で入力してください。'],
      ['1.', false, '金額を入力してください。'],
      ['.5', false, '金額は整数で入力してください。'],
      ['-1', true, undefined],
      ['0', true, undefined],
      ['1,000', true, undefined],
      ['abc', false, '金額を入力してください。'],
      ['', false, '金額を入力してください。'],
    ] as const;
    for (const [amount, success, message] of amountCases) {
      const result = transactionInputSchema.safeParse({
        type: 'expense',
        amount,
        occurredOn: '2026-09-01',
        categoryId: '1',
        memo: '',
      });
      expect(result.success, amount).toBe(success);
      if (!result.success && message) {
        expect(result.error.flatten().fieldErrors.amount, amount).toContain(message);
      }
    }
    for (const [amount, success, message] of amountCases) {
      const result = transferInputSchema.safeParse({
        fromAccountId: '1',
        toAccountId: '2',
        amount,
        occurredOn: '2026-09-01',
        memo: '',
      });
      const transferDecimal = amount === '1.' || amount === '1.0' || amount === '1.00';
      const transferSuccess =
        amount === '-1' || amount === '0' || transferDecimal ? false : success;
      const expectedMessage =
        amount === '-1' || amount === '0'
          ? '金額は1円以上で入力してください。'
          : transferDecimal
            ? '金額は整数で入力してください。'
            : message;
      expect(result.success, `transfer ${amount}`).toBe(transferSuccess);
      if (!result.success && expectedMessage) {
        expect(result.error.flatten().fieldErrors.amount, `transfer ${amount}`).toContain(
          expectedMessage,
        );
      }
    }
  });
  it('enforces the symmetric integer amount limit and trimmed memo length', () => {
    const valid = transactionInputSchema.safeParse({
      type: 'income',
      amount: String(AMOUNT_LIMIT),
      occurredOn: '2026-09-01',
      categoryId: '2',
      memo: '  給与  ',
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.amount).toBe(AMOUNT_LIMIT);
      expect(valid.data.memo).toBe('給与');
    }
    const maxMemo = transactionInputSchema.safeParse({
      type: 'expense',
      amount: '100',
      occurredOn: '2026-09-01',
      categoryId: '1',
      memo: `  ${'あ'.repeat(200)} `,
    });
    expect(maxMemo.success).toBe(true);
    if (maxMemo.success) {
      expect(maxMemo.data.memo).toBe('あ'.repeat(200));
    }

    const tooLong = transactionInputSchema.safeParse({
      type: 'expense',
      amount: '9'.repeat(100),
      occurredOn: '2026-09-01',
      categoryId: '1',
      memo: '',
    });
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) {
      expect(tooLong.error.issues[0]?.message).toContain('999,999,999');
    }
    expect(
      transactionInputSchema.safeParse({
        type: 'expense',
        amount: String(AMOUNT_LIMIT + 1),
        occurredOn: '2026-09-01',
        categoryId: '1',
        memo: '',
      }).success,
    ).toBe(false);
    expect(
      transactionInputSchema.safeParse({
        type: 'expense',
        amount: String(-AMOUNT_LIMIT),
        occurredOn: '2026-09-01',
        categoryId: '1',
        memo: '',
      }).success,
    ).toBe(true);
    expect(
      transactionInputSchema.safeParse({
        type: 'expense',
        amount: String(-AMOUNT_LIMIT - 1),
        occurredOn: '2026-09-01',
        categoryId: '1',
        memo: '',
      }).success,
    ).toBe(false);
    expect(
      transactionInputSchema.safeParse({
        type: 'expense',
        amount: '100',
        occurredOn: '2026-09-01',
        categoryId: '1',
        memo: 'あ'.repeat(201),
      }).success,
    ).toBe(false);
  });

  it('rejects impossible calendar dates without shifting them by timezone', () => {
    expect(
      transactionInputSchema.safeParse({
        type: 'expense',
        amount: '100',
        occurredOn: '2026-02-30',
        categoryId: '1',
        memo: '',
      }).success,
    ).toBe(false);
    expect(
      transactionInputSchema.safeParse({
        type: 'expense',
        amount: '100',
        occurredOn: '2026-09-30',
        categoryId: '1',
        memo: '',
      }).success,
    ).toBe(true);
  });

  it('rejects calendar dates outside the supported year bounds', () => {
    expect(
      transactionInputSchema.safeParse({
        type: 'expense',
        amount: '100',
        occurredOn: '0000-01-01',
        categoryId: '1',
        memo: '',
      }).success,
    ).toBe(false);
    expect(
      transactionInputSchema.safeParse({
        type: 'expense',
        amount: '100',
        occurredOn: `${MIN_SUPPORTED_YEAR - 1}-12-31`,
        categoryId: '1',
        memo: '',
      }).success,
    ).toBe(false);
    expect(
      transactionInputSchema.safeParse({
        type: 'expense',
        amount: '100',
        occurredOn: `${MAX_SUPPORTED_YEAR + 1}-01-01`,
        categoryId: '1',
        memo: '',
      }).success,
    ).toBe(false);
    expect(
      transactionInputSchema.safeParse({
        type: 'expense',
        amount: '100',
        occurredOn: `${MIN_SUPPORTED_YEAR}-01-01`,
        categoryId: '1',
        memo: '',
      }).success,
    ).toBe(true);
    expect(
      transactionInputSchema.safeParse({
        type: 'expense',
        amount: '100',
        occurredOn: `${MAX_SUPPORTED_YEAR}-12-31`,
        categoryId: '1',
        memo: '',
      }).success,
    ).toBe(true);
  });
});
