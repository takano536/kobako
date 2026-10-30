'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import {
  createFixedCost,
  deleteFixedCost,
  fixedCostInputFromFormData,
  fixedCostInputSchema,
  getFixedCost,
  updateFixedCost,
} from '@kobako/db';
import { parseInt4Id } from '../../src/lib/ids';
import type { DeleteFormState } from '../../src/lib/transaction-form';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../src/lib/ledger-data';

export interface FixedCostFormState {
  values?: Record<string, string>;
  fieldErrors?: Record<string, string[]>;
  message?: string;
}

function valuesFromFormData(formData: FormData): Record<string, string> {
  const input = fixedCostInputFromFormData(formData);
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, String(value ?? '')]),
  );
}

function invalidState(formData: FormData): FixedCostFormState {
  const parsed = fixedCostInputSchema.safeParse(fixedCostInputFromFormData(formData));
  if (parsed.success) return { values: valuesFromFormData(formData) };
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? 'form');
    fieldErrors[key] ??= [];
    fieldErrors[key].push(issue.message);
  }
  return { values: valuesFromFormData(formData), fieldErrors };
}

export async function createFixedCostAction(
  _previousState: FixedCostFormState,
  formData: FormData,
): Promise<FixedCostFormState> {
  const invalid = invalidState(formData);
  if (invalid.fieldErrors) return invalid;
  const result = await createFixedCost(
    await getLedgerDatabase(),
    await getCurrentHouseholdId(),
    fixedCostInputSchema.parse(fixedCostInputFromFormData(formData)),
  );
  if (result.status !== 'ok')
    return {
      ...invalid,
      message: 'message' in result ? result.message : '固定費を登録できませんでした。',
    };
  revalidatePath('/fixed-costs');
  redirect('/fixed-costs');
}

export async function updateFixedCostAction(
  id: number,
  _previousState: FixedCostFormState,
  formData: FormData,
): Promise<FixedCostFormState> {
  const invalid = invalidState(formData);
  if (invalid.fieldErrors) return invalid;
  const result = await updateFixedCost(
    await getLedgerDatabase(),
    await getCurrentHouseholdId(),
    id,
    fixedCostInputSchema.parse(fixedCostInputFromFormData(formData)),
  );
  if (result.status !== 'ok')
    return {
      ...invalid,
      message: 'message' in result ? result.message : '固定費を更新できませんでした。',
    };
  revalidatePath('/fixed-costs');
  redirect('/fixed-costs');
}

export async function deleteFixedCostAction(
  previousState: DeleteFormState,
  formData: FormData,
): Promise<DeleteFormState> {
  void previousState;
  const id = parseInt4Id(String(formData.get('id') ?? ''));
  if (id === undefined) notFound();
  if (formData.get('confirm') !== 'delete') {
    return { message: '削除する場合は確認操作を完了してください。' };
  }
  const result = await deleteFixedCost(
    await getLedgerDatabase(),
    await getCurrentHouseholdId(),
    id,
  );
  if (result === 'not_found') return { message: '固定費を削除できませんでした。' };
  revalidatePath('/fixed-costs');
  redirect('/fixed-costs');
}

export async function getFixedCostForEdit(id: number) {
  return getFixedCost(await getLedgerDatabase(), await getCurrentHouseholdId(), id);
}
