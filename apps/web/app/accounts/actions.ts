'use server';

import {
  accountCardConditionInputSchema,
  accountCreateInputSchema,
  accountUpdateInputSchema,
} from '@kobako/db/validation';
import { createAccount, deleteAccount, updateAccount } from '@kobako/db';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';

import {
  transactionReturnWithSaved,
  validatedTransactionReturn,
} from '../../src/lib/transaction-query';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../src/lib/ledger-data';
import { parseInt4Id } from '../../src/lib/ids';
import type { AccountFormState } from './account-form';
import type { DeleteFormState } from '../../src/lib/transaction-form';

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function accountState(formData: FormData, message?: string): AccountFormState {
  return {
    values: {
      name: text(formData, 'name'),
      kind: text(formData, 'kind'),
      expectedKind: text(formData, 'expectedKind'),
      closingDay: text(formData, 'closingDay'),
      paymentDay: text(formData, 'paymentDay'),
      paymentMonthOffset: text(formData, 'paymentMonthOffset'),
      debitAccountId: text(formData, 'debitAccountId'),
    },
    message,
  };
}

function validationState(
  formData: FormData,
  error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] },
): AccountFormState {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? 'form');
    fieldErrors[field] = [...(fieldErrors[field] ?? []), issue.message];
  }
  return { ...accountState(formData), fieldErrors };
}

interface CardInput {
  closingDay: string | null;
  paymentDay: string | null;
  paymentMonthOffset: string | null;
  debitAccountId: string | null;
}

function revalidateAssets(accountId?: number): void {
  revalidatePath('/balances');
  revalidatePath('/transactions');
  revalidatePath('/');
  revalidatePath('/accounts/new');
  if (accountId !== undefined) revalidatePath(`/accounts/${accountId}/edit`);
}

function cardInput(formData: FormData): CardInput {
  return {
    closingDay: text(formData, 'closingDay') || null,
    paymentDay: text(formData, 'paymentDay') || null,
    paymentMonthOffset: text(formData, 'paymentMonthOffset') || null,
    debitAccountId: text(formData, 'debitAccountId') || null,
  };
}

function hasCardInput(input: CardInput): boolean {
  return Object.values(input).some((value) => value !== null);
}

function accountReturnPath(formData: FormData, accountId: number): string {
  return validatedTransactionReturn(text(formData, 'return'), accountId) ?? '/balances';
}

export async function createAccountAction(
  previousState: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  void previousState;
  const parsed = accountCreateInputSchema.safeParse({
    name: text(formData, 'name'),
    kind: text(formData, 'kind'),
  });
  if (!parsed.success) return validationState(formData, parsed.error);
  const parsedCard =
    parsed.data.kind === 'credit_card' && hasCardInput(cardInput(formData))
      ? accountCardConditionInputSchema.safeParse(cardInput(formData))
      : undefined;
  if (parsedCard && !parsedCard.success) return validationState(formData, parsedCard.error);
  const db = getLedgerDatabase();
  const householdId = getCurrentHouseholdId();
  const result = await createAccount(
    db,
    householdId,
    parsed.data,
    parsedCard?.success ? parsedCard.data : undefined,
  );
  if (
    result.status === 'invalid_debit_account' ||
    result.status === 'not_card' ||
    (parsedCard?.success && result.status === 'error')
  ) {
    return { ...accountState(formData), message: 'カード条件を保存できませんでした。' };
  }
  if (result.status !== 'ok') {
    return { ...accountState(formData), message: '資産を保存できませんでした。' };
  }
  revalidateAssets(result.account.id);
  redirect(`/transactions?account=${result.account.id}&month=all`);
}

export async function updateAccountAction(
  accountId: string,
  previousState: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  void previousState;
  const id = parseInt4Id(accountId);
  if (id === undefined) notFound();
  const parsed = accountUpdateInputSchema.safeParse({
    name: text(formData, 'name'),
    kind: text(formData, 'kind'),
    expectedKind: text(formData, 'expectedKind') || undefined,
  });
  if (!parsed.success) return validationState(formData, parsed.error);
  const parsedCard =
    parsed.data.kind === 'credit_card'
      ? accountCardConditionInputSchema.safeParse(cardInput(formData))
      : undefined;
  if (parsedCard && !parsedCard.success) return validationState(formData, parsedCard.error);
  const db = getLedgerDatabase();
  const householdId = getCurrentHouseholdId();
  const result = await updateAccount(
    db,
    householdId,
    id,
    parsed.data,
    parsedCard?.success ? parsedCard.data : undefined,
  );
  if (result.status === 'not_found') notFound();
  if (result.status === 'deleted') {
    return { ...accountState(formData), message: '資産は削除済みのため保存できません。' };
  }
  if (result.status === 'stale_kind') {
    return {
      ...accountState(formData),
      message: '別の画面で資産カテゴリが変更されました。再読み込みしてください。',
    };
  }
  if (
    result.status === 'invalid_debit_account' ||
    result.status === 'not_card' ||
    (parsedCard?.success && result.status === 'error')
  ) {
    return { ...accountState(formData), message: 'カード条件を保存できませんでした。' };
  }
  if (result.status !== 'ok') {
    return { ...accountState(formData), message: '資産を保存できませんでした。' };
  }
  revalidateAssets(id);
  redirect(transactionReturnWithSaved(accountReturnPath(formData, id)));
}

export async function deleteAccountAction(
  previousState: DeleteFormState,
  formData: FormData,
): Promise<DeleteFormState> {
  void previousState;
  const id = parseInt4Id(text(formData, 'accountId'));
  if (id === undefined) notFound();
  if (text(formData, 'confirm') !== 'delete') {
    return { message: '削除する場合は確認操作を完了してください。' };
  }
  const result = await deleteAccount(getLedgerDatabase(), getCurrentHouseholdId(), id);
  if (result.status === 'not_found') {
    return { message: '資産を削除できませんでした。' };
  }
  if (result.status === 'error') {
    return { message: '削除できませんでした。時間をおいてもう一度お試しください。' };
  }
  revalidateAssets(id);
  redirect('/balances');
}
