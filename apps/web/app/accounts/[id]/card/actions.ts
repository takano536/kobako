'use server';

import {
  appendCardCondition,
  confirmCardConditionCorrection,
  previewCardConditionCorrection,
} from '@kobako/db';
import {
  accountCardConditionInputSchema,
  type AccountCardConditionInput,
} from '@kobako/db/validation';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';

import { validatedTransactionReturn } from '../../../../src/lib/transaction-query';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../../../src/lib/ledger-data';
import { parseInt4Id } from '../../../../src/lib/ids';

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function cardPath(
  accountId: number,
  returnTo: string,
  status?: string,
  conditionId?: number,
  proposal?: AccountCardConditionInput,
): string {
  const params = new URLSearchParams({ return: returnTo });
  if (status) params.set('error', status);
  if (conditionId !== undefined) params.set('conditionId', String(conditionId));
  if (proposal) params.set('proposal', JSON.stringify(proposal));
  return `/accounts/${accountId}/card?${params.toString()}`;
}

export async function appendCardConditionAction(formData: FormData): Promise<void> {
  const accountId = parseInt4Id(text(formData, 'accountId'));
  if (accountId === undefined) notFound();
  const returnTo =
    validatedTransactionReturn(text(formData, 'return'), accountId) ??
    `/transactions?account=${accountId}&month=all`;
  const conditionIdValue = text(formData, 'conditionId');
  const conditionId = conditionIdValue ? parseInt4Id(conditionIdValue) : undefined;
  if (conditionIdValue && conditionId === undefined) {
    redirect(cardPath(accountId, returnTo, 'invalid_input'));
  }
  const parsed = accountCardConditionInputSchema.safeParse({
    effectiveFrom: text(formData, 'effectiveFrom') || null,
    closingDay: text(formData, 'closingDay') || null,
    paymentDay: text(formData, 'paymentDay') || null,
    paymentMonthOffset: text(formData, 'paymentMonthOffset') || null,
    debitAccountId: text(formData, 'debitAccountId') || null,
  });
  if (!parsed.success) {
    redirect(cardPath(accountId, returnTo, 'invalid_input', conditionId));
  }
  const db = getLedgerDatabase();
  const householdId = getCurrentHouseholdId();
  if (conditionId !== undefined) {
    const preview = await previewCardConditionCorrection(
      db,
      householdId,
      accountId,
      conditionId,
      parsed.data,
    );
    if (text(formData, 'confirmCorrection') !== 'confirm') {
      if (preview.status !== 'ok') {
        redirect(cardPath(accountId, returnTo, preview.status, conditionId));
      }
      redirect(cardPath(accountId, returnTo, 'confirm_correction', conditionId, parsed.data));
    }
    const result = await confirmCardConditionCorrection(
      db,
      householdId,
      accountId,
      conditionId,
      parsed.data,
    );
    if (result.status !== 'ok') {
      redirect(cardPath(accountId, returnTo, result.status, conditionId));
    }
  } else {
    const result = await appendCardCondition(db, householdId, accountId, parsed.data);
    if (result.status !== 'ok') {
      redirect(cardPath(accountId, returnTo, result.status));
    }
  }
  revalidatePath(`/accounts/${accountId}/card`);
  redirect(`${cardPath(accountId, returnTo)}&saved=1`);
}
