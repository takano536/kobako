import { describe, expect, it } from 'vitest';

import { MAX_SUPPORTED_YEAR, MIN_SUPPORTED_YEAR } from './month.js';
import {
  AMOUNT_LIMIT,
  accountCardConditionInputSchema,
  categoryCreateInputSchema,
  categoryUpdateInputSchema,
  isValidCardBillingSchedule,
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

  it('keeps the selected account id from ordinary transaction form posts', () => {
    const formData = new FormData();
    formData.set('type', 'expense');
    formData.set('amount', '100');
    formData.set('occurredOn', '2026-09-01');
    formData.set('categoryId', '1');
    formData.set('accountId', '2147483647');
    formData.set('memo', '');
    expect(transactionInputFromFormData(formData)).toMatchObject({ accountId: '2147483647' });
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

describe('card billing setting validation', () => {
  const base = {
    closingDay: '25',
    paymentDay: '10',
    paymentMonthOffset: 'same_month' as const,
    debitAccountId: null,
  };

  it('rejects same-month payment dates that are not after every resolved close date', () => {
    const result = accountCardConditionInputSchema.safeParse(base);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.paymentDay).toContain(
        '同月払いでは、支払日が締め日より後になる設定にしてください。',
      );
    }
    expect(
      accountCardConditionInputSchema.safeParse({
        ...base,
        closingDay: '30',
        paymentDay: '31',
      }).success,
    ).toBe(false);
    expect(
      accountCardConditionInputSchema.safeParse({
        ...base,
        closingDay: '27',
        paymentDay: '28',
      }).success,
    ).toBe(true);
    expect(isValidCardBillingSchedule('last', 'last', 'same_month')).toBe(false);
    expect(isValidCardBillingSchedule('25', 'last', 'same_month')).toBe(true);
    expect(isValidCardBillingSchedule('25', '10', 'next_month')).toBe(true);
  });
});

describe('category input validation', () => {
  it('trims names and rejects blank, control-character, and overlong names', () => {
    const valid = categoryCreateInputSchema.safeParse({ type: 'expense', name: '  食費  ' });
    expect(valid.success).toBe(true);
    if (valid.success) expect(valid.data.name).toBe('食費');
    expect(categoryCreateInputSchema.safeParse({ type: 'expense', name: ' \t ' }).success).toBe(
      false,
    );
    expect(
      categoryCreateInputSchema.safeParse({ type: 'income', name: `給与${String.fromCharCode(7)}` })
        .success,
    ).toBe(false);
    expect(
      categoryCreateInputSchema.safeParse({ type: 'expense', name: 'あ'.repeat(81) }).success,
    ).toBe(false);
  });

  it('validates category id and type on rename', () => {
    expect(
      categoryUpdateInputSchema.safeParse({ id: '12', type: 'income', name: '給与' }).success,
    ).toBe(true);
    expect(
      categoryUpdateInputSchema.safeParse({ id: '0', type: 'expense', name: '食費' }).success,
    ).toBe(false);
    expect(
      categoryUpdateInputSchema.safeParse({ id: '12', type: 'transfer', name: '振替' }).success,
    ).toBe(false);
  });
});
