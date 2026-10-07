import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { currentTokyoDate } from './month.js';
import type { Database } from './client.js';
import { getAccountBalances, lockCardSettingsForAccounts, type AccountBalance } from './ledger.js';
import {
  accountCardSettings,
  accounts,
  households,
  transactions,
  transfers,
  type Account,
  type AccountCardSetting,
} from './schema.js';
import {
  accountCardConditionInputSchema,
  accountCreateInputSchema,
  accountUpdateInputSchema,
  requiresKindInterpretationConfirmation,
  type AccountCardConditionInput,
  type AccountCreateInput,
  type AccountUpdateInput,
} from './validation.js';

export type AccountMutationResult =
  | { status: 'ok'; account: Account }
  | { status: 'not_found' }
  | { status: 'deleted' }
  | { status: 'kind_confirmation_required'; previousKind: Account['kind']; rawBalance: string }
  | { status: 'stale_kind' }
  | { status: 'not_card' }
  | { status: 'invalid_debit_account' }
  | { status: 'error' };

export type AccountDeleteResult =
  { status: 'deleted' } | { status: 'not_found' } | { status: 'error' };

type AccountMutationFailureStatus =
  'not_found' | 'deleted' | 'not_card' | 'invalid_debit_account' | 'error';

class AccountMutationRollback extends Error {
  constructor(readonly status: AccountMutationFailureStatus) {
    super(`Account mutation failed: ${status}`);
  }
}

function accountKindOrderSql() {
  return sql<number>`case ${accounts.kind}
    when 'cash' then 0
    when 'bank' then 1
    when 'credit_card' then 2
    when 'debit_card' then 3
    when 'electronic_money' then 4
    else 5
  end`;
}

async function getAccountInExecutor(
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

export async function listManagedAccounts(db: Database, householdId: string): Promise<Account[]> {
  return db
    .select()
    .from(accounts)
    .where(eq(accounts.householdId, householdId))
    .orderBy(accountKindOrderSql(), asc(accounts.sortOrder), asc(accounts.id));
}

export async function listActiveManagedAccounts(
  db: Database,
  householdId: string,
): Promise<Account[]> {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), isNull(accounts.deletedAt)))
    .orderBy(accountKindOrderSql(), asc(accounts.sortOrder), asc(accounts.id));
}

export async function getActiveManagedAccount(
  db: Database,
  householdId: string,
  accountId: number,
): Promise<Account | null> {
  const account = await getAccountInExecutor(db, householdId, accountId);
  return account?.deletedAt === null ? account : null;
}

export interface ManagedAccountBalance extends AccountBalance {
  kind: Account['kind'];
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
): Promise<Account | null> {
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
      if (parsedCard?.success) {
        if (parsed.data.kind !== 'credit_card') {
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
          name: parsed.data.name,
          kind: parsed.data.kind,
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
      let currentCardCondition: AccountCardSetting | null = null;
      if (parsedCard?.success) {
        if (parsed.data.kind !== 'credit_card') {
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
          name: parsed.data.name,
          kind: parsed.data.kind,
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
