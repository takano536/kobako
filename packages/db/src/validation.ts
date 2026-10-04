import { z } from 'zod';

import { MAX_SUPPORTED_YEAR, MIN_SUPPORTED_YEAR } from './month.js';
import { AMOUNT_LIMIT, AMOUNT_LIMIT_TEXT, AMOUNT_TEXT_PATTERN } from './amount.js';
import type { TransactionType } from './schema.js';

export { AMOUNT_FORMAT_MESSAGE, AMOUNT_LIMIT, AMOUNT_TEXT_PATTERN_SOURCE } from './amount.js';

export const ACCOUNT_NAME_MAX_LENGTH = 120;
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
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return undefined;
    }
    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed);
    }
  }
  return value;
}, z.number().int().positive().max(MAX_INT4_ID).optional().nullable());

export const requiredAccountIdSchema = z.preprocess((value) => {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return value;
}, z.number().int().positive().max(MAX_INT4_ID));
export const accountKindSchema = z.enum(
  ['cash', 'bank', 'credit_card', 'debit_card', 'electronic_money', 'other'] as const,
  { error: '資産の種類を選択してください。' },
);

export const accountStatusSchema = z.enum(['active', 'closed'] as const, {
  error: '資産の状態を選択してください。',
});

export const cardPaymentMonthOffsetSchema = z.enum(
  ['same_month', 'next_month', 'two_months_later'] as const,
  { error: '支払月を選択してください。' },
);

function containsAccountControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}
function accountTextSchema(label: string, maxLength: number) {
  return z
    .string({ error: `${label}を入力してください。` })
    .trim()
    .min(1, { error: `${label}を入力してください。` })
    .max(maxLength, { error: `${label}は${maxLength}文字以内で入力してください。` })
    .refine((value) => !containsAccountControlCharacter(value), {
      error: `${label}に制御文字は使えません。`,
    });
}

export const accountNameSchema = accountTextSchema('資産名', ACCOUNT_NAME_MAX_LENGTH);

export const accountCreateInputSchema = z.object({
  name: accountNameSchema,
  kind: accountKindSchema,
});

export const accountUpdateInputSchema = z.object({
  name: accountNameSchema,
  kind: accountKindSchema,
  status: accountStatusSchema.optional(),
  expectedKind: accountKindSchema.optional(),
  confirmKindChange: z.boolean().default(false),
});

export const accountCardConditionInputSchema = z.object({
  closingDay: z
    .string()
    .regex(/^(?:[1-9]|[12]\d|3[01]|last)$/, { error: '締め日を選択してください。' })
    .nullable()
    .optional(),
  paymentDay: z
    .string()
    .regex(/^(?:[1-9]|[12]\d|3[01]|last)$/, { error: '支払日を選択してください。' })
    .nullable()
    .optional(),
  paymentMonthOffset: cardPaymentMonthOffsetSchema.nullable().optional(),
  debitAccountId: accountIdSchema,
});

export type AccountKindInput = z.infer<typeof accountKindSchema>;
export type AccountStatusInput = z.infer<typeof accountStatusSchema>;
export type CardPaymentMonthOffsetInput = z.infer<typeof cardPaymentMonthOffsetSchema>;
export type AccountCreateInput = z.infer<typeof accountCreateInputSchema>;
export type AccountUpdateInput = z.infer<typeof accountUpdateInputSchema>;
export type AccountCardConditionInput = z.infer<typeof accountCardConditionInputSchema>;

export function isLiabilityKind(kind: AccountKindInput): boolean {
  return kind === 'credit_card';
}

export function requiresKindInterpretationConfirmation(
  previousKind: AccountKindInput,
  nextKind: AccountKindInput,
  rawBalance: string | number | bigint,
): boolean {
  if (previousKind === nextKind) {
    return false;
  }
  if (previousKind === 'credit_card' || nextKind === 'credit_card') {
    return true;
  }
  const raw = BigInt(rawBalance);
  const previousLiability = previousKind === 'other' && raw < 0n;
  const nextLiability = nextKind === 'other' && raw < 0n;
  return previousLiability !== nextLiability;
}

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
      .number({ error: `${label}の資産を選択してください。` })
      .int({ error: `${label}の資産を選択してください。` })
      .positive({ error: `${label}の資産を選択してください。` })
      .max(MAX_INT4_ID, { error: '選択した資産は利用できません。' }),
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
        message: '振替元と振替先は別の資産を選択してください。',
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
  const type = formData.get('type');
  return {
    type,
    amount: formData.get('amount'),
    occurredOn: formData.get('occurredOn'),
    categoryId: categoryIdFromFormData(formData),
    accountId: type === 'transfer' ? undefined : formData.get('accountId'),
    memo: formData.get('memo') ?? '',
  };
}
export const flattenTransactionError = z.flattenError;
