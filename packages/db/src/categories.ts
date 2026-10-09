import { and, asc, eq, sql } from 'drizzle-orm';

import type { Database } from './client.js';
import {
  accountCardConditions,
  accountCardSettings,
  accountGroups,
  accountImportMappings,
  accounts,
  cardAutoPaymentRuns,
  categories,
  households,
  transactionImports,
  transfers,
  transactions,
  type Category,
  type TransactionType,
} from './schema.js';
import {
  categoryCreateInputSchema,
  categoryIdSchema,
  categoryUpdateInputSchema,
  transactionTypeSchema,
  type CategoryCreateInput,
  type CategoryUpdateInput,
} from './validation.js';
import {
  DEFAULT_ACCOUNT_GROUP_SEEDS,
  DEFAULT_CATEGORY_SEEDS,
  lockHousehold,
  type LedgerExecutor,
} from './ledger.js';

export const CATEGORY_SORT_STEP = 10;

export type CategoryCreateResult =
  { status: 'ok'; category: Category } | { status: 'duplicate' } | { status: 'error' };

export type CategoryUpdateResult =
  | { status: 'ok'; category: Category }
  | { status: 'not_found' }
  | { status: 'duplicate' }
  | { status: 'error' };

export type CategoryDeleteResult =
  { status: 'ok' } | { status: 'not_found' } | { status: 'in_use' } | { status: 'error' };

export type CategoryReorderResult = { status: 'ok' } | { status: 'invalid' } | { status: 'error' };

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return error.code === '23505';
}

export async function createCategory(
  db: Database,
  householdId: string,
  input: CategoryCreateInput,
): Promise<CategoryCreateResult> {
  const parsed = categoryCreateInputSchema.safeParse(input);
  if (!parsed.success) return { status: 'error' };
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const duplicate = await transaction
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.householdId, householdId),
            eq(categories.type, parsed.data.type),
            eq(categories.name, parsed.data.name),
          ),
        )
        .limit(1);
      if (duplicate.length > 0) return { status: 'duplicate' };
      const maxRows = await transaction
        .select({ maxSortOrder: sql<number | null>`max(${categories.sortOrder})` })
        .from(categories)
        .where(and(eq(categories.householdId, householdId), eq(categories.type, parsed.data.type)));
      const rows = await transaction
        .insert(categories)
        .values({
          householdId,
          type: parsed.data.type,
          name: parsed.data.name,
          sortOrder: Number(maxRows[0]?.maxSortOrder ?? 0) + CATEGORY_SORT_STEP,
        })
        .returning();
      const category = rows[0];
      return category ? { status: 'ok', category } : { status: 'error' };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'duplicate' };
    return { status: 'error' };
  }
}

export async function updateCategory(
  db: Database,
  householdId: string,
  input: CategoryUpdateInput,
): Promise<CategoryUpdateResult> {
  const parsed = categoryUpdateInputSchema.safeParse(input);
  if (!parsed.success) return { status: 'error' };
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const currentRows = await transaction
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.id, parsed.data.id),
            eq(categories.householdId, householdId),
            eq(categories.type, parsed.data.type),
          ),
        )
        .for('update')
        .limit(1);
      if (!currentRows[0]) return { status: 'not_found' };
      const duplicate = await transaction
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.householdId, householdId),
            eq(categories.type, parsed.data.type),
            eq(categories.name, parsed.data.name),
            sql`${categories.id} <> ${parsed.data.id}`,
          ),
        )
        .limit(1);
      if (duplicate.length > 0) return { status: 'duplicate' };
      const rows = await transaction
        .update(categories)
        .set({ name: parsed.data.name })
        .where(
          and(
            eq(categories.id, parsed.data.id),
            eq(categories.householdId, householdId),
            eq(categories.type, parsed.data.type),
          ),
        )
        .returning();
      const category = rows[0];
      return category ? { status: 'ok', category } : { status: 'not_found' };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'duplicate' };
    return { status: 'error' };
  }
}

