'use server';

import {
  convertTransactionToTransfer,
  convertTransferToTransaction,
  createTransaction,
  createTransfer,
  deleteTransaction,
  deleteTransfer,
  getCategory,
  updateTransaction,
  updateTransfer,
} from '@kobako/db';
import {
  flattenTransactionError,
  flattenTransferError,
  transactionInputFromFormData,
  transactionInputSchema,
  transferInputFromFormData,
  transferInputSchema,
} from '@kobako/db/validation';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';

import { getCurrentHouseholdId, getLedgerDatabase } from '../../src/lib/ledger-data';
import { parseInt4Id } from '../../src/lib/ids';
import {
  transferValidationErrors,
  transactionFormValuesFromFormData,
  type DeleteFormState,
  type TransactionFieldErrors,
  type TransactionFormState,
  type TransactionFormValues,
} from '../../src/lib/transaction-form';
import type { TransactionInput } from '@kobako/db/validation';

type EntryKind = 'transaction' | 'transfer';

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
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
function transferResultState(
  values: TransactionFormValues,
  code: Parameters<typeof transferValidationErrors>[0],
): TransactionFormState {
  return validationState(values, transferValidationErrors(code));
}

function revalidateLedger(): void {
  revalidatePath('/');
  revalidatePath('/transactions');
  revalidatePath('/balances');
}

function redirectToMonth(month: string): never {
  revalidateLedger();
  redirect(`/transactions?month=${month}`);
}

export async function createTransactionAction(
  previousState: TransactionFormState,
  formData: FormData,
): Promise<TransactionFormState> {
  void previousState;
  const values = transactionFormValuesFromFormData(formData);
  const householdId = getCurrentHouseholdId();
  const db = getLedgerDatabase();

  if (values.type === 'transfer') {
    const parsed = transferInputSchema.safeParse(transferInputFromFormData(formData));
    if (!parsed.success) {
      return validationState(
        values,
        flattenTransferError(parsed.error).fieldErrors as TransactionFieldErrors,
      );
    }
    let result;
    try {
      result = await createTransfer(db, householdId, parsed.data);
    } catch (error) {
      return databaseFailure('create-transfer', error);
    }
    if (result.status === 'validation_error') {
      return transferResultState(values, result.code);
    }
    if (result.status === 'error') {
      return databaseFailure('create-transfer', new Error('database operation failed'));
    }
    redirectToMonth(parsed.data.occurredOn.slice(0, 7));
  }

  const parsed = transactionInputSchema.safeParse(transactionInputFromFormData(formData));
  if (!parsed.success) {
    return validationState(
      values,
      flattenTransactionError(parsed.error).fieldErrors as TransactionFieldErrors,
    );
  }
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
    await createTransaction(db, householdId, parsed.data);
  } catch (error) {
    return databaseFailure('create', error);
  }
  redirectToMonth(parsed.data.occurredOn.slice(0, 7));
}

export async function updateTransactionAction(
  transactionId: string,
  sourceKind: EntryKind,
  previousState: TransactionFormState,
  formData: FormData,
): Promise<TransactionFormState> {
  void previousState;
  const id = parseInt4Id(transactionId);
  if (id === undefined) {
    notFound();
  }

  const values = transactionFormValuesFromFormData(formData);
  const householdId = getCurrentHouseholdId();
  const db = getLedgerDatabase();

  if (values.type === 'transfer') {
    const parsed = transferInputSchema.safeParse(transferInputFromFormData(formData));
    if (!parsed.success) {
      return validationState(
        values,
        flattenTransferError(parsed.error).fieldErrors as TransactionFieldErrors,
      );
    }
    let result;
    try {
      result =
        sourceKind === 'transfer'
          ? await updateTransfer(db, householdId, id, parsed.data)
          : await convertTransactionToTransfer(db, householdId, id, parsed.data);
    } catch (error) {
      return databaseFailure('update-transfer', error);
    }
    if (result.status === 'not_found') {
      notFound();
    }
    if (result.status === 'validation_error') {
      return transferResultState(values, result.code);
    }
    if (result.status === 'error') {
      return databaseFailure('update-transfer', new Error('database operation failed'));
    }
    redirectToMonth(parsed.data.occurredOn.slice(0, 7));
  }

  const parsed = transactionInputSchema.safeParse(transactionInputFromFormData(formData));
  if (!parsed.success) {
    return validationState(
      values,
      flattenTransactionError(parsed.error).fieldErrors as TransactionFieldErrors,
    );
  }

  if (sourceKind === 'transfer') {
    let result;
    try {
      result = await convertTransferToTransaction(db, householdId, id, parsed.data);
    } catch (error) {
      return databaseFailure('update-transaction', error);
    }
    if (result.status === 'not_found') {
      notFound();
    }
    if (result.status === 'validation_error') {
      return validationState(values, {
        categoryId: ['種別に合うカテゴリを選択してください。'],
      });
    }
    if (result.status === 'error') {
      return databaseFailure('update-transaction', new Error('database operation failed'));
    }
    redirectToMonth(parsed.data.occurredOn.slice(0, 7));
  }

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
    updated = await updateTransaction(db, householdId, id, parsed.data);
  } catch (error) {
    return databaseFailure('update', error);
  }
  if (!updated) {
    notFound();
  }
  redirectToMonth(parsed.data.occurredOn.slice(0, 7));
}

export async function deleteTransactionAction(
  entryType: EntryKind,
  previousState: DeleteFormState,
  formData: FormData,
): Promise<DeleteFormState> {
  void previousState;
  const id = parseInt4Id(textField(formData, 'id'));
  if (id === undefined) {
    notFound();
  }
  if (textField(formData, 'confirm') !== 'delete') {
    return { message: '削除する場合は確認操作を完了してください。' };
  }

  const householdId = getCurrentHouseholdId();
  const db = getLedgerDatabase();

  if (entryType === 'transfer') {
    let deletedTransfer;
    try {
      deletedTransfer = await deleteTransfer(db, householdId, id);
    } catch (error) {
      const errorType = error instanceof Error ? error.name : 'UnknownError';
      console.error('[transactions/delete] database operation failed', { errorType });
      return { message: '削除できませんでした。時間をおいてもう一度お試しください。' };
    }
    if (deletedTransfer.status === 'not_found') {
      notFound();
    }
    if (deletedTransfer.status === 'error') {
      return { message: '削除できませんでした。時間をおいてもう一度お試しください。' };
    }
    redirectToMonth(deletedTransfer.occurredOn.slice(0, 7));
  }

  let deletedTransaction;
  try {
    deletedTransaction = await deleteTransaction(db, householdId, id);
  } catch (error) {
    const errorType = error instanceof Error ? error.name : 'UnknownError';
    console.error('[transactions/delete] database operation failed', { errorType });
    return { message: '削除できませんでした。時間をおいてもう一度お試しください。' };
  }
  if (!deletedTransaction) {
    notFound();
  }
  redirectToMonth(deletedTransaction.occurredOn.slice(0, 7));
}
