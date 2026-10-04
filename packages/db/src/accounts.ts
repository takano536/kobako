import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { ensureDefaultAccountGroups, getAccountBalances, type AccountBalance } from './ledger.js';
import {
  accountCardConditions,
  accountGroups,
  accountImportMappings,
  accounts,
  households,
  transactions,
  transfers,
  type Account,
  type AccountCardCondition,
  type AccountGroup,
} from './schema.js';
import {
  accountCardConditionInputSchema,
  accountCreateInputSchema,
  accountGroupInputSchema,
  accountUpdateInputSchema,
  requiresKindInterpretationConfirmation,
  type AccountCardConditionInput,
  type AccountCreateInput,
  type AccountGroupInput,
  type AccountUpdateInput,
} from './validation.js';

export { DEFAULT_ACCOUNT_GROUP_SEEDS } from './ledger.js';

export interface AccountWithGroup extends Account {
  groupName: string;
}

export type AccountMutationResult =
  | { status: 'ok'; account: AccountWithGroup }
  | { status: 'not_found' }
  | { status: 'kind_confirmation_required'; previousKind: Account['kind']; rawBalance: string }
  | { status: 'stale_kind' }
  | { status: 'group_unavailable' }
  | { status: 'error' };

export type AccountDeleteResult =
  | { status: 'deleted' }
  | { status: 'not_found' }
  | { status: 'referenced'; references: AccountReferenceSummary }
  | { status: 'error' };

export interface AccountReferenceSummary {
  transactions: number;
  transfers: number;
  importMappings: number;
  cardConditions: number;
  debitAccounts: number;
}

export type AccountGroupMutationResult =
  | { status: 'ok'; group: AccountGroup }
  | { status: 'not_found' }
  | { status: 'duplicate_name' }
  | { status: 'not_empty' }
  | { status: 'default_group' }
  | { status: 'error' };

export interface AccountGroupReorderResult {
  status: 'ok' | 'invalid' | 'error';
  groups?: AccountGroup[];
}

export interface AccountReorderResult {
  status: 'ok' | 'invalid' | 'error';
  accounts?: AccountWithGroup[];
}

function accountSelect() {
  return {
    id: accounts.id,
    householdId: accounts.householdId,
    name: accounts.name,
    kind: accounts.kind,
    groupId: accounts.groupId,
    status: accounts.status,
    sortOrder: accounts.sortOrder,
    createdAt: accounts.createdAt,
    groupName: accountGroups.name,
  };
}

