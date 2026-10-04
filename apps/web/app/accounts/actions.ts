'use server';

import {
  createAccount,
  deleteAccount,
  createAccountGroup,
  deleteAccountGroup,
  renameAccountGroup,
  reorderAccountGroups,
  reorderAccounts,
  updateAccount,
} from '@kobako/db';
import {
  accountCreateInputSchema,
  accountGroupInputSchema,
  accountUpdateInputSchema,
} from '@kobako/db/validation';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';

import {
  transactionReturnWithSaved,
  validatedTransactionReturn,
} from '../../src/lib/transaction-query';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../src/lib/ledger-data';
import { parseInt4Id } from '../../src/lib/ids';
import type { AccountFormState } from './account-form';

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function referenceKinds(references: {
  transactions: number;
  transfers: number;
  importMappings: number;
  debitAccounts: number;
}): string {
  return [
    references.transactions > 0 ? '取引' : '',
    references.transfers > 0 ? '振替' : '',
    references.importMappings > 0 ? '取り込み履歴' : '',
    references.debitAccounts > 0 ? 'カードの引き落とし口座' : '',
  ]
    .filter(Boolean)
    .join('・');
}

function accountReturnPath(formData: FormData, accountId: number): string {
  return (
    validatedTransactionReturn(text(formData, 'return'), accountId) ??
    `/transactions?account=${accountId}&month=all`
  );
}

function interpretation(kind: string, rawBalance: string): string {
  const raw = BigInt(rawBalance);
  const liability = kind === 'credit_card' || (kind === 'other' && raw < 0n);
  return `${liability ? '負債' : '資産'}・${rawBalance}円`;
}

