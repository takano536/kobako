import { z } from 'zod';

import { MAX_SUPPORTED_YEAR, MIN_SUPPORTED_YEAR } from './month.js';
import type { TransactionType } from './schema.js';
export const AMOUNT_LIMIT = 999_999_999;
export const MEMO_MAX_LENGTH = 200;
const AMOUNT_LIMIT_TEXT = String(AMOUNT_LIMIT);

const fullWidthDigitOffset = '０'.codePointAt(0) ?? 0;

function normalizeFullWidthDigits(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= fullWidthDigitOffset && codePoint <= fullWidthDigitOffset + 9
      ? String(codePoint - fullWidthDigitOffset)
      : character;
  }).join('');
}

/**
 * Normalize accepted JPY input without ever accepting a decimal.
 * Full-width digits/commas and one optional leading yen sign are accepted.
 * A yen sign must touch the first digit; surrounding whitespace is accepted.
 */
export function normalizeAmountInput(input: unknown): number | undefined {
  if (typeof input !== 'string') {
    return undefined;
  }

  let value = input.trim();
  if (value.startsWith('¥') || value.startsWith('￥')) {
    value = value.slice(1);
  }

  value = normalizeFullWidthDigits(value)
    .replaceAll('，', ',')
    .replaceAll('−', '-')
    .replaceAll('－', '-');
  const negative = value.startsWith('-');
  const unsignedValue = negative ? value.slice(1) : value;
  if (!unsignedValue || !/^(?:\d+|[1-9]\d{0,2}(?:,\d{3})+)$/.test(unsignedValue)) {
    return undefined;
  }

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

  const decimalCandidate = normalizeFullWidthDigits(input.trim())
    .replaceAll('，', ',')
    .replaceAll('．', '.')
    .replaceAll(',', '');
  if (/^-?(?:\d+\.\d*|\.\d+)$/.test(decimalCandidate)) {
    return Number(decimalCandidate);
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

export const transactionInputSchema = z.object({
  type: transactionTypeSchema,
  amount: amountSchema,
  occurredOn: occurredOnSchema,
  categoryId: categoryIdSchema,
  memo: memoSchema,
});

export type TransactionInput = z.infer<typeof transactionInputSchema> & {
  type: TransactionType;
};

export function transactionInputFromFormData(formData: FormData): Record<string, unknown> {
  return {
    type: formData.get('type'),
    amount: formData.get('amount'),
    occurredOn: formData.get('occurredOn'),
    categoryId: formData.get('categoryId'),
    memo: formData.get('memo') ?? '',
  };
}
export const flattenTransactionError = z.flattenError;