async function getAccountInExecutor(
  db: Database,
  householdId: string,
  accountId: number,
): Promise<AccountWithGroup | null> {
  const rows = await db
    .select(accountSelect())
    .from(accounts)
    .innerJoin(
      accountGroups,
      and(eq(accountGroups.id, accounts.groupId), eq(accountGroups.householdId, householdId)),
    )
    .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listAccountGroups(
  db: Database,
  householdId: string,
): Promise<AccountGroup[]> {
  await ensureDefaultAccountGroups(db, householdId);
  return db
    .select()
    .from(accountGroups)
    .where(eq(accountGroups.householdId, householdId))
    .orderBy(asc(accountGroups.sortOrder), asc(accountGroups.id));
}

export async function listManagedAccounts(
  db: Database,
  householdId: string,
): Promise<AccountWithGroup[]> {
  return db
    .select(accountSelect())
    .from(accounts)
    .innerJoin(
      accountGroups,
      and(eq(accountGroups.id, accounts.groupId), eq(accountGroups.householdId, householdId)),
    )
    .where(eq(accounts.householdId, householdId))
    .orderBy(asc(accountGroups.sortOrder), asc(accounts.sortOrder), asc(accounts.id));
}
export interface ManagedAccountBalance extends AccountBalance {
  kind: Account['kind'];
  groupId: number;
  groupName: string;
  status: Account['status'];
  sortOrder: number;
}

export async function getManagedAccountBalances(
  db: Database,
  householdId: string,
): Promise<ManagedAccountBalance[]> {
  const [balances, managed] = await Promise.all([
    getAccountBalances(db, householdId),
    listManagedAccounts(db, householdId),
  ]);
  const byId = new Map(balances.map((balance) => [balance.accountId, balance]));
  return managed.flatMap((account) => {
    const balance = byId.get(account.id);
    return balance
      ? [
          {
            ...balance,
            kind: account.kind,
            groupId: account.groupId,
            groupName: account.groupName,
            status: account.status,
            sortOrder: account.sortOrder,
          },
        ]
      : [];
  });
}

export async function getManagedAccount(
  db: Database,
  householdId: string,
  accountId: number,
): Promise<AccountWithGroup | null> {
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

async function defaultGroup(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  householdId: string,
  kind: AccountCreateInput['kind'],
): Promise<AccountGroup | null> {
  await ensureDefaultAccountGroups(transaction, householdId);
  const rows = await transaction
    .select()
    .from(accountGroups)
    .where(and(eq(accountGroups.householdId, householdId), eq(accountGroups.defaultKind, kind)))
    .limit(1);
  return rows[0] ?? null;
}

async function currentRawBalance(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  householdId: string,
  accountId: number,
): Promise<string> {
  const rows = await transaction.execute<{ balance: string }>(sql`
    select (
      coalesce((select sum(case when type = 'income' then amount else 0 end)::bigint
        from ${transactions}
        where household_id = ${householdId} and account_id = ${accountId}), 0)
      - coalesce((select sum(case when type = 'expense' then amount else 0 end)::bigint
        from ${transactions}
        where household_id = ${householdId} and account_id = ${accountId}), 0)
      - coalesce((select sum(amount)::bigint
        from ${transfers}
        where household_id = ${householdId} and from_account_id = ${accountId}), 0)
      + coalesce((select sum(amount)::bigint
        from ${transfers}
        where household_id = ${householdId} and to_account_id = ${accountId}), 0)
    )::text as balance
  `);
  return rows[0]?.balance ?? '0';
}

async function maxAccountSortOrder(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  householdId: string,
  groupId: number,
): Promise<number> {
  const rows = await transaction
    .select({ maxSortOrder: sql<number | null>`max(${accounts.sortOrder})` })
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), eq(accounts.groupId, groupId)));
  return Number(rows[0]?.maxSortOrder ?? 0);
}

export async function createAccount(
  db: Database,
  householdId: string,
  input: AccountCreateInput,
): Promise<AccountMutationResult> {
  const parsed = accountCreateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error' };
  }
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const group = parsed.data.groupId
        ? (
            await transaction
              .select()
              .from(accountGroups)
              .where(
                and(
                  eq(accountGroups.id, parsed.data.groupId),
                  eq(accountGroups.householdId, householdId),
                ),
              )
              .limit(1)
          )[0]
        : await defaultGroup(transaction, householdId, parsed.data.kind);
      if (!group) {
        return { status: 'group_unavailable' };
      }
      const sortOrder = (await maxAccountSortOrder(transaction, householdId, group.id)) + 10;
      const inserted = await transaction
        .insert(accounts)
        .values({
          householdId,
          name: parsed.data.name,
          kind: parsed.data.kind,
          groupId: group.id,
          status: 'active',
          sortOrder,
        })
        .returning({ id: accounts.id });
      const id = inserted[0]?.id;
      if (id === undefined) {
        return { status: 'error' };
      }
      const account = await getAccountInExecutor(transaction, householdId, id);
      return account ? { status: 'ok', account } : { status: 'error' };
    });
  } catch (error) {
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
): Promise<AccountMutationResult> {
  const parsed = accountUpdateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error' };
  }
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
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
      if (parsed.data.expectedKind !== undefined && parsed.data.expectedKind !== account.kind) {
        return { status: 'stale_kind' };
      }
      const rawBalance = await currentRawBalance(transaction, householdId, accountId);
      if (
        requiresKindInterpretationConfirmation(account.kind, parsed.data.kind, rawBalance) &&
        !parsed.data.confirmKindChange
      ) {
        return {
          status: 'kind_confirmation_required',
          previousKind: account.kind,
          rawBalance,
        };
      }
      const group = await transaction
        .select()
        .from(accountGroups)
        .where(
          and(
            eq(accountGroups.id, parsed.data.groupId),
            eq(accountGroups.householdId, householdId),
          ),
        )
        .limit(1);
      if (!group[0]) {
        return { status: 'group_unavailable' };
      }
      const updated = await transaction
        .update(accounts)
        .set({
          name: parsed.data.name,
          kind: parsed.data.kind,
          groupId: parsed.data.groupId,
          status: parsed.data.status,
        })
        .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)))
        .returning({ id: accounts.id });
      if (!updated[0]) {
        return { status: 'not_found' };
      }
      const result = await getAccountInExecutor(transaction, householdId, accountId);
      return result ? { status: 'ok', account: result } : { status: 'error' };
    });
  } catch (error) {
    console.error('[accounts/update] database operation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'error' };
  }
}

