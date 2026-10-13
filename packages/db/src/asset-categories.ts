import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';

import type { Database } from './client.js';
import {
  accountKind,
  assetCategories,
  accounts,
  households,
  transactions,
  transfers,
  type AccountKind,
  type AssetCategory,
} from './schema.js';
import {
  assetCategoryIdSchema,
  assetCategoryNameSchema,
  type AssetCategoryCreateInput,
  type AssetCategoryUpdateInput,
} from './validation.js';

export const ASSET_CATEGORY_SORT_STEP = 10;

export const DEFAULT_ASSET_CATEGORY_SEEDS = [
  { systemKey: 'cash', name: '現金', sortOrder: 10 },
  { systemKey: 'bank', name: '銀行', sortOrder: 20 },
  { systemKey: 'credit_card', name: 'クレジットカード', sortOrder: 30 },
  { systemKey: 'debit_card', name: 'デビットカード', sortOrder: 40 },
  { systemKey: 'electronic_money', name: '電子マネー', sortOrder: 50 },
  { systemKey: 'other', name: 'その他', sortOrder: 60 },
] as const satisfies ReadonlyArray<{
  systemKey: AccountKind;
  name: string;
  sortOrder: number;
}>;

export type AssetCategoryCreateResult =
  { status: 'ok'; category: AssetCategory } | { status: 'duplicate' } | { status: 'error' };

export type AssetCategoryUpdateResult =
  | { status: 'ok'; category: AssetCategory }
  | { status: 'not_found' }
  | { status: 'immutable' }
  | { status: 'duplicate' }
  | { status: 'error' };

export type AssetCategoryDeleteResult =
  | { status: 'ok' }
  | { status: 'not_found' }
  | { status: 'immutable' }
  | { status: 'in_use' }
  | { status: 'error' };

