'use server';

import {
  categoryCreateInputSchema,
  categoryUpdateInputSchema,
  createCategory,
  deleteCategory,
  reorderCategories,
  resetHouseholdData,
  transactionTypeSchema,
  updateCategory,
} from '@kobako/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getCurrentHouseholdId, getLedgerDatabase } from '../../src/lib/ledger-data';

export interface CategoryActionState {
  error?: string;
  values?: {
    categoryId?: string;
    type?: string;
    name?: string;
  };
}

export interface DeleteAllActionState {
  error?: string;
  confirmation?: string;
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function categoryValues(formData: FormData): CategoryActionState['values'] {
  return {
    categoryId: text(formData, 'categoryId'),
    type: text(formData, 'type'),
    name: text(formData, 'name'),
  };
}

function categoryError(formData: FormData, error: string): CategoryActionState {
  return { error, values: categoryValues(formData) };
}

function categoryPath(type: 'expense' | 'income'): string {
  return `/settings/categories/${type}`;
}

function revalidateLedger(): void {
  revalidatePath('/', 'layout');
  revalidatePath('/transactions');
  revalidatePath('/balances');
}

export async function createCategoryAction(
  _previousState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const parsed = categoryCreateInputSchema.safeParse({
    type: text(formData, 'type'),
    name: text(formData, 'name'),
  });
  if (!parsed.success)
    return categoryError(
      formData,
      parsed.error.issues[0]?.message ?? 'カテゴリ名を確認してください。',
    );
  const result = await createCategory(getLedgerDatabase(), getCurrentHouseholdId(), parsed.data);
  if (result.status === 'duplicate')
    return categoryError(formData, '同じ種別に同じ名前のカテゴリがあります。');
  if (result.status !== 'ok')
    return categoryError(
      formData,
      'カテゴリを追加できませんでした。時間をおいてもう一度お試しください。',
    );
  revalidateLedger();
  redirect(categoryPath(parsed.data.type));
}

export async function updateCategoryAction(
  _previousState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const parsed = categoryUpdateInputSchema.safeParse({
    id: text(formData, 'categoryId'),
    type: text(formData, 'type'),
    name: text(formData, 'name'),
  });
  if (!parsed.success)
    return categoryError(
      formData,
      parsed.error.issues[0]?.message ?? 'カテゴリ名を確認してください。',
    );
  const result = await updateCategory(getLedgerDatabase(), getCurrentHouseholdId(), parsed.data);
  if (result.status === 'not_found') return categoryError(formData, 'カテゴリが見つかりません。');
  if (result.status === 'duplicate')
    return categoryError(formData, '同じ種別に同じ名前のカテゴリがあります。');
  if (result.status !== 'ok')
    return categoryError(
      formData,
      'カテゴリ名を変更できませんでした。時間をおいてもう一度お試しください。',
    );
  revalidateLedger();
  redirect(categoryPath(parsed.data.type));
}

export async function deleteCategoryAction(
  _previousState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const categoryId = Number(text(formData, 'categoryId'));
  const parsedType = transactionTypeSchema.safeParse(text(formData, 'type'));
  if (!parsedType.success) return categoryError(formData, 'カテゴリが見つかりません。');
  const result = await deleteCategory(
    getLedgerDatabase(),
    getCurrentHouseholdId(),
    categoryId,
    parsedType.data,
  );
  if (result.status === 'in_use')
    return categoryError(formData, 'このカテゴリは既存の取引で使われているため削除できません。');
  if (result.status === 'not_found') return categoryError(formData, 'カテゴリが見つかりません。');
  if (result.status !== 'ok')
    return categoryError(
      formData,
      'カテゴリを削除できませんでした。時間をおいてもう一度お試しください。',
    );
  revalidateLedger();
  redirect(categoryPath(parsedType.data));
}

export async function reorderCategoryAction(
  _previousState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const parsedType = transactionTypeSchema.safeParse(text(formData, 'type'));
  if (!parsedType.success)
    return categoryError(formData, 'カテゴリの並び順を変更できませんでした。');
  const direction = text(formData, 'direction');
  const index = Number(text(formData, 'index'));
  const ids = formData
    .getAll('categoryIds')
    .filter((value): value is string => typeof value === 'string')
    .map((value) => Number(value));
  if (
    (direction !== 'up' && direction !== 'down') ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= ids.length
  ) {
    return categoryError(formData, 'カテゴリの並び順を変更できませんでした。');
  }
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= ids.length) return {};
  const [target] = ids.splice(index, 1);
  if (target === undefined)
    return categoryError(formData, 'カテゴリの並び順を変更できませんでした。');
  ids.splice(targetIndex, 0, target);
  const result = await reorderCategories(
    getLedgerDatabase(),
    getCurrentHouseholdId(),
    parsedType.data,
    ids,
  );
  if (result.status !== 'ok')
    return categoryError(
      formData,
      'カテゴリの並び順を変更できませんでした。再読み込みしてください。',
    );
  revalidateLedger();
  redirect(categoryPath(parsedType.data));
}

export async function deleteAllDataAction(
  _previousState: DeleteAllActionState,
  formData: FormData,
): Promise<DeleteAllActionState> {
  const confirmation = text(formData, 'confirmation');
  if (confirmation !== '削除') {
    return { error: '確認欄に「削除」と入力してください。', confirmation };
  }
  const result = await resetHouseholdData(getLedgerDatabase(), getCurrentHouseholdId());
  if (result.status === 'not_found') return { error: '家計が見つかりません。', confirmation };
  if (result.status !== 'ok') {
    return {
      error:
        'データを削除できませんでした。変更は取り消されています。時間をおいてもう一度お試しください。',
      confirmation,
    };
  }
  revalidatePath('/', 'layout');
  redirect('/settings?reset=done');
}