type SqlExecutor = Pick<Database, 'execute'>;

async function accountReferenceSummary(
  db: SqlExecutor,
  householdId: string,
  accountId: number,
): Promise<AccountReferenceSummary> {
  const rows = await db.execute<{
    transactions: string;
    transfers: string;
    importMappings: string;
    cardConditions: string;
    debitAccounts: string;
  }>(sql`
    select
      (select count(*) from transactions where household_id = ${householdId} and account_id = ${accountId})::text as transactions,
      (select count(*) from transfers where household_id = ${householdId} and (from_account_id = ${accountId} or to_account_id = ${accountId}))::text as transfers,
      (select count(*) from account_import_mappings where household_id = ${householdId} and account_id = ${accountId})::text as "importMappings",
      (select count(*) from account_card_conditions where household_id = ${householdId} and account_id = ${accountId})::text as "cardConditions",
      (select count(*) from account_card_conditions where household_id = ${householdId} and debit_account_id = ${accountId})::text as "debitAccounts"
  `);
  const row = rows[0];
  return {
    transactions: Number(row?.transactions ?? 0),
    transfers: Number(row?.transfers ?? 0),
    importMappings: Number(row?.importMappings ?? 0),
    cardConditions: Number(row?.cardConditions ?? 0),
    debitAccounts: Number(row?.debitAccounts ?? 0),
  };
}

export async function getAccountReferenceSummary(
  db: Database,
  householdId: string,
  accountId: number,
): Promise<AccountReferenceSummary> {
  return accountReferenceSummary(db, householdId, accountId);
}

export async function deleteAccount(
  db: Database,
  householdId: string,
  accountId: number,
): Promise<AccountDeleteResult> {
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const account = await transaction
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)))
        .for('update')
        .limit(1);
      if (!account[0]) {
        return { status: 'not_found' };
      }
      const references = await accountReferenceSummary(transaction, householdId, accountId);
      const blockingReferences = {
        transactions: references.transactions,
        transfers: references.transfers,
        importMappings: references.importMappings,
        debitAccounts: references.debitAccounts,
      };
      if (Object.values(blockingReferences).some((count) => count > 0)) {
        return { status: 'referenced', references };
      }
      await transaction
        .delete(accountCardConditions)
        .where(
          and(
            eq(accountCardConditions.accountId, accountId),
            eq(accountCardConditions.householdId, householdId),
          ),
        );
      const deleted = await transaction
        .delete(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)))
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

export async function createAccountGroup(
  db: Database,
  householdId: string,
  input: AccountGroupInput,
): Promise<AccountGroupMutationResult> {
  const parsed = accountGroupInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error' };
  }
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const existing = await transaction
        .select({ id: accountGroups.id })
        .from(accountGroups)
        .where(
          and(eq(accountGroups.householdId, householdId), eq(accountGroups.name, parsed.data.name)),
        )
        .limit(1);
      if (existing[0]) {
        return { status: 'duplicate_name' };
      }
      const maxRows = await transaction
        .select({ maxSortOrder: sql<number | null>`max(${accountGroups.sortOrder})` })
        .from(accountGroups)
        .where(eq(accountGroups.householdId, householdId));
      const inserted = await transaction
        .insert(accountGroups)
        .values({
          householdId,
          name: parsed.data.name,
          sortOrder: Number(maxRows[0]?.maxSortOrder ?? 0) + 10,
        })
        .returning();
      return inserted[0] ? { status: 'ok', group: inserted[0] } : { status: 'error' };
    });
  } catch (error) {
    console.error('[account-groups/create] database operation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'error' };
  }
}

