import { z } from 'zod';

import { MAX_SUPPORTED_YEAR, MIN_SUPPORTED_YEAR } from './month.js';
import { AMOUNT_LIMIT, AMOUNT_LIMIT_TEXT, AMOUNT_TEXT_PATTERN } from './amount.js';
import type { TransactionType } from './schema.js';

export { AMOUNT_FORMAT_MESSAGE, AMOUNT_LIMIT, AMOUNT_TEXT_PATTERN_SOURCE } from './amount.js';

export const MEMO_MAX_LENGTH = 200;
export const MAX_INT4_ID = 2_147_483_647;
const DECIMAL_AMOUNT_PATTERN = /^-?(?:\d+\.\d+|\.\d+)$/;
const TRANSFER_DECIMAL_AMOUNT_PATTERN = /^-?(?:\d+\.\d*|\.\d+)$/;
const AMOUNT_EDITING_PATTERN = /^-?(?:\d+|[1-9]\d{0,2}(?:,\d{3})*(?:,\d{0,3})?)$/;

export function isAmountText(input: unknown): input is string {
  return typeof input === 'string' && AMOUNT_TEXT_PATTERN.test(input);
}

/**
 * Return whether a value is a possible amount while the user is editing.
 * Empty input and a lone leading minus are intentionally accepted as transient
 * states; the submit-time schema rejects both.
 */
export function isAmountTextWhileEditing(input: unknown): input is string {
  if (typeof input !== 'string') {
    return false;
  }
  if (input === '' || input === '-') {
    return true;
  }
  return AMOUNT_EDITING_PATTERN.test(input);
}

/**
 * Parse a valid amount string while preserving range failures for amountSchema.
 */
export function normalizeAmountInput(input: unknown): number | undefined {
  if (typeof input !== 'string' || !isAmountText(input)) {
    return undefined;
  }

  const negative = input.startsWith('-');
  const unsignedValue = negative ? input.slice(1) : input;
  const digits = unsignedValue.replaceAll(',', '');
  const canonicalDigits = digits.replace(/^0+(?=\d)/, '');
  if (
    canonicalDigits.length > AMOUNT_LIMIT_TEXT.length ||
    (canonicalDigits.length === AMOUNT_LIMIT_TEXT.length && canonicalDigits > AMOUNT_LIMIT_TEXT)
  ) {
    return negative ? -(AMOUNT_LIMIT + 1) : AMOUNT_LIMIT + 1;
  }
  const amount = Number(canonicalDigits);
  return negative ? -amount : amount;
}

function preprocessAmount(input: unknown): unknown {
  if (typeof input !== 'string') {
    return input;
  }
  if (DECIMAL_AMOUNT_PATTERN.test(input)) {
    return Number(input);
  }
  return normalizeAmountInput(input);
}

export const amountSchema = z.preprocess(
  preprocessAmount,
  z
    .number({ error: '金額を入力してください。' })
    .int({ error: '金額は整数で入力してください。' })
    .min(-AMOUNT_LIMIT, {
      error: `金額は-${AMOUNT_LIMIT.toLocaleString('ja-JP')}円以上で入力してください。`,
    })
    .max(AMOUNT_LIMIT, {
      error: `金額は${AMOUNT_LIMIT.toLocaleString('ja-JP')}円以下で入力してください。`,
    }),
);

export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_SUPPORTED_YEAR || year > MAX_SUPPORTED_YEAR) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export const occurredOnSchema = z
  .string({ error: '日付を入力してください。' })
  .refine(isCalendarDate, {
    error: `日付は${MIN_SUPPORTED_YEAR}年から${MAX_SUPPORTED_YEAR}年のYYYY-MM-DD形式で入力してください。`,
  });

export const transactionTypeSchema = z.enum(['expense', 'income'], {
  error: '種別を選択してください。',
});

export const categoryIdSchema = z.preprocess(
  (value) => {
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      return Number(value.trim());
    }
    return value;
  },
  z
    .number({ error: 'カテゴリを選択してください。' })
    .int()
    .positive({ error: 'カテゴリを選択してください。' }),
);

export const memoSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() : value),
  z.string({ error: 'メモは文字列で入力してください。' }).max(MEMO_MAX_LENGTH, {
    error: `メモは${MEMO_MAX_LENGTH}文字以内で入力してください。`,
  }),
);

export const accountIdSchema = z.preprocess((value) => {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return value;
}, z.number().int().positive().optional().nullable());

/** Positive integer amount validation used for one-row account transfers. */
export const transferAmountSchema = z.preprocess(
  (input) => {
    if (typeof input !== 'string') {
      return input;
    }
    if (TRANSFER_DECIMAL_AMOUNT_PATTERN.test(input)) {
      const amount = Number(input);
      return Number.isInteger(amount) ? amount + 0.5 : amount;
    }
    return normalizeAmountInput(input);
  },
  z
    .number({ error: '金額を入力してください。' })
    .int({ error: '金額は整数で入力してください。' })
    .min(1, { error: '金額は1円以上で入力してください。' })
    .max(AMOUNT_LIMIT, {
      error: `金額は${AMOUNT_LIMIT.toLocaleString('ja-JP')}円以下で入力してください。`,
    }),
);

function requiredTransferAccountIdSchema(label: string) {
  return z.preprocess(
    (value) => {
      if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
        return Number(value.trim());
      }
      return value;
    },
    z
      .number({ error: `${label}の口座を選択してください。` })
      .int({ error: `${label}の口座を選択してください。` })
      .positive({ error: `${label}の口座を選択してください。` })
      .max(MAX_INT4_ID, { error: '選択した口座は利用できません。' }),
  );
}

export const transferInputSchema = z
  .object({
    fromAccountId: requiredTransferAccountIdSchema('振替元'),
    toAccountId: requiredTransferAccountIdSchema('振替先'),
    amount: transferAmountSchema,
    occurredOn: occurredOnSchema,
    memo: memoSchema,
  })
  .superRefine((value, context) => {
    if (value.fromAccountId === value.toAccountId) {
      context.addIssue({
        code: 'custom',
        path: ['toAccountId'],
        message: '振替元と振替先は別の口座を選択してください。',
      });
    }
  });

export type TransferInput = z.infer<typeof transferInputSchema>;

export function transferInputFromFormData(formData: FormData): Record<string, unknown> {
  return {
    fromAccountId: formData.get('fromAccountId'),
    toAccountId: formData.get('toAccountId'),
    amount: formData.get('amount'),
    occurredOn: formData.get('occurredOn'),
    memo: formData.get('memo') ?? '',
  };
}

export const flattenTransferError = z.flattenError;

export const transactionInputSchema = z.object({
  type: transactionTypeSchema,
  amount: amountSchema,
  occurredOn: occurredOnSchema,
  categoryId: categoryIdSchema,
  accountId: accountIdSchema,
  memo: memoSchema,
});

export type TransactionInput = z.infer<typeof transactionInputSchema> & {
  type: TransactionType;
};

export function categoryIdFromFormData(formData: FormData): unknown {
  const type = formData.get('type');
  const values = formData.getAll('categoryId');
  const index = type === 'income' ? 1 : 0;
  return values[index] ?? values[0] ?? null;
}

export function transactionInputFromFormData(formData: FormData): Record<string, unknown> {
  return {
    type: formData.get('type'),
    amount: formData.get('amount'),
    occurredOn: formData.get('occurredOn'),
    categoryId: categoryIdFromFormData(formData),
    accountId: null,
    memo: formData.get('memo') ?? '',
  };
}
export const flattenTransactionError = z.flattenError;
