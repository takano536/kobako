import { z } from 'zod';

import {
  ACCOUNT_NAME_MAX_LENGTH,
  CATEGORY_NAME_MAX_LENGTH,
  amountSchema,
  memoSchema,
  occurredOnSchema,
  transactionTypeSchema,
} from './validation.js';

export const MAX_ROWS_PER_API_CALL = 500;

const nameField = (label: string, max: number) =>
  z
    .string({ error: `${label}を指定してください。` })
    .trim()
    .min(1, { error: `${label}を指定してください。` })
    .max(max, { error: `${label}が長すぎます。` });

const externalIdField = z
  .string()
  .trim()
  .min(1, { error: 'externalId を空にはできません。' })
  .max(200, { error: 'externalId は200文字までです。' })
  .nullish();

/** A row that creates an entry. Categories and assets are named, never ids. */
export const apiTransactionRowSchema = z.object({
  type: transactionTypeSchema,
  amount: amountSchema,
  occurredOn: occurredOnSchema,
  category: nameField('カテゴリ名', CATEGORY_NAME_MAX_LENGTH),
  account: nameField('資産名', ACCOUNT_NAME_MAX_LENGTH).nullish(),
  memo: memoSchema.optional(),
  externalId: externalIdField,
});

export const apiTransferRowSchema = z.object({
  amount: amountSchema.refine((value) => value > 0, { error: '振替の金額は1円以上です。' }),
  occurredOn: occurredOnSchema,
  from: nameField('振替元の資産名', ACCOUNT_NAME_MAX_LENGTH),
  to: nameField('振替先の資産名', ACCOUNT_NAME_MAX_LENGTH),
  memo: memoSchema.optional(),
  externalId: externalIdField,
});

export const apiWriteBodySchema = z.object({
  label: z.string().trim().max(120).optional(),
  transactions: z.array(apiTransactionRowSchema).max(MAX_ROWS_PER_API_CALL).optional(),
  transfers: z.array(apiTransferRowSchema).max(MAX_ROWS_PER_API_CALL).optional(),
});

export const apiTransferBodySchema = z.object({
  label: z.string().trim().max(120).optional(),
  transfers: z.array(apiTransferRowSchema).min(1).max(MAX_ROWS_PER_API_CALL),
});

/** Partial edit. `account: null` clears the asset, so it is explicitly nullable. */
export const apiTransactionPatchSchema = z.object({
  type: transactionTypeSchema.optional(),
  amount: amountSchema.optional(),
  occurredOn: occurredOnSchema.optional(),
  category: nameField('カテゴリ名', CATEGORY_NAME_MAX_LENGTH).optional(),
  account: z.union([nameField('資産名', ACCOUNT_NAME_MAX_LENGTH), z.null()]).optional(),
  memo: memoSchema.optional(),
});

export const apiTransferPatchSchema = z.object({
  amount: amountSchema
    .refine((value) => value > 0, { error: '振替の金額は1円以上です。' })
    .optional(),
  occurredOn: occurredOnSchema.optional(),
  from: nameField('振替元の資産名', ACCOUNT_NAME_MAX_LENGTH).optional(),
  to: nameField('振替先の資産名', ACCOUNT_NAME_MAX_LENGTH).optional(),
  memo: memoSchema.optional(),
});

export type ApiWriteBody = z.infer<typeof apiWriteBodySchema>;
export type ApiTransactionRow = z.infer<typeof apiTransactionRowSchema>;
export type ApiTransferRowInput = z.infer<typeof apiTransferRowSchema>;
export type ApiTransactionPatch = z.infer<typeof apiTransactionPatchSchema>;
export type ApiTransferPatch = z.infer<typeof apiTransferPatchSchema>;
export type ApiIssue = { field: string; message: string };
export type ApiValidationError = { issues: ApiIssue[] };

export function toApiIssues(error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): ApiIssue[] {
  return error.issues.map((issue) => ({
    field: issue.path.map((part) => String(part)).join('.'),
    message: issue.message,
  }));
}