export async function renameAccountGroup(
  db: Database,
  householdId: string,
  groupId: number,
  input: AccountGroupInput,
): Promise<AccountGroupMutationResult> {
  const parsed = accountGroupInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error' };
  }
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const current = await transaction
        .select()
        .from(accountGroups)
        .where(and(eq(accountGroups.id, groupId), eq(accountGroups.householdId, householdId)))
        .for('update')
        .limit(1);
      const group = current[0];
      if (!group) {
        return { status: 'not_found' };
      }
      const duplicate = await transaction
        .select({ id: accountGroups.id })
        .from(accountGroups)
        .where(
          and(eq(accountGroups.householdId, householdId), eq(accountGroups.name, parsed.data.name)),
        )
        .limit(1);
      if (duplicate[0] && duplicate[0].id !== groupId) {
        return { status: 'duplicate_name' };
      }
      const rows = await transaction
        .update(accountGroups)
        .set({ name: parsed.data.name })
        .where(and(eq(accountGroups.id, groupId), eq(accountGroups.householdId, householdId)))
        .returning();
      return rows[0] ? { status: 'ok', group: rows[0] } : { status: 'not_found' };
    });
  } catch (error) {
    console.error('[account-groups/rename] database operation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'error' };
  }
}

export async function deleteAccountGroup(
  db: Database,
  householdId: string,
  groupId: number,
): Promise<AccountGroupMutationResult> {
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const current = await transaction
        .select()
        .from(accountGroups)
        .where(and(eq(accountGroups.id, groupId), eq(accountGroups.householdId, householdId)))
        .for('update')
        .limit(1);
      const group = current[0];
      if (!group) {
        return { status: 'not_found' };
      }
      if (group.defaultKind !== null) {
        return { status: 'default_group' };
      }
      const account = await transaction
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.householdId, householdId), eq(accounts.groupId, groupId)))
        .for('update')
        .limit(1);
      if (account[0]) {
        return { status: 'not_empty' };
      }
      const deleted = await transaction
        .delete(accountGroups)
        .where(and(eq(accountGroups.id, groupId), eq(accountGroups.householdId, householdId)))
        .returning({ id: accountGroups.id });
      return deleted[0] ? { status: 'ok', group } : { status: 'not_found' };
    });
  } catch (error) {
    console.error('[account-groups/delete] database operation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'error' };
  }
}

export async function reorderAccountGroups(
  db: Database,
  householdId: string,
  orderedIds: readonly number[],
): Promise<AccountGroupReorderResult> {
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const current = await transaction
        .select()
        .from(accountGroups)
        .where(eq(accountGroups.householdId, householdId))
        .for('update');
      const currentIds = new Set(current.map((group) => group.id));
      if (
        orderedIds.length !== current.length ||
        orderedIds.some((id) => !currentIds.has(id)) ||
        new Set(orderedIds).size !== orderedIds.length
      ) {
        return { status: 'invalid' };
      }
      for (const [index, id] of orderedIds.entries()) {
        await transaction
          .update(accountGroups)
          .set({ sortOrder: (index + 1) * 10 })
          .where(and(eq(accountGroups.id, id), eq(accountGroups.householdId, householdId)));
      }
      const groups = await transaction
        .select()
        .from(accountGroups)
        .where(eq(accountGroups.householdId, householdId))
        .orderBy(asc(accountGroups.sortOrder), asc(accountGroups.id));
      return { status: 'ok', groups };
    });
  } catch (error) {
    console.error('[account-groups/reorder] database operation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'error' };
  }
}

