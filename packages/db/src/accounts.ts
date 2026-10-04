import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { currentTokyoDate } from './month.js';
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
  type AccountImportMapping,
} from './schema.js';
import {
  accountCardConditionInputSchema,
  accountCreateInputSchema,
  accountNameSchema,
  accountUpdateInputSchema,
  requiresKindInterpretationConfirmation,
  type AccountCardConditionInput,
  type AccountCreateInput,
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
  { status: 'deleted' } | { status: 'not_found' } | { status: 'error' };

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (candidate.code === '23505') return true;
    current = candidate.cause;
  }
  return false;
}
function accountSelect() {
  return {
    id: accounts.id,
    householdId: accounts.householdId,
    name: accounts.name,
    kind: accounts.kind,
    groupId: accounts.groupId,
    status: accounts.status,
    deletedAt: accounts.deletedAt,
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

export async function listActiveManagedAccounts(
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
    .where(and(eq(accounts.householdId, householdId), isNull(accounts.deletedAt)))
    .orderBy(asc(accountGroups.sortOrder), asc(accounts.sortOrder), asc(accounts.id));
}

export async function getActiveManagedAccount(
  db: Database,
  householdId: string,
  accountId: number,
): Promise<AccountWithGroup | null> {
  const account = await getAccountInExecutor(db, householdId, accountId);
  return account?.deletedAt === null ? account : null;
}
export interface ManagedAccountBalance extends AccountBalance {
  kind: Account['kind'];
  groupId: number;
  groupName: string;
  status: Account['status'];
  deletedAt: Account['deletedAt'];
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
            deletedAt: account.deletedAt,
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
  const byKind = ['cash', 'bank', 'credit_card', 'debit_card'].includes(kind)
    ? await transaction
        .select()
        .from(accountGroups)
        .where(and(eq(accountGroups.householdId, householdId), eq(accountGroups.defaultKind, kind)))
        .limit(1)
    : [];
  if (byKind[0]) return byKind[0];
  const legacyName = kind === 'electronic_money' ? '電子マネー' : 'その他';
  const legacy = await transaction
    .select()
    .from(accountGroups)
    .where(and(eq(accountGroups.householdId, householdId), eq(accountGroups.name, legacyName)))
    .limit(1);
  if (legacy[0]) return legacy[0];
  const fallback = await transaction
    .select()
    .from(accountGroups)
    .where(eq(accountGroups.householdId, householdId))
    .orderBy(asc(accountGroups.sortOrder), asc(accountGroups.id))
    .limit(1);
  return fallback[0] ?? null;
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
          status: account.status,
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

export async function deleteAccount(
  db: Database,
  householdId: string,
  accountId: number,
): Promise<AccountDeleteResult> {
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
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

export type CardConditionStatus =
  'ok' | 'not_card' | 'invalid_debit_account' | 'not_found' | 'error';

export type CardConditionResult =
  | { status: 'ok'; condition: AccountCardCondition }
  | { status: Exclude<CardConditionStatus, 'ok'> };

async function validateDebitAccount(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  householdId: string,
  cardAccountId: number,
  debitAccountId: number | null | undefined,
  allowedDeletedAccountId?: number | null,
): Promise<boolean> {
  if (debitAccountId === null || debitAccountId === undefined) return true;
  if (debitAccountId === cardAccountId) return false;
  const debit = await cardAccount(transaction, householdId, debitAccountId);
  return (
    debit !== null &&
    debit.kind !== 'credit_card' &&
    (debit.deletedAt === null || debit.id === allowedDeletedAccountId)
  );
}

async function listCardConditionHistory(
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

function chooseCurrentCardCondition(
  conditions: readonly AccountCardCondition[],
  today = currentTokyoDate(),
): AccountCardCondition | null {
  const effective = conditions
    .filter(
      (condition): condition is AccountCardCondition & { effectiveFrom: string } =>
        condition.effectiveFrom !== null,
    )
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom));
  return (
    effective.find((condition) => condition.effectiveFrom <= today) ??
    conditions.find((condition) => condition.effectiveFrom === null) ??
    effective.at(-1) ??
    null
  );
}

/**
 * Select the current condition while retaining any historical rows.
 * Past/current conditions win, then the unset condition, then the earliest future row.
 */
export async function getCurrentCardCondition(
  db: Database,
  householdId: string,
  accountId: number,
): Promise<AccountCardCondition | null> {
  const account = await cardAccount(db, householdId, accountId);
  if (!account || account.kind !== 'credit_card') return null;
  return chooseCurrentCardCondition(await listCardConditionHistory(db, householdId, accountId));
}

export async function saveCurrentCardCondition(
  db: Database,
  householdId: string,
  accountId: number,
  input: AccountCardConditionInput,
): Promise<CardConditionResult> {
  const parsed = accountCardConditionInputSchema.safeParse(input);
  if (!parsed.success) return { status: 'error' };
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const account = await cardAccount(transaction, householdId, accountId);
      if (!account || account.kind !== 'credit_card') return { status: 'not_card' };
      const conditions = await transaction
        .select()
        .from(accountCardConditions)
        .where(
          and(
            eq(accountCardConditions.householdId, householdId),
            eq(accountCardConditions.accountId, accountId),
          ),
        )
        .for('update');
      const current = chooseCurrentCardCondition(conditions);
      if (
        !(await validateDebitAccount(
          transaction,
          householdId,
          accountId,
          parsed.data.debitAccountId,
          current?.debitAccountId,
        ))
      ) {
        return { status: 'invalid_debit_account' };
      }
      const values = {
        closingDay: parsed.data.closingDay ?? null,
        paymentDay: parsed.data.paymentDay ?? null,
        paymentMonthOffset: parsed.data.paymentMonthOffset ?? null,
        debitAccountId: parsed.data.debitAccountId ?? null,
        updatedAt: new Date(),
      };
      if (current) {
        const updated = await transaction
          .update(accountCardConditions)
          .set(values)
          .where(
            and(
              eq(accountCardConditions.id, current.id),
              eq(accountCardConditions.householdId, householdId),
              eq(accountCardConditions.accountId, accountId),
            ),
          )
          .returning();
        return updated[0] ? { status: 'ok', condition: updated[0] } : { status: 'not_found' };
      }
      const inserted = await transaction
        .insert(accountCardConditions)
        .values({
          householdId,
          accountId,
          effectiveFrom: null,
          ...values,
          createdAt: new Date(),
        })
        .returning();
      return inserted[0] ? { status: 'ok', condition: inserted[0] } : { status: 'error' };
    });
  } catch (error) {
    console.error('[accounts/card-condition-save] database operation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'error' };
  }
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

export interface AccountImportMappingInput {
  id?: number;
  sourceAccountId?: string | null;
  sourceAccountName: string;
}

export type AccountImportMappingMutationResult =
  | { status: 'ok'; mappings: AccountImportMapping[] }
  | { status: 'not_found' | 'conflict' | 'invalid' | 'error' };

export async function listAccountImportMappingsForAccount(
  db: Database,
  householdId: string,
  accountId: number,
  source = 'realbyte-money-manager',
): Promise<AccountImportMapping[]> {
  return db
    .select()
    .from(accountImportMappings)
    .where(
      and(
        eq(accountImportMappings.householdId, householdId),
        eq(accountImportMappings.accountId, accountId),
        eq(accountImportMappings.source, source),
      ),
    )
    .orderBy(asc(accountImportMappings.sourceAccountName), asc(accountImportMappings.id));
}

export async function setAccountImportMappings(
  db: Database,
  householdId: string,
  accountId: number,
  inputs: readonly AccountImportMappingInput[],
  source = 'realbyte-money-manager',
): Promise<AccountImportMappingMutationResult> {
  const parsed = inputs.map((input) => ({
    ...input,
    sourceAccountName: accountNameSchema.safeParse(input.sourceAccountName),
  }));
  if (parsed.some((input) => !input.sourceAccountName.success)) {
    return { status: 'invalid' };
  }
  const names = parsed.map((input) =>
    input.sourceAccountName.success ? input.sourceAccountName.data : '',
  );
  if (new Set(names.map((name) => name.toLocaleLowerCase())).size !== names.length) {
    return { status: 'conflict' };
  }
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, householdId);
      const account = await transaction
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)))
        .for('update')
        .limit(1);
      if (!account[0]) return { status: 'not_found' };
      const current = await transaction
        .select()
        .from(accountImportMappings)
        .where(
          and(
            eq(accountImportMappings.householdId, householdId),
            eq(accountImportMappings.source, source),
          ),
        )
        .for('update');
      const byId = new Map(current.map((mapping) => [mapping.id, mapping]));
      for (const [index, input] of parsed.entries()) {
        const name = names[index] ?? '';
        const existing = input.id === undefined ? undefined : byId.get(input.id);
        if (input.id !== undefined && (!existing || existing.accountId !== accountId)) {
          return { status: 'conflict' };
        }
        if (!existing) {
          const sourceAccountId = input.sourceAccountId ?? null;
          const duplicate = current.find(
            (mapping) =>
              mapping.accountId !== accountId &&
              (mapping.sourceAccountName === name ||
                (sourceAccountId !== null && mapping.sourceAccountId === sourceAccountId)),
          );
          if (duplicate) return { status: 'conflict' };
          try {
            await transaction.insert(accountImportMappings).values({
              householdId,
              source,
              sourceAccountId: input.sourceAccountId ?? null,
              sourceAccountName: name,
              accountId,
            });
          } catch (error) {
            if (isUniqueViolation(error)) {
              return { status: 'conflict' };
            }
            throw error;
          }
        } else {
          const duplicate = current.find(
            (mapping) => mapping.id !== existing.id && mapping.sourceAccountName === name,
          );
          if (duplicate) return { status: 'conflict' };
          await transaction
            .update(accountImportMappings)
            .set({ sourceAccountName: name, updatedAt: new Date() })
            .where(eq(accountImportMappings.id, existing.id));
        }
        void index;
      }
      return {
        status: 'ok',
        mappings: await listAccountImportMappingsForAccount(
          transaction,
          householdId,
          accountId,
          source,
        ),
      };
    });
  } catch (error) {
    console.error('[accounts/import-mappings] database operation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'error' };
  }
}
