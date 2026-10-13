import { and, asc, eq, getTableColumns, inArray, isNull, sql } from 'drizzle-orm';
import { currentTokyoDate } from './month.js';
import { accountKindForAssetCategory } from './asset-categories.js';

import type { Database } from './client.js';
import { getAccountBalances, lockCardSettingsForAccounts, type AccountBalance } from './ledger.js';
import {
  accountCardSettings,
  assetCategories,
  accounts,
  households,
  type Account,
  type AccountCardSetting,
} from './schema.js';
import {
  accountCardConditionInputSchema,
  accountCreateInputSchema,
  accountUpdateInputSchema,
  type AccountCardConditionInput,
  type AccountCreateInput,
  type AccountUpdateInput,
} from './validation.js';

export type ManagedAccount = Account & {
  assetCategoryName: string;
  assetCategorySystemKey: string | null;
};

export type AccountMutationResult =
  | { status: 'ok'; account: Account }
  | { status: 'not_found' }
  | { status: 'deleted' }
  | { status: 'stale_asset_category' }
  | { status: 'invalid_asset_category' }
  | { status: 'not_card' }
  | { status: 'invalid_debit_account' }
  | { status: 'error' };

export type AccountDeleteResult =
  { status: 'deleted' } | { status: 'not_found' } | { status: 'error' };

type AccountMutationFailureStatus =
  | 'not_found'
  | 'deleted'
  | 'stale_asset_category'
  | 'invalid_asset_category'
  | 'not_card'
  | 'invalid_debit_account'
  | 'error';

class AccountMutationRollback extends Error {
  constructor(readonly status: AccountMutationFailureStatus) {
    super(`Account mutation failed: ${status}`);
  }
}

async function getAccountInExecutor(
  db: Database,
  householdId: string,
  accountId: number,
): Promise<ManagedAccount | null> {
  const rows = await db
    .select({
      ...getTableColumns(accounts),
      assetCategoryName: assetCategories.name,
      assetCategorySystemKey: assetCategories.systemKey,
    })
    .from(accounts)
    .innerJoin(
      assetCategories,
      and(
        eq(assetCategories.id, accounts.assetCategoryId),
        eq(assetCategories.householdId, accounts.householdId),
      ),
    )
    .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)))
    .limit(1);
  return rows[0] ?? null;
}
export async function listManagedAccounts(
  db: Database,
  householdId: string,
): Promise<ManagedAccount[]> {
  return db
    .select({
      ...getTableColumns(accounts),
      assetCategoryName: assetCategories.name,
      assetCategorySystemKey: assetCategories.systemKey,
    })
    .from(accounts)
    .innerJoin(
      assetCategories,
      and(
        eq(assetCategories.id, accounts.assetCategoryId),
        eq(assetCategories.householdId, accounts.householdId),
      ),
    )
    .where(eq(accounts.householdId, householdId))
    .orderBy(
      asc(assetCategories.sortOrder),
      asc(assetCategories.id),
      asc(accounts.sortOrder),
      asc(accounts.id),
    );
}

export async function listActiveManagedAccounts(
  db: Database,
  householdId: string,
): Promise<ManagedAccount[]> {
  return db
    .select({
      ...getTableColumns(accounts),
      assetCategoryName: assetCategories.name,
      assetCategorySystemKey: assetCategories.systemKey,
    })
    .from(accounts)
    .innerJoin(
      assetCategories,
      and(
        eq(assetCategories.id, accounts.assetCategoryId),
        eq(assetCategories.householdId, accounts.householdId),
      ),
    )
    .where(and(eq(accounts.householdId, householdId), isNull(accounts.deletedAt)))
    .orderBy(
      asc(assetCategories.sortOrder),
      asc(assetCategories.id),
      asc(accounts.sortOrder),
      asc(accounts.id),
    );
}

export async function getActiveManagedAccount(
  db: Database,
  householdId: string,
  accountId: number,
): Promise<ManagedAccount | null> {
  const account = await getAccountInExecutor(db, householdId, accountId);
  return account?.deletedAt === null ? account : null;
}

export interface ManagedAccountBalance extends AccountBalance {
  kind: Account['kind'];
  status: Account['status'];
  deletedAt: Account['deletedAt'];
  sortOrder: number;
  assetCategoryId: number;
  assetCategoryName: string;
  assetCategorySystemKey: string | null;
}