function accountState(formData: FormData, message?: string): AccountFormState {
  return {
    values: {
      name: text(formData, 'name'),
      kind: text(formData, 'kind'),
      groupId: text(formData, 'groupId'),
      status: text(formData, 'status') || 'active',
      expectedKind: text(formData, 'expectedKind'),
      confirmKindChange: formData.get('confirmKindChange') === 'on',
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

function revalidateAccounts(): void {
  revalidatePath('/accounts');
  revalidatePath('/accounts/new');
  revalidatePath('/balances');
  revalidatePath('/transactions');
  revalidatePath('/');
}

export async function createAccountAction(
  previousState: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  void previousState;
  const parsed = accountCreateInputSchema.safeParse({
    name: text(formData, 'name'),
    kind: text(formData, 'kind'),
    groupId: text(formData, 'groupId') || undefined,
  });
  if (!parsed.success) {
    return validationState(formData, parsed.error);
  }
  const result = await createAccount(getLedgerDatabase(), getCurrentHouseholdId(), parsed.data);
  if (result.status === 'group_unavailable') {
    return { ...accountState(formData), message: 'グループを確認できませんでした。' };
  }
  if (result.status !== 'ok') {
    return { ...accountState(formData), message: '口座を保存できませんでした。' };
  }
  revalidateAccounts();
  redirect('/accounts');
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
    groupId: text(formData, 'groupId'),
    status: text(formData, 'status'),
    expectedKind: text(formData, 'expectedKind') || undefined,
    confirmKindChange: formData.get('confirmKindChange') === 'on',
  });
  if (!parsed.success) {
    return validationState(formData, parsed.error);
  }
  const result = await updateAccount(getLedgerDatabase(), getCurrentHouseholdId(), id, parsed.data);
  if (result.status === 'not_found') notFound();
  if (result.status === 'kind_confirmation_required') {
    const cardConditionsHidden =
      result.previousKind === 'credit_card' && parsed.data.kind !== 'credit_card'
        ? 'カード条件は保持されますが、クレジットカードに戻すまで非表示です。'
        : '';
    return {
      ...accountState(formData),
      message: `残高は${result.rawBalance}円です。変更前: ${interpretation(result.previousKind, result.rawBalance)}、変更後: ${interpretation(parsed.data.kind, result.rawBalance)}。${cardConditionsHidden}種類を変更すると集計上の意味が変わるため、確認して保存してください。`,
      requiresKindConfirmation: true,
    };
  }
  if (result.status === 'stale_kind') {
    return {
      ...accountState(formData),
      message: '別の画面で種類が変更されました。画面を再読み込みしてください。',
    };
  }
  if (result.status === 'group_unavailable') {
    return { ...accountState(formData), message: 'グループを確認できませんでした。' };
  }
  if (result.status !== 'ok') {
    return { ...accountState(formData), message: '口座を保存できませんでした。' };
  }
  revalidateAccounts();
  redirect(transactionReturnWithSaved(accountReturnPath(formData, id)));
}

export async function deleteAccountAction(formData: FormData): Promise<void> {
  const id = parseInt4Id(text(formData, 'accountId'));
  if (id === undefined) notFound();
  if (text(formData, 'confirm') !== 'delete') return;
  const result = await deleteAccount(getLedgerDatabase(), getCurrentHouseholdId(), id);
  if (result.status === 'referenced') {
    const references = referenceKinds(result.references);
    redirect(`/accounts?error=account_referenced&references=${encodeURIComponent(references)}`);
  }
  if (result.status === 'not_found' || result.status === 'error') {
    redirect('/accounts?error=account_delete_failed');
  }
  revalidateAccounts();
  redirect('/accounts');
}

export async function createAccountGroupAction(formData: FormData): Promise<void> {
  const parsed = accountGroupInputSchema.safeParse({ name: text(formData, 'name') });
  if (!parsed.success) return;
  const result = await createAccountGroup(
    getLedgerDatabase(),
    getCurrentHouseholdId(),
    parsed.data,
  );
  if (result.status === 'ok') {
    revalidateAccounts();
    redirect('/accounts');
  }
}

export async function renameAccountGroupAction(formData: FormData): Promise<void> {
  const id = parseInt4Id(text(formData, 'groupId'));
  if (id === undefined) notFound();
  const parsed = accountGroupInputSchema.safeParse({ name: text(formData, 'name') });
  if (!parsed.success) return;
  const result = await renameAccountGroup(
    getLedgerDatabase(),
    getCurrentHouseholdId(),
    id,
    parsed.data,
  );
  if (result.status === 'ok') {
    revalidateAccounts();
    redirect('/accounts');
  }
}
export async function reorderAccountGroupsAction(formData: FormData): Promise<void> {
  const orderedIds = formData.getAll('orderedIds').flatMap((value) => {
    const parsed = parseInt4Id(typeof value === 'string' ? value : '');
    return parsed === undefined ? [] : [parsed];
  });
  const result = await reorderAccountGroups(
    getLedgerDatabase(),
    getCurrentHouseholdId(),
    orderedIds,
  );
  if (result.status === 'ok') {
    revalidateAccounts();
    redirect('/accounts');
  }
}
export async function reorderAccountsAction(formData: FormData): Promise<void> {
  const groupId = parseInt4Id(text(formData, 'groupId'));
  if (groupId === undefined) notFound();
  const orderedIds = formData.getAll('orderedIds').flatMap((value) => {
    const parsed = parseInt4Id(typeof value === 'string' ? value : '');
    return parsed === undefined ? [] : [parsed];
  });
  const result = await reorderAccounts(
    getLedgerDatabase(),
    getCurrentHouseholdId(),
    groupId,
    orderedIds,
  );
  if (result.status === 'ok') {
    revalidateAccounts();
    redirect('/accounts');
  }
}

export async function deleteAccountGroupAction(formData: FormData): Promise<void> {
  const id = parseInt4Id(text(formData, 'groupId'));
  if (id === undefined) notFound();
  if (text(formData, 'confirm') !== 'delete') return;
  const result = await deleteAccountGroup(getLedgerDatabase(), getCurrentHouseholdId(), id);
  if (result.status === 'ok') {
    revalidateAccounts();
    redirect('/accounts');
  }
}
