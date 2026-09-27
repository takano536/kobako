'use server';

import { createTransaction, deleteTransaction, getCategory, updateTransaction } from '@kobako/db';
import {
  flattenTransactionError,
  transactionInputFromFormData,
  transactionInputSchema,
} from '@kobako/db/validation';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';

import { getCurrentHouseholdId, getLedgerDatabase } from '../../src/lib/ledger-data';
import { parseInt4Id } from '../../src/lib/ids';
import type { TransactionInput } from '@kobako/db/validation';
import type {
  DeleteFormState,
  TransactionFieldErrors,
  TransactionFormState,
  TransactionFormValues,
} from '../../src/lib/transaction-form';

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function formValues(formData: FormData): TransactionFormValues {
  return {
    type: textField(formData, 'type'),
    amount: textField(formData, 'amount'),
    occurredOn: textField(formData, 'occurredOn'),
    categoryId: textField(formData, 'categoryId'),
    memo: textField(formData, 'memo'),
  };
}

function validationState(
  values: TransactionFormValues,
  errors: TransactionFieldErrors,
): TransactionFormState {
  return {
    values,
    errors,
    message: '入力内容を確認してください。',
  };
}

function databaseFailure(action: string, error: unknown): TransactionFormState {
  const errorType = error instanceof Error ? error.name : 'UnknownError';
  console.error(`[transactions/${action}] database operation failed`, { errorType });
  return { message: '保存できませんでした。時間をおいてもう一度お試しください。' };
}

async function validateCategory(input: TransactionInput, householdId: string): Promise<boolean> {
  const category = await getCategory(
    getLedgerDatabase(),
    householdId,
    input.categoryId,
    input.type,
  );
  return category !== null;
}

export async function createTransactionAction(
  previousState: TransactionFormState,
  formData: FormData,
): Promise<TransactionFormState> {
  void previousState;
  const values = formValues(formData);
  const parsed = transactionInputSchema.safeParse(transactionInputFromFormData(formData));
  if (!parsed.success) {
    return validationState(
      values,
      flattenTransactionError(parsed.error).fieldErrors as TransactionFieldErrors,
    );
  }

  const householdId = getCurrentHouseholdId();
  let categoryMatches: boolean;
  try {
    categoryMatches = await validateCategory(parsed.data, householdId);
  } catch (error) {
    return databaseFailure('create', error);
  }
  if (!categoryMatches) {
    return validationState(values, { categoryId: ['種別に合うカテゴリを選択してください。'] });
  }

  try {
    await createTransaction(getLedgerDatabase(), householdId, parsed.data);
  } catch (error) {
    return databaseFailure('create', error);
  }

  const month = parsed.data.occurredOn.slice(0, 7);
  revalidatePath('/');
  revalidatePath('/transactions');
  redirect(`/transactions?month=${month}`);
}

export async function updateTransactionAction(
  transactionId: string,
  previousState: TransactionFormState,
  formData: FormData,
): Promise<TransactionFormState> {
  void previousState;
  const id = parseInt4Id(transactionId);
  if (id === undefined) {
    notFound();
  }

  const values = formValues(formData);
  const parsed = transactionInputSchema.safeParse(transactionInputFromFormData(formData));
  if (!parsed.success) {
    return validationState(
      values,
      flattenTransactionError(parsed.error).fieldErrors as TransactionFieldErrors,
    );
  }

  const householdId = getCurrentHouseholdId();
  let categoryMatches: boolean;
  try {
    categoryMatches = await validateCategory(parsed.data, householdId);
  } catch (error) {
    return databaseFailure('update', error);
  }
  if (!categoryMatches) {
    return validationState(values, { categoryId: ['種別に合うカテゴリを選択してください。'] });
  }

  let updated;
  try {
    updated = await updateTransaction(getLedgerDatabase(), householdId, id, parsed.data);
  } catch (error) {
    return databaseFailure('update', error);
  }
  if (!updated) {
    notFound();
  }

  const month = parsed.data.occurredOn.slice(0, 7);
  revalidatePath('/');
  revalidatePath('/transactions');
  redirect(`/transactions?month=${month}`);
}

export async function deleteTransactionAction(
  previousState: DeleteFormState,
  formData: FormData,
): Promise<DeleteFormState> {
  void previousState;
  const idText = textField(formData, 'id');
  const id = parseInt4Id(idText);
  if (id === undefined) {
    notFound();
  }
  if (textField(formData, 'confirm') !== 'delete') {
    return { message: '削除する場合は確認操作を完了してください。' };
  }
  let deleted;
  try {
    deleted = await deleteTransaction(getLedgerDatabase(), getCurrentHouseholdId(), id);
  } catch (error) {
    const errorType = error instanceof Error ? error.name : 'UnknownError';
    console.error('[transactions/delete] database operation failed', { errorType });
    return { message: '削除できませんでした。時間をおいてもう一度お試しください。' };
  }
  if (!deleted) {
    notFound();
  }

  revalidatePath('/');
  revalidatePath('/transactions');
  redirect(`/transactions?month=${deleted.occurredOn.slice(0, 7)}`);
}