export async function reorderAccounts(
  db: Database,
  householdId: string,
  groupId: number,
  orderedIds: readonly number[],
): Promise<AccountReorderResult> {
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const current = await transaction
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.householdId, householdId), eq(accounts.groupId, groupId)))
        .for('update');
      const currentIds = new Set(current.map((account) => account.id));
      if (
        orderedIds.length !== current.length ||
        orderedIds.some((id) => !currentIds.has(id)) ||
        new Set(orderedIds).size !== orderedIds.length
      ) {
        return { status: 'invalid' };
      }
      for (const [index, id] of orderedIds.entries()) {
        await transaction
          .update(accounts)
          .set({ sortOrder: (index + 1) * 10 })
          .where(and(eq(accounts.id, id), eq(accounts.householdId, householdId)));
      }
      const refreshed = await transaction
        .select(accountSelect())
        .from(accounts)
        .innerJoin(
          accountGroups,
          and(eq(accountGroups.id, accounts.groupId), eq(accountGroups.householdId, householdId)),
        )
        .where(eq(accounts.householdId, householdId))
        .orderBy(asc(accountGroups.sortOrder), asc(accounts.sortOrder), asc(accounts.id));
      return { status: 'ok', accounts: refreshed };
    });
  } catch (error) {
    console.error('[accounts/reorder] database operation failed', {
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

export type CardConditionStatus =
  | 'ok'
  | 'not_card'
  | 'duplicate_effective_from'
  | 'not_after_latest'
  | 'invalid_debit_account'
  | 'not_found'
  | 'error';

export type CardConditionResult =
  | { status: 'ok'; condition: AccountCardCondition }
  | { status: Exclude<CardConditionStatus, 'ok'> };

export type CardConditionCorrectionPreviewResult =
  | {
      status: 'ok';
      before: AccountCardCondition;
      after: AccountCardCondition;
    }
  | { status: Exclude<CardConditionStatus, 'ok'> };

async function validateDebitAccount(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  householdId: string,
  cardAccountId: number,
  debitAccountId: number | null | undefined,
): Promise<boolean> {
  if (debitAccountId === null || debitAccountId === undefined) return true;
  if (debitAccountId === cardAccountId) return false;
  const debit = await cardAccount(transaction, householdId, debitAccountId);
  return debit !== null && debit.kind !== 'credit_card';
}

export async function listCardConditionHistory(
  db: Database,
  householdId: string,
  accountId: number,
): Promise<AccountCardCondition[]> {
  const rows = await db
    .select()
    .from(accountCardConditions)
    .where(
      and(
        eq(accountCardConditions.householdId, householdId),
        eq(accountCardConditions.accountId, accountId),
      ),
    );
  return rows.sort((left, right) => {
    if (left.effectiveFrom === null && right.effectiveFrom !== null) return 1;
    if (left.effectiveFrom !== null && right.effectiveFrom === null) return -1;
    return (
      (right.effectiveFrom ?? '').localeCompare(left.effectiveFrom ?? '') || right.id - left.id
    );
  });
}

export async function appendCardCondition(
  db: Database,
  householdId: string,
  accountId: number,
  input: AccountCardConditionInput,
): Promise<CardConditionResult> {
  const parsed = accountCardConditionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error' };
  }
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const account = await cardAccount(transaction, householdId, accountId);
      if (!account || account.kind !== 'credit_card') {
        return { status: 'not_card' };
      }
      if (
        !(await validateDebitAccount(
          transaction,
          householdId,
          accountId,
          parsed.data.debitAccountId,
        ))
      ) {
        return { status: 'invalid_debit_account' };
      }
      const effectiveFrom = parsed.data.effectiveFrom ?? null;
      const existingRows = await transaction
        .select({ effectiveFrom: accountCardConditions.effectiveFrom })
        .from(accountCardConditions)
        .where(
          and(
            eq(accountCardConditions.householdId, householdId),
            eq(accountCardConditions.accountId, accountId),
          ),
        );
      if (existingRows.some((row) => row.effectiveFrom === effectiveFrom)) {
        return { status: 'duplicate_effective_from' };
      }
      const latest = existingRows
        .map((row) => row.effectiveFrom)
        .filter((value): value is string => value !== null)
        .sort()
        .at(-1);
      if (effectiveFrom !== null && latest && effectiveFrom <= latest) {
        return { status: 'not_after_latest' };
      }
      const inserted = await transaction
        .insert(accountCardConditions)
        .values({
          householdId,
          accountId,
          effectiveFrom,
          closingDay: parsed.data.closingDay ?? null,
          paymentDay: parsed.data.paymentDay ?? null,
          paymentMonthOffset: parsed.data.paymentMonthOffset ?? null,
          debitAccountId: parsed.data.debitAccountId ?? null,
        })
        .returning();
      return inserted[0] ? { status: 'ok', condition: inserted[0] } : { status: 'error' };
    });
  } catch (error) {
    console.error('[accounts/card-condition] database operation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'error' };
  }
}