export async function getManagedAccountBalances(
  db: Database,
  householdId: string,
): Promise<ManagedAccountBalance[]> {
  const [balances, managed] = await Promise.all([
    getAccountBalances(db, householdId),
    listManagedAccounts(db, householdId),
  ]);
  const categoryIds = [...new Set(managed.map((account) => account.assetCategoryId))];
  const categoryRows =
    categoryIds.length === 0
      ? []
      : await db
          .select({
            id: assetCategories.id,
            name: assetCategories.name,
            systemKey: assetCategories.systemKey,
          })
          .from(assetCategories)
          .where(
            and(
              eq(assetCategories.householdId, householdId),
              inArray(assetCategories.id, categoryIds),
            ),
          );
  const categoriesById = new Map(categoryRows.map((category) => [category.id, category]));
  const byId = new Map(balances.map((balance) => [balance.accountId, balance]));
  return managed.flatMap((account) => {
    const balance = byId.get(account.id);
    const category = categoriesById.get(account.assetCategoryId);
    return balance && category
      ? [
          {
            ...balance,
            kind: account.kind,
            status: account.status,
            deletedAt: account.deletedAt,
            sortOrder: account.sortOrder,
            assetCategoryId: category.id,
            assetCategoryName: category.name,
            assetCategorySystemKey: category.systemKey,
          },
        ]
      : [];
  });
}

export async function getManagedAccount(
  db: Database,
  householdId: string,
  accountId: number,
): Promise<ManagedAccount | null> {
  return getAccountInExecutor(db, householdId, accountId);
}

async function lockHousehold(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  householdId: string,
): Promise<void> {
  const rows = await transaction
    .select({ id: households.id })
    .from(households)
    .where(eq(households.id, householdId))
    .for('update')
    .limit(1);
  if (!rows[0]) {
    throw new Error('Household not found');
  }
}

async function maxAccountSortOrder(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  householdId: string,
): Promise<number> {
  const rows = await transaction
    .select({ maxSortOrder: sql<number | null>`max(${accounts.sortOrder})` })
    .from(accounts)
    .where(eq(accounts.householdId, householdId));
  return Number(rows[0]?.maxSortOrder ?? 0);
}

export async function createAccount(
  db: Database,
  householdId: string,
  input: AccountCreateInput,
  cardCondition?: AccountCardConditionInput,
): Promise<AccountMutationResult> {
  const parsed = accountCreateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error' };
  }
  const requestedAssetCategoryId = parsed.data.assetCategoryId;
  const accountName = parsed.data.name;
  const parsedCard =
    cardCondition === undefined
      ? undefined
      : accountCardConditionInputSchema.safeParse(cardCondition);
  if (parsedCard && !parsedCard.success) {
    return { status: 'error' };
  }
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const categoryRows = await transaction
        .select()
        .from(assetCategories)
        .where(
          and(
            eq(assetCategories.id, requestedAssetCategoryId),
            eq(assetCategories.householdId, householdId),
          ),
        )
        .for('update')
        .limit(1);
      const category = categoryRows[0];
      if (!category) return { status: 'invalid_asset_category' };
      const kind = accountKindForAssetCategory(category);
      if (parsedCard?.success) {
        if (kind !== 'credit_card') {
          return { status: 'not_card' };
        }
        if (
          !(await validateDebitAccount(
            transaction,
            householdId,
            undefined,
            parsedCard.data.debitAccountId,
          ))
        ) {
          return { status: 'invalid_debit_account' };
        }
      }
      const sortOrder = (await maxAccountSortOrder(transaction, householdId)) + 10;
      const inserted = await transaction
        .insert(accounts)
        .values({
          householdId,
          name: accountName,
          kind,
          assetCategoryId: category.id,
          status: 'active',
          sortOrder,
        })
        .returning({ id: accounts.id });
      const id = inserted[0]?.id;
      if (id === undefined) {
        throw new AccountMutationRollback('error');
      }
      const account = await getAccountInExecutor(transaction, householdId, id);
      if (!account) {
        throw new AccountMutationRollback('error');
      }
      if (parsedCard?.success) {
        const saved = await saveCardConditionInTransaction(
          transaction,
          householdId,
          account,
          parsedCard.data,
          null,
        );
        if (saved.status !== 'ok') {
          throw new AccountMutationRollback(saved.status);
        }
      }
      return { status: 'ok', account };
    });
  } catch (error) {
    if (error instanceof AccountMutationRollback) {
      return { status: error.status };
    }
    console.error('[accounts/create] database operation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'error' };
  }
}