export async function deleteCategory(
  db: Database,
  householdId: string,
  categoryId: number,
  type: TransactionType,
): Promise<CategoryDeleteResult> {
  const parsedId = categoryIdSchema.safeParse(categoryId);
  const parsedType = transactionTypeSchema.safeParse(type);
  if (!parsedId.success || !parsedType.success) return { status: 'not_found' };
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const currentRows = await transaction
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.id, parsedId.data),
            eq(categories.householdId, householdId),
            eq(categories.type, parsedType.data),
          ),
        )
        .for('update')
        .limit(1);
      if (!currentRows[0]) return { status: 'not_found' };
      const references = await transaction
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.householdId, householdId),
            eq(transactions.categoryId, parsedId.data),
            eq(transactions.type, parsedType.data),
          ),
        )
        .limit(1);
      if (references.length > 0) return { status: 'in_use' };
      await transaction
        .delete(categories)
        .where(
          and(
            eq(categories.id, parsedId.data),
            eq(categories.householdId, householdId),
            eq(categories.type, parsedType.data),
          ),
        );
      return { status: 'ok' };
    });
  } catch {
    return { status: 'error' };
  }
}

export async function reorderCategories(
  db: Database,
  householdId: string,
  type: TransactionType,
  categoryIds: readonly number[],
): Promise<CategoryReorderResult> {
  const parsedType = transactionTypeSchema.safeParse(type);
  if (!parsedType.success || categoryIds.length === 0) return { status: 'invalid' };
  const ids: number[] = [];
  for (const id of categoryIds) {
    const parsedId = categoryIdSchema.safeParse(id);
    if (!parsedId.success) return { status: 'invalid' };
    ids.push(parsedId.data);
  }
  if (new Set(ids).size !== ids.length) return { status: 'invalid' };
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const current = await transaction
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.householdId, householdId), eq(categories.type, parsedType.data)))
        .orderBy(asc(categories.sortOrder), asc(categories.id))
        .for('update');
      const currentIds = current.map((category) => category.id);
      if (currentIds.length !== ids.length || currentIds.some((id) => !ids.includes(id))) {
        return { status: 'invalid' };
      }
      for (const [index, id] of ids.entries()) {
        await transaction
          .update(categories)
          .set({ sortOrder: (index + 1) * CATEGORY_SORT_STEP })
          .where(
            and(
              eq(categories.id, id),
              eq(categories.householdId, householdId),
              eq(categories.type, parsedType.data),
            ),
          );
      }
      return { status: 'ok' };
    });
  } catch {
    return { status: 'error' };
  }
}

export async function ensureDefaultAccountGroups(
  executor: LedgerExecutor,
  householdId: string,
): Promise<void> {
  await executor
    .insert(accountGroups)
    .values(
      DEFAULT_ACCOUNT_GROUP_SEEDS.map((group) => ({
        householdId,
        ...group,
      })),
    )
    .onConflictDoNothing({ target: [accountGroups.householdId, accountGroups.name] });
}

export async function resetHouseholdData(
  db: Database,
  householdId: string,
): Promise<{ status: 'ok' | 'not_found' | 'error' }> {
  try {
    await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      await transaction
        .delete(cardAutoPaymentRuns)
        .where(eq(cardAutoPaymentRuns.householdId, householdId));
      await transaction
        .delete(accountCardSettings)
        .where(eq(accountCardSettings.householdId, householdId));
      await transaction
        .delete(accountCardConditions)
        .where(eq(accountCardConditions.householdId, householdId));
      await transaction
        .delete(transactionImports)
        .where(eq(transactionImports.householdId, householdId));
      await transaction
        .delete(accountImportMappings)
        .where(eq(accountImportMappings.householdId, householdId));
      await transaction.delete(transactions).where(eq(transactions.householdId, householdId));
      await transaction.delete(transfers).where(eq(transfers.householdId, householdId));
      await transaction.delete(accounts).where(eq(accounts.householdId, householdId));
      await transaction.delete(categories).where(eq(categories.householdId, householdId));
      await transaction.delete(accountGroups).where(eq(accountGroups.householdId, householdId));
      await ensureDefaultAccountGroups(transaction, householdId);
      await transaction
        .insert(categories)
        .values(DEFAULT_CATEGORY_SEEDS.map((category) => ({ householdId, ...category })));
      await transaction
        .update(households)
        .set({ ledgerInitialized: true })
        .where(eq(households.id, householdId));
    });
    return { status: 'ok' };
  } catch (error) {
    if (error instanceof Error && error.message === 'Household not found')
      return { status: 'not_found' };
    return { status: 'error' };
  }
}