export async function correctCardCondition(
  db: Database,
  householdId: string,
  accountId: number,
  conditionId: number,
  input: AccountCardConditionInput,
): Promise<CardConditionResult> {
  const parsed = accountCardConditionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error' };
  }
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const account = await cardAccount(transaction, householdId, accountId);
      if (!account || account.kind !== 'credit_card') {
        return { status: 'not_card' };
      }
      const target = await transaction
        .select()
        .from(accountCardConditions)
        .where(
          and(
            eq(accountCardConditions.id, conditionId),
            eq(accountCardConditions.accountId, accountId),
            eq(accountCardConditions.householdId, householdId),
          ),
        )
        .for('update')
        .limit(1);
      if (!target[0]) {
        return { status: 'not_found' };
      }
      if (
        !(await validateDebitAccount(
          transaction,
          householdId,
          accountId,
          parsed.data.debitAccountId,
        ))
      ) {
        return { status: 'invalid_debit_account' };
      }
      const effectiveFrom = parsed.data.effectiveFrom ?? null;
      const duplicate = await transaction
        .select({ id: accountCardConditions.id })
        .from(accountCardConditions)
        .where(
          and(
            eq(accountCardConditions.householdId, householdId),
            eq(accountCardConditions.accountId, accountId),
            effectiveFrom === null
              ? isNull(accountCardConditions.effectiveFrom)
              : eq(accountCardConditions.effectiveFrom, effectiveFrom),
          ),
        )
        .limit(1);
      if (duplicate[0] && duplicate[0].id !== conditionId) {
        return { status: 'duplicate_effective_from' };
      }
      const otherRows = await transaction
        .select({
          id: accountCardConditions.id,
          effectiveFrom: accountCardConditions.effectiveFrom,
        })
        .from(accountCardConditions)
        .where(
          and(
            eq(accountCardConditions.householdId, householdId),
            eq(accountCardConditions.accountId, accountId),
          ),
        );
      const otherEffectiveDates = otherRows
        .filter((row) => row.id !== conditionId && row.effectiveFrom !== null)
        .map((row) => row.effectiveFrom as string)
        .sort();
      const previousDate =
        target[0].effectiveFrom === null
          ? undefined
          : otherEffectiveDates.filter((date) => date < target[0]!.effectiveFrom!).at(-1);
      const nextDate =
        target[0].effectiveFrom === null
          ? otherEffectiveDates[0]
          : otherEffectiveDates.find((date) => date > target[0]!.effectiveFrom!);
      if (
        effectiveFrom !== null &&
        ((previousDate !== undefined && effectiveFrom <= previousDate) ||
          (nextDate !== undefined && effectiveFrom >= nextDate))
      ) {
        return { status: 'not_after_latest' };
      }
      const updated = await transaction
        .update(accountCardConditions)
        .set({
          effectiveFrom,
          closingDay: parsed.data.closingDay ?? null,
          paymentDay: parsed.data.paymentDay ?? null,
          paymentMonthOffset: parsed.data.paymentMonthOffset ?? null,
          debitAccountId: parsed.data.debitAccountId ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(accountCardConditions.id, conditionId),
            eq(accountCardConditions.accountId, accountId),
            eq(accountCardConditions.householdId, householdId),
          ),
        )
        .returning();
      return updated[0] ? { status: 'ok', condition: updated[0] } : { status: 'not_found' };
    });
  } catch (error) {
    console.error('[accounts/card-condition-correct] database operation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'error' };
  }
}

/**
 * Validate a proposed correction while the target row is locked.
 *
 * The returned before/after values are used by the confirmation UI. The
 * correction must still be submitted through confirmCardConditionCorrection,
 * which repeats these checks in the mutating transaction.
 */