export function accountKindForAssetCategory(
  category: Pick<AssetCategory, 'systemKey'>,
): AccountKind {
  return accountKind.enumValues.includes(category.systemKey as AccountKind)
    ? (category.systemKey as AccountKind)
    : 'other';
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

type LedgerTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

async function lockHousehold(transaction: LedgerTransaction, householdId: string): Promise<void> {
  const rows = await transaction
    .select({ id: households.id })
    .from(households)
    .where(eq(households.id, householdId))
    .for('update')
    .limit(1);
  if (!rows[0]) throw new Error('Household not found');
}

export async function ensureDefaultAssetCategories(
  executor: Database | LedgerTransaction,
  householdId: string,
): Promise<void> {
  await executor
    .insert(assetCategories)
    .values(
      DEFAULT_ASSET_CATEGORY_SEEDS.map((category) => ({
        householdId,
        ...category,
      })),
    )
    .onConflictDoNothing({
      target: [assetCategories.householdId, assetCategories.systemKey],
      where: sql`${assetCategories.systemKey} is not null`,
    });
}

export async function listAssetCategories(
  db: Database,
  householdId: string,
): Promise<AssetCategory[]> {
  return db
    .select()
    .from(assetCategories)
    .where(eq(assetCategories.householdId, householdId))
    .orderBy(asc(assetCategories.sortOrder), asc(assetCategories.id));
}

export async function getAssetCategory(
  db: Database,
  householdId: string,
  categoryId: number,
): Promise<AssetCategory | null> {
  const parsedId = assetCategoryIdSchema.safeParse(categoryId);
  if (!parsedId.success) return null;
  const rows = await db
    .select()
    .from(assetCategories)
    .where(and(eq(assetCategories.id, parsedId.data), eq(assetCategories.householdId, householdId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createAssetCategory(
  db: Database,
  householdId: string,
  input: AssetCategoryCreateInput,
): Promise<AssetCategoryCreateResult> {
  const parsed = assetCategoryNameSchema.safeParse(input.name);
  if (!parsed.success) return { status: 'error' };
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const duplicate = await transaction
        .select({ id: assetCategories.id })
        .from(assetCategories)
        .where(
          and(eq(assetCategories.householdId, householdId), eq(assetCategories.name, parsed.data)),
        )
        .limit(1);
      if (duplicate.length > 0) return { status: 'duplicate' };
      const maxRows = await transaction
        .select({ maxSortOrder: sql<number | null>`max(${assetCategories.sortOrder})` })
        .from(assetCategories)
        .where(eq(assetCategories.householdId, householdId));
      const inserted = await transaction
        .insert(assetCategories)
        .values({
          householdId,
          name: parsed.data,
          sortOrder: Number(maxRows[0]?.maxSortOrder ?? 0) + ASSET_CATEGORY_SORT_STEP,
        })
        .returning();
      return inserted[0] ? { status: 'ok', category: inserted[0] } : { status: 'error' };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'duplicate' };
    return { status: 'error' };
  }
}

export async function updateAssetCategory(
  db: Database,
  householdId: string,
  input: AssetCategoryUpdateInput,
): Promise<AssetCategoryUpdateResult> {
  const parsedId = assetCategoryIdSchema.safeParse(input.id);
  const parsedName = assetCategoryNameSchema.safeParse(input.name);
  if (!parsedId.success || !parsedName.success) return { status: 'error' };
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const currentRows = await transaction
        .select()
        .from(assetCategories)
        .where(
          and(eq(assetCategories.id, parsedId.data), eq(assetCategories.householdId, householdId)),
        )
        .for('update')
        .limit(1);
      const current = currentRows[0];
      if (!current) return { status: 'not_found' };
      if (current.systemKey !== null) return { status: 'immutable' };
      const duplicate = await transaction
        .select({ id: assetCategories.id })
        .from(assetCategories)
        .where(
          and(
            eq(assetCategories.householdId, householdId),
            eq(assetCategories.name, parsedName.data),
            sql`${assetCategories.id} <> ${parsedId.data}`,
          ),
        )
        .limit(1);
      if (duplicate.length > 0) return { status: 'duplicate' };
      const updated = await transaction
        .update(assetCategories)
        .set({ name: parsedName.data })
        .where(
          and(eq(assetCategories.id, parsedId.data), eq(assetCategories.householdId, householdId)),
        )
        .returning();
      return updated[0] ? { status: 'ok', category: updated[0] } : { status: 'not_found' };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'duplicate' };
    return { status: 'error' };
  }
}

export async function deleteAssetCategory(
  db: Database,
  householdId: string,
  categoryId: number,
): Promise<AssetCategoryDeleteResult> {
  const parsedId = assetCategoryIdSchema.safeParse(categoryId);
  if (!parsedId.success) return { status: 'not_found' };
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const categoryRows = await transaction
        .select()
        .from(assetCategories)
        .where(
          and(eq(assetCategories.id, parsedId.data), eq(assetCategories.householdId, householdId)),
        )
        .for('update')
        .limit(1);
      const category = categoryRows[0];
      if (!category) return { status: 'not_found' };
      if (category.systemKey !== null) return { status: 'immutable' };
      const fallbackRows = await transaction
        .select({ id: assetCategories.id })
        .from(assetCategories)
        .where(
          and(eq(assetCategories.householdId, householdId), eq(assetCategories.systemKey, 'other')),
        )
        .limit(1);
      const fallback = fallbackRows[0];
      if (!fallback || fallback.id === category.id) return { status: 'error' };
      const categoryAccounts = await transaction
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(eq(accounts.householdId, householdId), eq(accounts.assetCategoryId, category.id)),
        )
        .for('update');
      const accountIds = categoryAccounts.map((account) => account.id);
      if (accountIds.length > 0) {
        const transactionReference = await transaction
          .select({ id: transactions.id })
          .from(transactions)
          .where(
            and(
              eq(transactions.householdId, householdId),
              inArray(transactions.accountId, accountIds),
            ),
          )
          .limit(1);
        if (transactionReference.length > 0) return { status: 'in_use' };
        const transferReference = await transaction
          .select({ id: transfers.id })
          .from(transfers)
          .where(
            and(
              eq(transfers.householdId, householdId),
              or(
                inArray(transfers.fromAccountId, accountIds),
                inArray(transfers.toAccountId, accountIds),
              ),
            ),
          )
          .limit(1);
        if (transferReference.length > 0) return { status: 'in_use' };
        await transaction
          .update(accounts)
          .set({ assetCategoryId: fallback.id, kind: 'other' })
          .where(
            and(eq(accounts.householdId, householdId), eq(accounts.assetCategoryId, category.id)),
          );
      }
      const deleted = await transaction
        .delete(assetCategories)
        .where(
          and(eq(assetCategories.id, category.id), eq(assetCategories.householdId, householdId)),
        )
        .returning({ id: assetCategories.id });
      return deleted[0] ? { status: 'ok' } : { status: 'not_found' };
    });
  } catch (error) {
    console.error('[asset-categories/delete] database operation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'error' };
  }
}
