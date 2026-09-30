import { describe, expect, it } from 'vitest';

import { AMOUNT_LIMIT, MEMO_MAX_LENGTH, transferInputSchema } from './validation.js';

const validTransfer = {
  fromAccountId: '1',
  toAccountId: '2',
  amount: '1,200',
  occurredOn: '2026-09-30',
  memo: 'メモ',
};

describe('transfer input validation', () => {
  it('accepts a valid transfer and normalizes form values', () => {
    expect(transferInputSchema.parse(validTransfer)).toEqual({
      fromAccountId: 1,
      toAccountId: 2,
      amount: 1_200,
      occurredOn: '2026-09-30',
      memo: 'メモ',
    });
  });

  it('requires both transfer accounts and rejects the same account', () => {
    const fromMissing = transferInputSchema.safeParse({ ...validTransfer, fromAccountId: '' });
    expect(fromMissing.success).toBe(false);
    if (!fromMissing.success) {
      expect(fromMissing.error.flatten().fieldErrors.fromAccountId).toContain(
        '振替元の口座を選択してください。',
      );
    }

    const toMissing = transferInputSchema.safeParse({ ...validTransfer, toAccountId: '' });
    expect(toMissing.success).toBe(false);
    if (!toMissing.success) {
      expect(toMissing.error.flatten().fieldErrors.toAccountId).toContain(
        '振替先の口座を選択してください。',
      );
    }

    const sameAccount = transferInputSchema.safeParse({ ...validTransfer, toAccountId: '1' });
    expect(sameAccount.success).toBe(false);
    if (!sameAccount.success) {
      expect(sameAccount.error.flatten().fieldErrors.toAccountId).toContain(
        '振替元と振替先は別の口座を選択してください。',
      );
    }
  });
  it('rejects account ids outside the PostgreSQL int4 range as unavailable selections', () => {
    const result = transferInputSchema.safeParse({
      ...validTransfer,
      fromAccountId: '2147483648',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.fromAccountId).toContain(
        '選択した口座は利用できません。',
      );
    }
  });

  it('accepts the int4 maximum and rejects the maximum-plus-one destination', () => {
    expect(
      transferInputSchema.safeParse({
        ...validTransfer,
        fromAccountId: '2147483647',
      }).success,
    ).toBe(true);
    const result = transferInputSchema.safeParse({
      ...validTransfer,
      toAccountId: '2147483648',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.toAccountId).toContain(
        '選択した口座は利用できません。',
      );
    }
  });

  it.each(['0', '-1'])('rejects non-positive amount %s', (amount) => {
    const result = transferInputSchema.safeParse({ ...validTransfer, amount });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.amount).toContain(
        '金額は1円以上で入力してください。',
      );
    }
  });

  it.each(['1.5', '1.0', '1.00'])('rejects decimal amounts as non-integers: %s', (amount) => {
    const result = transferInputSchema.safeParse({ ...validTransfer, amount });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.amount).toContain('金額は整数で入力してください。');
    }
  });

  it('accepts the maximum amount and rejects values over it', () => {
    expect(
      transferInputSchema.safeParse({ ...validTransfer, amount: String(AMOUNT_LIMIT) }).success,
    ).toBe(true);
    const result = transferInputSchema.safeParse({
      ...validTransfer,
      amount: String(AMOUNT_LIMIT + 1),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.amount).toContain(
        `金額は${AMOUNT_LIMIT.toLocaleString('ja-JP')}円以下で入力してください。`,
      );
    }
  });

  it('rejects an empty amount and invalid dates', () => {
    const emptyAmount = transferInputSchema.safeParse({ ...validTransfer, amount: '' });
    expect(emptyAmount.success).toBe(false);
    if (!emptyAmount.success) {
      expect(emptyAmount.error.flatten().fieldErrors.amount).toContain('金額を入力してください。');
    }

    const invalidDate = transferInputSchema.safeParse({
      ...validTransfer,
      occurredOn: '2026-02-30',
    });
    expect(invalidDate.success).toBe(false);
    if (!invalidDate.success) {
      expect(invalidDate.error.flatten().fieldErrors.occurredOn?.[0]).toContain('YYYY-MM-DD形式');
    }
  });

  it('accepts memo at the limit and rejects a longer memo', () => {
    expect(
      transferInputSchema.safeParse({ ...validTransfer, memo: 'あ'.repeat(MEMO_MAX_LENGTH) })
        .success,
    ).toBe(true);
    const result = transferInputSchema.safeParse({
      ...validTransfer,
      memo: 'あ'.repeat(MEMO_MAX_LENGTH + 1),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.memo).toContain(
        `メモは${MEMO_MAX_LENGTH}文字以内で入力してください。`,
      );
    }
  });
});