export async function previewCardConditionCorrection(
  db: Database,
  householdId: string,
  accountId: number,
  conditionId: number,
  input: AccountCardConditionInput,
): Promise<CardConditionCorrectionPreviewResult> {
  const parsed = accountCardConditionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error' };
  }
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const account = await cardAccount(transaction, householdId, accountId);
      if (!account || account.kind !== 'credit_card') {
        return { status: 'not_card' };
      }
      const target = await transaction
        .select()
        .from(accountCardConditions)
        .where(
          and(
            eq(accountCardConditions.id, conditionId),
            eq(accountCardConditions.accountId, accountId),
            eq(accountCardConditions.householdId, householdId),
          ),
        )
        .for('update')
        .limit(1);
      if (!target[0]) {
        return { status: 'not_found' };
      }
      if (
        !(await validateDebitAccount(
          transaction,
          householdId,
          accountId,
          parsed.data.debitAccountId,
        ))
      ) {
        return { status: 'invalid_debit_account' };
      }
      const effectiveFrom = parsed.data.effectiveFrom ?? null;
      const duplicate = await transaction
        .select({ id: accountCardConditions.id })
        .from(accountCardConditions)
        .where(
          and(
            eq(accountCardConditions.householdId, householdId),
            eq(accountCardConditions.accountId, accountId),
            effectiveFrom === null
              ? isNull(accountCardConditions.effectiveFrom)
              : eq(accountCardConditions.effectiveFrom, effectiveFrom),
          ),
        )
        .limit(1);
      if (duplicate[0] && duplicate[0].id !== conditionId) {
        return { status: 'duplicate_effective_from' };
      }
      const otherRows = await transaction
        .select({
          id: accountCardConditions.id,
          effectiveFrom: accountCardConditions.effectiveFrom,
        })
        .from(accountCardConditions)
        .where(
          and(
            eq(accountCardConditions.householdId, householdId),
            eq(accountCardConditions.accountId, accountId),
          ),
        );
      const otherEffectiveDates = otherRows
        .filter((row) => row.id !== conditionId && row.effectiveFrom !== null)
        .map((row) => row.effectiveFrom as string)
        .sort();
      const previousDate =
        target[0].effectiveFrom === null
          ? undefined
          : otherEffectiveDates.filter((date) => date < target[0]!.effectiveFrom!).at(-1);
      const nextDate =
        target[0].effectiveFrom === null
          ? otherEffectiveDates[0]
          : otherEffectiveDates.find((date) => date > target[0]!.effectiveFrom!);
      if (
        effectiveFrom !== null &&
        ((previousDate !== undefined && effectiveFrom <= previousDate) ||
          (nextDate !== undefined && effectiveFrom >= nextDate))
      ) {
        return { status: 'not_after_latest' };
      }
      return {
        status: 'ok',
        before: target[0],
        after: {
          ...target[0],
          effectiveFrom: parsed.data.effectiveFrom ?? null,
          closingDay: parsed.data.closingDay ?? null,
          paymentDay: parsed.data.paymentDay ?? null,
          paymentMonthOffset: parsed.data.paymentMonthOffset ?? null,
          debitAccountId: parsed.data.debitAccountId ?? null,
        },
      };
    });
  } catch (error) {
    console.error('[accounts/card-condition-preview] database operation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'error' };
  }
}

/**
 * Apply a correction after the caller has shown and received confirmation.
 * Validation and row locking are repeated by correctCardCondition so a stale
 * confirmation cannot overwrite a changed history.
 */
export async function confirmCardConditionCorrection(
  db: Database,
  householdId: string,
  accountId: number,
  conditionId: number,
  input: AccountCardConditionInput,
): Promise<CardConditionResult> {
  return correctCardCondition(db, householdId, accountId, conditionId, input);
}

export async function listAccountImportMappings(db: Database, householdId: string, source: string) {
  return db
    .select()
    .from(accountImportMappings)
    .where(
      and(
        eq(accountImportMappings.householdId, householdId),
        eq(accountImportMappings.source, source),
      ),
    )
    .orderBy(asc(accountImportMappings.sourceAccountName), asc(accountImportMappings.id));
}