export async function updateAccount(
  db: Database,
  householdId: string,
  accountId: number,
  input: AccountUpdateInput,
  cardCondition?: AccountCardConditionInput,
): Promise<AccountMutationResult> {
  const parsed = accountUpdateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error' };
  }
  const requestedAssetCategoryId = parsed.data.assetCategoryId;
  const accountName = parsed.data.name;
  const expectedAssetCategoryId = parsed.data.expectedAssetCategoryId;
  const parsedCard =
    cardCondition === undefined
      ? undefined
      : accountCardConditionInputSchema.safeParse(cardCondition);
  if (parsedCard && !parsedCard.success) {
    return { status: 'error' };
  }
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const categoryRows = await transaction
        .select()
        .from(assetCategories)
        .where(
          and(
            eq(assetCategories.id, requestedAssetCategoryId),
            eq(assetCategories.householdId, householdId),
          ),
        )
        .for('update')
        .limit(1);
      const category = categoryRows[0];
      if (!category) return { status: 'invalid_asset_category' };
      const kind = accountKindForAssetCategory(category);
      await lockCardSettingsForAccounts(transaction, householdId, [accountId]);
      const current = await transaction
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)))
        .for('update')
        .limit(1);
      const account = current[0];
      if (!account) {
        return { status: 'not_found' };
      }
      if (account.deletedAt !== null) {
        return { status: 'deleted' };
      }
      if (
        expectedAssetCategoryId !== undefined &&
        expectedAssetCategoryId !== account.assetCategoryId
      ) {
        return { status: 'stale_asset_category' };
      }
      let currentCardCondition: AccountCardSetting | null = null;
      if (parsedCard?.success) {
        if (kind !== 'credit_card') {
          return { status: 'not_card' };
        }
        currentCardCondition = await currentCardSettingInTransaction(
          transaction,
          householdId,
          accountId,
        );
        if (
          !(await validateDebitAccount(
            transaction,
            householdId,
            accountId,
            parsedCard.data.debitAccountId,
            currentCardCondition?.debitAccountId,
          ))
        ) {
          return { status: 'invalid_debit_account' };
        }
      }
      const updated = await transaction
        .update(accounts)
        .set({
          name: accountName,
          kind,
          assetCategoryId: category.id,
          status: account.status,
        })
        .where(
          and(
            eq(accounts.id, accountId),
            eq(accounts.householdId, householdId),
            isNull(accounts.deletedAt),
          ),
        )
        .returning({ id: accounts.id });
      if (!updated[0]) {
        throw new AccountMutationRollback('not_found');
      }
      const updatedAccount = await getAccountInExecutor(transaction, householdId, accountId);
      if (!updatedAccount) {
        throw new AccountMutationRollback('error');
      }
      if (parsedCard?.success) {
        const saved = await saveCardConditionInTransaction(
          transaction,
          householdId,
          updatedAccount,
          parsedCard.data,
          currentCardCondition,
        );
        if (saved.status !== 'ok') {
          throw new AccountMutationRollback(saved.status);
        }
      }
      return { status: 'ok', account: updatedAccount };
    });
  } catch (error) {
    if (error instanceof AccountMutationRollback) {
      return { status: error.status };
    }
    console.error('[accounts/update] database operation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'error' };
  }
}

export async function deleteAccount(
  db: Database,
  householdId: string,
  accountId: number,
): Promise<AccountDeleteResult> {
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      await lockCardSettingsForAccounts(transaction, householdId, [accountId]);
      const account = await transaction
        .select({ id: accounts.id, deletedAt: accounts.deletedAt })
        .from(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)))
        .for('update')
        .limit(1);
      if (!account[0] || account[0].deletedAt !== null) {
        return { status: 'not_found' };
      }
      const deleted = await transaction
        .update(accounts)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(accounts.id, accountId),
            eq(accounts.householdId, householdId),
            isNull(accounts.deletedAt),
          ),
        )
        .returning({ id: accounts.id });
      return deleted[0] ? { status: 'deleted' } : { status: 'not_found' };
    });
  } catch (error) {
    console.error('[accounts/delete] database operation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'error' };
  }
}

