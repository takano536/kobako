'use server';

import {
  accountCardConditionInputSchema,
  accountCreateInputSchema,
  accountUpdateInputSchema,
} from '@kobako/db/validation';
import {
  createAccount,
  deleteAccount,
  saveCurrentCardCondition,
  setAccountImportMappings,
  updateAccount,
} from '@kobako/db';
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

function texts(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((value): value is string => typeof value === 'string');
}

function accountState(formData: FormData, message?: string): AccountFormState {
  const mappingNames = texts(formData, 'importMappingName');
  const cardValues = {
    closingDay: text(formData, 'closingDay'),
    paymentDay: text(formData, 'paymentDay'),
    paymentMonthOffset: text(formData, 'paymentMonthOffset'),
    debitAccountId: text(formData, 'debitAccountId'),
  };
  return {
    values: {
      name: text(formData, 'name'),
      kind: text(formData, 'kind'),
      groupId: text(formData, 'groupId'),
      expectedKind: text(formData, 'expectedKind'),
      confirmKindChange: formData.get('confirmKindChange') === 'on',
      ...cardValues,
      importMappingNames: mappingNames,
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

function mappingInputs(formData: FormData) {
  const names = texts(formData, 'importMappingName');
  const ids = texts(formData, 'importMappingId');
  const sourceIds = texts(formData, 'importMappingSourceId');
  const values = names.flatMap((name, index) => {
    if (name.trim() === '') return [];
    const id = parseInt4Id(ids[index] ?? '');
    return [
      {
        ...(id === undefined ? {} : { id }),
        sourceAccountId: sourceIds[index] || null,
        sourceAccountName: name,
      },
    ];
  });
  const additional = text(formData, 'newImportMappingName');
  if (additional.trim() !== '') {
    values.push({ sourceAccountId: null, sourceAccountName: additional });
  }
  return values;
}

function accountReturnPath(formData: FormData, accountId: number): string {
  return validatedTransactionReturn(text(formData, 'return'), accountId) ?? '/balances';
}

function interpretation(kind: string, rawBalance: string): string {
  const liability = kind === 'credit_card' || (kind === 'other' && BigInt(rawBalance) < 0n);
  return liability ? '負債' : '資産';
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
  if (!parsed.success) return validationState(formData, parsed.error);
  const db = getLedgerDatabase();
  const householdId = getCurrentHouseholdId();
  const result = await createAccount(db, householdId, parsed.data);
  if (result.status === 'group_unavailable') {
    return { ...accountState(formData), message: '資産グループを確認できませんでした。' };
  }
  if (result.status !== 'ok') {
    return { ...accountState(formData), message: '資産を保存できませんでした。' };
  }
  if (parsed.data.kind === 'credit_card') {
    const parsedCard = accountCardConditionInputSchema.safeParse(cardInput(formData));
    if (!parsedCard.success) return validationState(formData, parsedCard.error);
    if (hasCardInput(cardInput(formData))) {
      const saved = await saveCurrentCardCondition(
        db,
        householdId,
        result.account.id,
        parsedCard.data,
      );
      if (saved.status !== 'ok') {
        return { ...accountState(formData), message: 'カード条件を保存できませんでした。' };
      }
    }
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
    groupId: text(formData, 'groupId'),
    expectedKind: text(formData, 'expectedKind') || undefined,
    confirmKindChange: formData.get('confirmKindChange') === 'on',
  });
  if (!parsed.success) return validationState(formData, parsed.error);
  const parsedCard =
    parsed.data.kind === 'credit_card'
      ? accountCardConditionInputSchema.safeParse(cardInput(formData))
      : undefined;
  if (parsedCard && !parsedCard.success) return validationState(formData, parsedCard.error);
  const db = getLedgerDatabase();
  const householdId = getCurrentHouseholdId();
  const result = await updateAccount(db, householdId, id, parsed.data);
  if (result.status === 'not_found') notFound();
  if (result.status === 'kind_confirmation_required') {
    return {
      ...accountState(formData),
      message: `種別を${interpretation(parsed.data.kind, result.rawBalance)}として保存します。確認してからもう一度保存してください。`,
      requiresKindConfirmation: true,
    };
  }
  if (result.status === 'stale_kind') {
    return {
      ...accountState(formData),
      message: '別の画面で種別が変更されました。再読み込みしてください。',
    };
  }
  if (result.status === 'group_unavailable') {
    return { ...accountState(formData), message: '資産グループを確認できませんでした。' };
  }
  if (result.status !== 'ok') {
    return { ...accountState(formData), message: '資産を保存できませんでした。' };
  }
  if (parsedCard?.success) {
    const saved = await saveCurrentCardCondition(db, householdId, id, parsedCard.data);
    if (saved.status !== 'ok') {
      return { ...accountState(formData), message: 'カード条件を保存できませんでした。' };
    }
  }
  const mappings = mappingInputs(formData);
  const mappingResult = await setAccountImportMappings(db, householdId, id, mappings);
  if (mappingResult.status !== 'ok') {
    return {
      ...accountState(formData),
      fieldErrors: { importMappingName: ['対応名が他の資産で使われています。'] },
    };
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
