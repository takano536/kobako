'use server';

import { createTransfer, deleteTransfer, updateTransfer } from '@kobako/db';
import {
  flattenTransferError,
  transferInputFromFormData,
  transferInputSchema,
} from '@kobako/db/validation';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';

import { getCurrentHouseholdId, getLedgerDatabase } from '../../../src/lib/ledger-data';
import { parseInt4Id } from '../../../src/lib/ids';
import type {
  DeleteTransferFormState,
  TransferFieldErrors,
  TransferFormState,
  TransferFormValues,
} from '../../../src/lib/transfer-form';

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function formValues(formData: FormData): TransferFormValues {
  return {
    fromAccountId: textField(formData, 'fromAccountId'),
    toAccountId: textField(formData, 'toAccountId'),
    amount: textField(formData, 'amount'),
    occurredOn: textField(formData, 'occurredOn'),
    memo: textField(formData, 'memo'),
  };
}

function validationState(
  values: TransferFormValues,
  errors: TransferFieldErrors,
): TransferFormState {
  return {
    values,
    errors,
    message: '入力内容を確認してください。',
  };
}

function databaseFailure(action: string, error: unknown): TransferFormState {
  const errorType = error instanceof Error ? error.name : 'UnknownError';
  console.error(`[transfers/${action}] database operation failed`, { errorType });
  return { message: '保存できませんでした。時間をおいてもう一度お試しください。' };
}

function resultValidationState(
  values: TransferFormValues,
  code: 'account_unavailable' | 'same_account',
): TransferFormState {
  if (code === 'same_account') {
    return validationState(values, {
      toAccountId: ['振替元と振替先は別の口座を選択してください。'],
    });
  }
  return validationState(values, {
    fromAccountId: ['選択した口座は利用できません。'],
    toAccountId: ['選択した口座は利用できません。'],
  });
}

export async function createTransferAction(
  previousState: TransferFormState,
  formData: FormData,
): Promise<TransferFormState> {
  void previousState;
  const values = formValues(formData);
  const parsed = transferInputSchema.safeParse(transferInputFromFormData(formData));
  if (!parsed.success) {
    return validationState(
      values,
      flattenTransferError(parsed.error).fieldErrors as TransferFieldErrors,
    );
  }

  const result = await createTransfer(getLedgerDatabase(), getCurrentHouseholdId(), parsed.data);
  if (result.status === 'validation_error') {
    return resultValidationState(values, result.code);
  }
  if (result.status !== 'ok') {
    return databaseFailure('create', result);
  }

  const month = result.transfer.occurredOn.slice(0, 7);
  revalidatePath('/');
  revalidatePath('/transactions');
  redirect(`/transactions?month=${month}`);
}

export async function updateTransferAction(
  transferId: string,
  previousState: TransferFormState,
  formData: FormData,
): Promise<TransferFormState> {
  void previousState;
  const id = parseInt4Id(transferId);
  if (id === undefined) {
    notFound();
  }

  const values = formValues(formData);
  const parsed = transferInputSchema.safeParse(transferInputFromFormData(formData));
  if (!parsed.success) {
    return validationState(
      values,
      flattenTransferError(parsed.error).fieldErrors as TransferFieldErrors,
    );
  }

  const result = await updateTransfer(
    getLedgerDatabase(),
    getCurrentHouseholdId(),
    id,
    parsed.data,
  );
  if (result.status === 'validation_error') {
    return resultValidationState(values, result.code);
  }
  if (result.status === 'not_found') {
    return { values, message: '振替が見つかりません。' };
  }
  if (result.status !== 'ok') {
    return databaseFailure('update', result);
  }

  const month = result.transfer.occurredOn.slice(0, 7);
  revalidatePath('/');
  revalidatePath('/transactions');
  redirect(`/transactions?month=${month}`);
}

export async function deleteTransferAction(
  previousState: DeleteTransferFormState,
  formData: FormData,
): Promise<DeleteTransferFormState> {
  void previousState;
  const id = parseInt4Id(textField(formData, 'id'));
  if (id === undefined) {
    notFound();
  }
  if (textField(formData, 'confirm') !== 'delete') {
    return { message: '削除する場合は確認操作を完了してください。' };
  }

  const result = await deleteTransfer(getLedgerDatabase(), getCurrentHouseholdId(), id);
  if (result.status === 'not_found') {
    return { message: '振替が見つかりません。' };
  }
  if (result.status !== 'ok') {
    const errorType = result.status;
    console.error('[transfers/delete] database operation failed', { errorType });
    return { message: '削除できませんでした。時間をおいてもう一度お試しください。' };
  }

  revalidatePath('/');
  revalidatePath('/transactions');
  redirect(`/transactions?month=${result.occurredOn.slice(0, 7)}`);
}