async function cardAccount(
  db: Database,
  householdId: string,
  accountId: number,
): Promise<Account | null> {
  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Read the single current card setting. Legacy effective-date rows are retained
 * for migration/audit purposes but are intentionally never consulted here.
 */
export async function getCurrentCardCondition(
  db: Database,
  householdId: string,
  accountId: number,
): Promise<AccountCardSetting | null> {
  const account = await cardAccount(db, householdId, accountId);
  if (!account || account.kind !== 'credit_card') return null;
  const rows = await db
    .select()
    .from(accountCardSettings)
    .where(
      and(
        eq(accountCardSettings.householdId, householdId),
        eq(accountCardSettings.accountId, accountId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

type CardConditionMutationResult =
  | { status: 'ok'; condition: AccountCardSetting }
  | {
      status: 'deleted' | 'not_card' | 'invalid_debit_account' | 'not_found' | 'error';
    };

async function validateDebitAccount(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  householdId: string,
  cardAccountId: number | undefined,
  debitAccountId: number | null | undefined,
  allowedDeletedAccountId?: number | null,
): Promise<boolean> {
  if (debitAccountId === null || debitAccountId === undefined) return true;
  if (debitAccountId === cardAccountId) return false;
  const debit = await cardAccount(transaction, householdId, debitAccountId);
  return (
    debit !== null &&
    debit.kind === 'bank' &&
    (debit.deletedAt === null || debit.id === allowedDeletedAccountId)
  );
}

async function currentCardSettingInTransaction(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  householdId: string,
  accountId: number,
): Promise<AccountCardSetting | null> {
  const rows = await transaction
    .select()
    .from(accountCardSettings)
    .where(
      and(
        eq(accountCardSettings.householdId, householdId),
        eq(accountCardSettings.accountId, accountId),
      ),
    )
    .for('update')
    .limit(1);
  return rows[0] ?? null;
}

function hasCompleteCardSchedule(condition: {
  closingDay: string | null | undefined;
  paymentDay: string | null | undefined;
  paymentMonthOffset: string | null | undefined;
}): boolean {
  return (
    condition.closingDay !== null &&
    condition.closingDay !== undefined &&
    condition.paymentDay !== null &&
    condition.paymentDay !== undefined &&
    condition.paymentMonthOffset !== null &&
    condition.paymentMonthOffset !== undefined
  );
}

async function saveCardConditionInTransaction(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  householdId: string,
  account: Account,
  input: AccountCardConditionInput,
  current: AccountCardSetting | null,
): Promise<CardConditionMutationResult> {
  if (account.deletedAt !== null) return { status: 'deleted' };
  if (account.kind !== 'credit_card') return { status: 'not_card' };
  if (
    !(await validateDebitAccount(
      transaction,
      householdId,
      account.id,
      input.debitAccountId,
      current?.debitAccountId,
    ))
  ) {
    return { status: 'invalid_debit_account' };
  }
  const values = {
    closingDay: input.closingDay ?? null,
    paymentDay: input.paymentDay ?? null,
    paymentMonthOffset: input.paymentMonthOffset ?? null,
    debitAccountId: input.debitAccountId ?? null,
    updatedAt: new Date(),
  };
  if (current) {
    const updateValues =
      !hasCompleteCardSchedule(current) && hasCompleteCardSchedule(values)
        ? { ...values, autoPaymentStartsOn: currentTokyoDate() }
        : values;
    const updated = await transaction
      .update(accountCardSettings)
      .set(updateValues)
      .where(
        and(
          eq(accountCardSettings.id, current.id),
          eq(accountCardSettings.householdId, householdId),
          eq(accountCardSettings.accountId, account.id),
        ),
      )
      .returning();
    return updated[0] ? { status: 'ok', condition: updated[0] } : { status: 'not_found' };
  }
  const inserted = await transaction
    .insert(accountCardSettings)
    .values({
      householdId,
      accountId: account.id,
      ...values,
      autoPaymentStartsOn: currentTokyoDate(),
      createdAt: new Date(),
    })
    .returning();
  return inserted[0] ? { status: 'ok', condition: inserted[0] } : { status: 'error' };
}
