import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database } from './client.js';
import { monthRange } from './month.js';
import {
  accountCardSettings,
  accounts,
  categories,
  households,
  transactions,
  transfers,
  type Account,
  type AccountKind,
  type Category,
  type NewTransaction,
  type Transaction,
  type TransactionType,
  type Transfer,
} from './schema.js';
import { MAX_INT4_ID, type TransactionInput, type TransferInput } from './validation.js';

export const DEFAULT_HOUSEHOLD_ID = '00000000-0000-0000-0000-000000000001';
export const DEFAULT_HOUSEHOLD_SLUG = 'local';

export const DEFAULT_CATEGORY_SEEDS = [
  { type: 'expense', name: '食費', sortOrder: 10 },
  { type: 'expense', name: '日用品', sortOrder: 20 },
  { type: 'expense', name: '住居', sortOrder: 30 },
  { type: 'expense', name: '水道・光熱', sortOrder: 40 },
  { type: 'expense', name: '通信', sortOrder: 50 },
  { type: 'expense', name: '交通', sortOrder: 60 },
  { type: 'expense', name: '医療', sortOrder: 70 },
  { type: 'expense', name: '娯楽', sortOrder: 80 },
  { type: 'expense', name: 'その他', sortOrder: 90 },
  { type: 'income', name: '給与', sortOrder: 10 },
  { type: 'income', name: '臨時収入', sortOrder: 20 },
  { type: 'income', name: 'その他', sortOrder: 30 },
] as const satisfies ReadonlyArray<{
  type: TransactionType;
  name: string;
  sortOrder: number;
}>;

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

export async function initializeDefaultLedger(db: Database): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction
      .insert(households)
      .values({
        id: DEFAULT_HOUSEHOLD_ID,
        slug: DEFAULT_HOUSEHOLD_SLUG,
        name: '自宅',
      })
      .onConflictDoNothing({ target: households.id });

    await transaction
      .insert(categories)
      .values(
        DEFAULT_CATEGORY_SEEDS.map((category) => ({
          householdId: DEFAULT_HOUSEHOLD_ID,
          ...category,
        })),
      )
      .onConflictDoNothing();
  });
}

export async function getHousehold(db: Database, householdId: string) {
  const rows = await db.select().from(households).where(eq(households.id, householdId)).limit(1);
  return rows[0] ?? null;
}
export async function listAccounts(db: Database, householdId: string): Promise<Account[]> {
  return db
    .select()
    .from(accounts)
    .where(eq(accounts.householdId, householdId))
    .orderBy(accountKindOrderSql(), asc(accounts.sortOrder), asc(accounts.id));
}

export async function listActiveAccounts(db: Database, householdId: string): Promise<Account[]> {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), isNull(accounts.deletedAt)))
    .orderBy(accountKindOrderSql(), asc(accounts.sortOrder), asc(accounts.id));
}

export async function listCategories(
  db: Database,
  householdId: string,
  type?: TransactionType,
): Promise<Category[]> {
  const condition = type
    ? and(eq(categories.householdId, householdId), eq(categories.type, type))
    : eq(categories.householdId, householdId);
  return db
    .select()
    .from(categories)
    .where(condition)
    .orderBy(asc(categories.type), asc(categories.sortOrder));
}

export async function getCategory(
  db: Database,
  householdId: string,
  categoryId: number,
  type?: TransactionType,
): Promise<Category | null> {
  const conditions: SQL[] = [
    eq(categories.id, categoryId),
    eq(categories.householdId, householdId),
  ];
  if (type) {
    conditions.push(eq(categories.type, type));
  }
  const rows = await db
    .select()
    .from(categories)
    .where(and(...conditions))
    .limit(1);
  return rows[0] ?? null;
}

export interface TransactionFilters {
  month: string;
  type?: TransactionType;
  categoryId?: number;
  accountId?: number;
  limit?: number;
  offset?: number;
}

export interface LedgerEntryFilters {
  month: string;
  type?: TransactionType | 'transfer';
  categoryId?: number;
  accountId?: number;
}

export interface ListedTransaction {
  id: number;
  type: TransactionType;
  amount: number;
  occurredOn: string;
  categoryId: number;
  categoryName: string;
  accountId: number | null;
  accountName: string | null;
  accountKind: AccountKind | null;
  memo: string;
}

export interface ListedTransfer {
  id: number;
  type: 'transfer';
  amount: number;
  occurredOn: string;
  fromAccountId: number;
  fromAccountName: string;
  toAccountId: number;
  toAccountName: string;
  memo: string;
}

export type ListedLedgerEntry = ListedTransaction | ListedTransfer;

export type TransferValidationCode =
  'from_account_unavailable' | 'to_account_unavailable' | 'accounts_unavailable' | 'same_account';

export type TransferMutationResult =
  | { status: 'ok'; transfer: Transfer }
  | { status: 'not_found' }
  | { status: 'validation_error'; code: TransferValidationCode }
  | { status: 'error' };

export type TransferDeleteResult =
  { status: 'ok'; occurredOn: string } | { status: 'not_found' } | { status: 'error' };

function transactionConditions(householdId: string, filters: TransactionFilters): SQL[] {
  const conditions: SQL[] = [eq(transactions.householdId, householdId)];
  if (filters.month !== 'all') {
    const range = monthRange(filters.month);
    conditions.push(gte(transactions.occurredOn, range.start));
    conditions.push(lt(transactions.occurredOn, range.endExclusive));
  }
  if (filters.type === 'expense' || filters.type === 'income') {
    conditions.push(eq(transactions.type, filters.type));
  }
  if (filters.categoryId) {
    conditions.push(eq(transactions.categoryId, filters.categoryId));
  }
  if (filters.accountId !== undefined) {
    conditions.push(eq(transactions.accountId, filters.accountId));
  }
  return conditions;
}

export async function listTransactions(
  db: Database,
  householdId: string,
  filters: TransactionFilters,
): Promise<ListedTransaction[]> {
  const query = db
    .select({
      id: transactions.id,
      type: transactions.type,
      amount: transactions.amount,
      occurredOn: transactions.occurredOn,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      accountId: transactions.accountId,
      accountName: accounts.name,
      accountKind: accounts.kind,
      memo: transactions.memo,
    })
    .from(transactions)
    .innerJoin(
      categories,
      and(
        eq(categories.id, transactions.categoryId),
        eq(categories.householdId, householdId),
        eq(categories.type, transactions.type),
      ),
    )
    .leftJoin(
      accounts,
      and(eq(accounts.id, transactions.accountId), eq(accounts.householdId, householdId)),
    )
    .where(and(...transactionConditions(householdId, filters)))
    .orderBy(desc(transactions.occurredOn), desc(transactions.id));
  const limited = filters.limit ? query.limit(filters.limit) : query;
  return filters.offset ? limited.offset(filters.offset) : limited;
}

export async function listLedgerEntries(
  db: Database,
  householdId: string,
  filters: LedgerEntryFilters,
): Promise<ListedLedgerEntry[]> {
  const includeTransactions = filters.type !== 'transfer';
  const includeTransfers =
    filters.type === 'transfer' || (filters.type === undefined && filters.categoryId === undefined);
  const transactionWhere: SQL[] = [eq(transactions.householdId, householdId)];
  const transferWhere: SQL[] = [eq(transfers.householdId, householdId)];
  if (filters.month !== 'all') {
    const range = monthRange(filters.month);
    transactionWhere.push(
      gte(transactions.occurredOn, range.start),
      lt(transactions.occurredOn, range.endExclusive),
    );
    transferWhere.push(
      gte(transfers.occurredOn, range.start),
      lt(transfers.occurredOn, range.endExclusive),
    );
  }
  if (filters.type === 'expense' || filters.type === 'income') {
    transactionWhere.push(eq(transactions.type, filters.type));
  }
  if (filters.categoryId && filters.type !== 'transfer') {
    transactionWhere.push(eq(transactions.categoryId, filters.categoryId));
  }
  if (filters.accountId !== undefined) {
    transactionWhere.push(eq(transactions.accountId, filters.accountId));
    transferWhere.push(
      or(
        eq(transfers.fromAccountId, filters.accountId),
        eq(transfers.toAccountId, filters.accountId),
      )!,
    );
  }
  const parts: SQL[] = [];
  if (includeTransactions) {
    parts.push(sql`
      select
        ${transactions.id} as id,
        ${transactions.type}::text as entry_type,
        ${transactions.amount} as amount,
        ${transactions.occurredOn} as occurred_on,
        ${transactions.categoryId} as category_id,
        ${categories.name} as category_name,
        ${transactions.accountId} as account_id,
        ${accounts.name} as account_name,
        ${accounts.kind}::text as account_kind,
        null::integer as from_account_id,
        null::text as from_account_name,
        null::integer as to_account_id,
        null::text as to_account_name,
        ${transactions.memo} as memo
      from ${transactions}
      inner join ${categories}
        on ${categories.id} = ${transactions.categoryId}
        and ${categories.householdId} = ${householdId}
        and ${categories.type} = ${transactions.type}
      left join ${accounts}
        on ${accounts.id} = ${transactions.accountId}
        and ${accounts.householdId} = ${householdId}
      where ${sql.join(transactionWhere, sql` and `)}
    `);
  }
  if (includeTransfers) {
    const fromAccounts = alias(accounts, 'transfer_from_accounts');
    const toAccounts = alias(accounts, 'transfer_to_accounts');
    parts.push(sql`
      select
        ${transfers.id} as id,
        'transfer'::text as entry_type,
        ${transfers.amount} as amount,
        ${transfers.occurredOn} as occurred_on,
        null::integer as category_id,
        null::text as category_name,
        null::integer as account_id,
        null::text as account_name,
        null::text as account_kind,
        ${transfers.fromAccountId} as from_account_id,
        ${fromAccounts.name} as from_account_name,
        ${transfers.toAccountId} as to_account_id,
        ${toAccounts.name} as to_account_name,
        ${transfers.memo} as memo
      from ${transfers}
      inner join ${accounts} as transfer_from_accounts
        on ${fromAccounts.id} = ${transfers.fromAccountId}
        and ${fromAccounts.householdId} = ${householdId}
      inner join ${accounts} as transfer_to_accounts
        on ${toAccounts.id} = ${transfers.toAccountId}
        and ${toAccounts.householdId} = ${householdId}
      where ${sql.join(transferWhere, sql` and `)}
    `);
  }
  if (parts.length === 0) return [];
  const rows = await db.execute<{
    id: number;
    entry_type: string;
    amount: number;
    occurred_on: string;
    category_id: number | null;
    category_name: string | null;
    account_id: number | null;
    account_name: string | null;
    account_kind: AccountKind | null;
    from_account_id: number | null;
    from_account_name: string | null;
    to_account_id: number | null;
    to_account_name: string | null;
    memo: string;
  }>(sql`
    select *
    from (${sql.join(parts, sql` union all `)}) as ledger_entries
    order by occurred_on desc, id desc, (entry_type = 'transfer') desc
  `);
  return rows.map((row) =>
    row.entry_type === 'transfer'
      ? {
          id: row.id,
          type: 'transfer' as const,
          amount: row.amount,
          occurredOn: row.occurred_on,
          fromAccountId: row.from_account_id!,
          fromAccountName: row.from_account_name!,
          toAccountId: row.to_account_id!,
          toAccountName: row.to_account_name!,
          memo: row.memo,
        }
      : {
          id: row.id,
          type: row.entry_type as TransactionType,
          amount: row.amount,
          occurredOn: row.occurred_on,
          categoryId: row.category_id!,
          categoryName: row.category_name!,
          accountId: row.account_id,
          accountName: row.account_name,
          accountKind: row.account_kind,
          memo: row.memo,
        },
  );
}

export async function getTransaction(
  db: Database,
  householdId: string,
  id: number,
): Promise<ListedTransaction | null> {
  const rows = await db
    .select({
      id: transactions.id,
      type: transactions.type,
      amount: transactions.amount,
      occurredOn: transactions.occurredOn,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      accountId: transactions.accountId,
      accountName: accounts.name,
      accountKind: accounts.kind,
      memo: transactions.memo,
    })
    .from(transactions)
    .innerJoin(
      categories,
      and(
        eq(categories.id, transactions.categoryId),
        eq(categories.householdId, householdId),
        eq(categories.type, transactions.type),
      ),
    )
    .leftJoin(
      accounts,
      and(eq(accounts.id, transactions.accountId), eq(accounts.householdId, householdId)),
    )
    .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getTransfer(
  db: Database,
  householdId: string,
  id: number,
): Promise<ListedTransfer | null> {
  const fromAccounts = alias(accounts, 'transfer_from_accounts');
  const toAccounts = alias(accounts, 'transfer_to_accounts');
  const rows = await db
    .select({
      id: transfers.id,
      amount: transfers.amount,
      occurredOn: transfers.occurredOn,
      fromAccountId: transfers.fromAccountId,
      fromAccountName: fromAccounts.name,
      toAccountId: transfers.toAccountId,
      toAccountName: toAccounts.name,
      memo: transfers.memo,
    })
    .from(transfers)
    .innerJoin(
      fromAccounts,
      and(eq(fromAccounts.id, transfers.fromAccountId), eq(fromAccounts.householdId, householdId)),
    )
    .innerJoin(
      toAccounts,
      and(eq(toAccounts.id, transfers.toAccountId), eq(toAccounts.householdId, householdId)),
    )
    .where(and(eq(transfers.id, id), eq(transfers.householdId, householdId)))
    .limit(1);
  const transfer = rows[0];
  return transfer ? { ...transfer, type: 'transfer' } : null;
}

export interface AccountBalance {
  accountId: number;
  accountName: string;
  income: string;
  expense: string;
  transfersIn: string;
  transfersOut: string;
  balance: string;
}

interface AccountBalanceRow {
  [key: string]: unknown;
  accountId: number;
  accountName: string;
  income: string;
  expense: string;
  transfersIn: string;
  transfersOut: string;
  balance: string;
}

// Transactions without an account_id are manual entries and stay out of per-account balances.
export async function getAccountBalances(
  db: Database,
  householdId: string,
): Promise<AccountBalance[]> {
  const rows = await db.execute<AccountBalanceRow>(sql`
    select
      a.id as "accountId",
      a.name as "accountName",
      coalesce(tx.income, 0)::text as income,
      coalesce(tx.expense, 0)::text as expense,
      coalesce(tin.transfers_in, 0)::text as "transfersIn",
      coalesce(tout.transfers_out, 0)::text as "transfersOut",
      (
        coalesce(tx.income, 0)
        - coalesce(tx.expense, 0)
        - coalesce(tout.transfers_out, 0)
        + coalesce(tin.transfers_in, 0)
      )::text as balance
    from ${accounts} a
    left join (
      select
        household_id,
        account_id,
        sum(case when type = 'income' then amount else 0 end)::bigint as income,
        sum(case when type = 'expense' then amount else 0 end)::bigint as expense
      from ${transactions}
      where household_id = ${householdId} and account_id is not null
      group by household_id, account_id
    ) tx on tx.household_id = a.household_id and tx.account_id = a.id
    left join (
      select household_id, to_account_id as account_id, sum(amount)::bigint as transfers_in
      from ${transfers}
      where household_id = ${householdId}
      group by household_id, to_account_id
    ) tin on tin.household_id = a.household_id and tin.account_id = a.id
    left join (
      select household_id, from_account_id as account_id, sum(amount)::bigint as transfers_out
      from ${transfers}
      where household_id = ${householdId}
      group by household_id, from_account_id
    ) tout on tout.household_id = a.household_id and tout.account_id = a.id
    where a.household_id = ${householdId}
    order by case a.kind
      when 'cash' then 0
      when 'bank' then 1
      when 'credit_card' then 2
      when 'debit_card' then 3
      when 'electronic_money' then 4
      else 5
    end, a.sort_order, a.id
  `);
  return rows;
}

export async function getAccountBalance(
  db: Database,
  householdId: string,
  accountId: number,
): Promise<AccountBalance | null> {
  const rows = (await getAccountBalances(db, householdId)).filter(
    (balance) => balance.accountId === accountId,
  );
  return rows[0] ?? null;
}

export interface MonthlyTotals {
  income: string;
  expense: string;
  difference: string;
}

export function calculateDifference(income: string, expense: string): string {
  return (BigInt(income) - BigInt(expense)).toString();
}

export async function getMonthlyTotals(
  db: Database,
  householdId: string,
  month: string,
): Promise<MonthlyTotals> {
  const range = monthRange(month);
  const rows = await db
    .select({
      income: sql<string>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} else 0 end), 0)::text`,
      expense: sql<string>`coalesce(sum(case when ${transactions.type} = 'expense' then ${transactions.amount} else 0 end), 0)::text`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        gte(transactions.occurredOn, range.start),
        lt(transactions.occurredOn, range.endExclusive),
      ),
    );
  const income = rows[0]?.income ?? '0';
  const expense = rows[0]?.expense ?? '0';
  return {
    income,
    expense,
    difference: calculateDifference(income, expense),
  };
}

export interface ExpenseCategoryTotal {
  categoryId: number;
  categoryName: string;
  total: string;
}

export async function getExpenseCategoryTotals(
  db: Database,
  householdId: string,
  month: string,
): Promise<ExpenseCategoryTotal[]> {
  const range = monthRange(month);
  const total = sql<string>`sum(${transactions.amount})::text`;
  const numericTotal = sql<number>`sum(${transactions.amount})`;
  return db
    .select({
      categoryId: categories.id,
      categoryName: categories.name,
      total,
    })
    .from(transactions)
    .innerJoin(
      categories,
      and(
        eq(categories.id, transactions.categoryId),
        eq(categories.householdId, householdId),
        eq(categories.type, transactions.type),
      ),
    )
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.type, 'expense'),
        gte(transactions.occurredOn, range.start),
        lt(transactions.occurredOn, range.endExclusive),
      ),
    )
    .groupBy(categories.id, categories.name)
    .orderBy(desc(numericTotal), asc(categories.id));
}

export async function createTransaction(
  db: Database,
  householdId: string,
  input: TransactionInput,
): Promise<Transaction> {
  return db.transaction(async (transaction) => {
    await lockCardSettingsForAccounts(
      transaction,
      householdId,
      input.accountId === undefined || input.accountId === null ? [] : [input.accountId],
    );
    const values: NewTransaction = {
      householdId,
      type: input.type,
      amount: input.amount,
      occurredOn: input.occurredOn,
      categoryId: input.categoryId,
      accountId: input.accountId ?? null,
      memo: input.memo,
    };
    const rows = await transaction.insert(transactions).values(values).returning();
    const created = rows[0];
    if (!created) {
      throw new Error('Transaction insert returned no row');
    }
    return created;
  });
}

export async function updateTransaction(
  db: Database,
  householdId: string,
  id: number,
  input: TransactionInput,
): Promise<Transaction | null> {
  return db.transaction(async (transaction) => {
    const existingRows = await transaction
      .select({ id: transactions.id, accountId: transactions.accountId })
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId)))
      .for('update')
      .limit(1);
    const existing = existingRows[0];
    if (!existing) return null;
    const nextAccountId = input.accountId === undefined ? existing.accountId : input.accountId;
    await lockCardSettingsForAccounts(transaction, householdId, [
      ...(existing.accountId === null ? [] : [existing.accountId]),
      ...(nextAccountId === null || nextAccountId === undefined ? [] : [nextAccountId]),
    ]);
    const values = {
      type: input.type,
      amount: input.amount,
      occurredOn: input.occurredOn,
      categoryId: input.categoryId,
      ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
      memo: input.memo,
      updatedAt: new Date(),
    };
    const rows = await transaction
      .update(transactions)
      .set(values)
      .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId)))
      .returning();
    return rows[0] ?? null;
  });
}

export async function deleteTransaction(
  db: Database,
  householdId: string,
  id: number,
): Promise<Pick<Transaction, 'occurredOn'> | null> {
  return db.transaction(async (transaction) => {
    const existingRows = await transaction
      .select({ id: transactions.id, accountId: transactions.accountId })
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId)))
      .for('update')
      .limit(1);
    const existing = existingRows[0];
    if (!existing) return null;
    await lockCardSettingsForAccounts(
      transaction,
      householdId,
      existing.accountId === null ? [] : [existing.accountId],
    );
    const rows = await transaction
      .delete(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId)))
      .returning({ occurredOn: transactions.occurredOn });
    return rows[0] ?? null;
  });
}

export type LedgerTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type LedgerExecutor = Database | LedgerTransaction;

/**
 * Serialize ledger, account, and import mutations touching a credit-card account
 * with billing worker/settings updates. Cards without a settings row lock their
 * account row so creating the first settings row is serialized as well.
 */
export async function lockCardSettingsForAccounts(
  db: LedgerExecutor,
  householdId: string,
  accountIds: readonly number[],
): Promise<void> {
  const ids = [
    ...new Set(accountIds.filter((id) => Number.isSafeInteger(id) && id > 0 && id <= MAX_INT4_ID)),
  ];
  if (ids.length === 0) return;
  const endpointRows = await db
    .select({ id: accounts.id, kind: accounts.kind })
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), inArray(accounts.id, ids)))
    .orderBy(asc(accounts.id));
  for (const account of endpointRows) {
    if (account.kind !== 'credit_card') continue;
    const settings = await db
      .select({ id: accountCardSettings.id })
      .from(accountCardSettings)
      .where(
        and(
          eq(accountCardSettings.householdId, householdId),
          eq(accountCardSettings.accountId, account.id),
        ),
      )
      .for('update')
      .limit(1);
    if (settings.length === 0) {
      await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.householdId, householdId), eq(accounts.id, account.id)))
        .for('update')
        .limit(1);
    }
  }
}

async function validateTransferAccounts(
  db: LedgerExecutor,
  householdId: string,
  fromAccountId: number,
  toAccountId: number,
  allowedDeletedAccountIds: readonly number[] = [],
): Promise<TransferValidationCode | null> {
  const fromInvalid =
    !Number.isSafeInteger(fromAccountId) || fromAccountId < 1 || fromAccountId > MAX_INT4_ID;
  const toInvalid =
    !Number.isSafeInteger(toAccountId) || toAccountId < 1 || toAccountId > MAX_INT4_ID;
  if (fromInvalid && toInvalid) {
    return 'accounts_unavailable';
  }
  if (fromInvalid) {
    return 'from_account_unavailable';
  }
  if (toInvalid) {
    return 'to_account_unavailable';
  }
  if (fromAccountId === toAccountId) {
    return 'same_account';
  }
  const accountRows = await db
    .select({ id: accounts.id, deletedAt: accounts.deletedAt })
    .from(accounts)
    .where(
      and(
        eq(accounts.householdId, householdId),
        inArray(accounts.id, [fromAccountId, toAccountId]),
      ),
    );
  const allowedDeleted = new Set(allowedDeletedAccountIds);
  const accountAvailable = (id: number, deletedAt: Date | null) =>
    deletedAt === null || allowedDeleted.has(id);
  const fromAvailable = accountRows.some(
    (account) => account.id === fromAccountId && accountAvailable(account.id, account.deletedAt),
  );
  const toAvailable = accountRows.some(
    (account) => account.id === toAccountId && accountAvailable(account.id, account.deletedAt),
  );
  if (fromAvailable && toAvailable) {
    return null;
  }
  if (!fromAvailable && !toAvailable) {
    return 'accounts_unavailable';
  }
  return fromAvailable ? 'to_account_unavailable' : 'from_account_unavailable';
}

export async function createTransfer(
  db: Database,
  householdId: string,
  input: TransferInput,
): Promise<TransferMutationResult> {
  try {
    return await db.transaction(async (transaction) => {
      await lockCardSettingsForAccounts(transaction, householdId, [
        input.fromAccountId,
        input.toAccountId,
      ]);
      const validationCode = await validateTransferAccounts(
        transaction,
        householdId,
        input.fromAccountId,
        input.toAccountId,
      );
      if (validationCode) {
        return { status: 'validation_error', code: validationCode };
      }
      const rows = await transaction
        .insert(transfers)
        .values({
          householdId,
          fromAccountId: input.fromAccountId,
          toAccountId: input.toAccountId,
          amount: input.amount,
          occurredOn: input.occurredOn,
          memo: input.memo,
        })
        .returning();
      const transfer = rows[0];
      return transfer ? { status: 'ok', transfer } : { status: 'error' };
    });
  } catch (error) {
    console.error('[ledger/createTransfer] database operation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'error' };
  }
}

export async function updateTransfer(
  db: Database,
  householdId: string,
  id: number,
  input: TransferInput,
): Promise<TransferMutationResult> {
  try {
    return await db.transaction(async (transaction) => {
      const targetRows = await transaction
        .select({
          id: transfers.id,
          fromAccountId: transfers.fromAccountId,
          toAccountId: transfers.toAccountId,
        })
        .from(transfers)
        .where(and(eq(transfers.id, id), eq(transfers.householdId, householdId)))
        .for('update')
        .limit(1);
      if (!targetRows[0]) {
        return { status: 'not_found' };
      }
      await lockCardSettingsForAccounts(transaction, householdId, [
        targetRows[0].fromAccountId,
        targetRows[0].toAccountId,
        input.fromAccountId,
        input.toAccountId,
      ]);
      const validationCode = await validateTransferAccounts(
        transaction,
        householdId,
        input.fromAccountId,
        input.toAccountId,
        [targetRows[0].fromAccountId, targetRows[0].toAccountId],
      );
      if (validationCode) {
        return { status: 'validation_error', code: validationCode };
      }
      const rows = await transaction
        .update(transfers)
        .set({
          fromAccountId: input.fromAccountId,
          toAccountId: input.toAccountId,
          amount: input.amount,
          occurredOn: input.occurredOn,
          memo: input.memo,
          updatedAt: new Date(),
        })
        .where(and(eq(transfers.id, id), eq(transfers.householdId, householdId)))
        .returning();
      const transfer = rows[0];
      return transfer ? { status: 'ok', transfer } : { status: 'not_found' };
    });
  } catch (error) {
    console.error('[ledger/updateTransfer] database operation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'error' };
  }
}

export type TransactionConversionResult =
  | { status: 'ok'; transaction: Transaction }
  | { status: 'not_found' }
  | { status: 'validation_error'; code: 'category_unavailable' }
  | { status: 'error' };

export async function convertTransactionToTransfer(
  db: Database,
  householdId: string,
  id: number,
  input: TransferInput,
): Promise<TransferMutationResult> {
  try {
    return await db.transaction(async (transaction) => {
      const sourceRows = await transaction
        .select({ id: transactions.id, accountId: transactions.accountId })
        .from(transactions)
        .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId)))
        .limit(1)
        .for('update');
      if (!sourceRows[0]) {
        return { status: 'not_found' };
      }
      await lockCardSettingsForAccounts(
        transaction,
        householdId,
        sourceRows[0].accountId === null
          ? [input.fromAccountId, input.toAccountId]
          : [sourceRows[0].accountId, input.fromAccountId, input.toAccountId],
      );
      const validationCode = await validateTransferAccounts(
        transaction,
        householdId,
        input.fromAccountId,
        input.toAccountId,
      );
      if (validationCode) {
        return { status: 'validation_error', code: validationCode };
      }
      const inserted = await transaction
        .insert(transfers)
        .values({
          householdId,
          fromAccountId: input.fromAccountId,
          toAccountId: input.toAccountId,
          amount: input.amount,
          occurredOn: input.occurredOn,
          memo: input.memo,
        })
        .returning();
      const transfer = inserted[0];
      if (!transfer) {
        throw new Error('Transaction conversion insert returned no row');
      }
      const deleted = await transaction
        .delete(transactions)
        .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId)))
        .returning({ id: transactions.id });
      if (!deleted[0]) {
        throw new Error('Transaction conversion delete returned no row');
      }
      return { status: 'ok', transfer };
    });
  } catch (error) {
    console.error('[ledger/convertTransactionToTransfer] database operation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'error' };
  }
}

export async function convertTransferToTransaction(
  db: Database,
  householdId: string,
  id: number,
  input: TransactionInput,
): Promise<TransactionConversionResult> {
  try {
    return await db.transaction(async (transaction) => {
      const sourceRows = await transaction
        .select({
          id: transfers.id,
          fromAccountId: transfers.fromAccountId,
          toAccountId: transfers.toAccountId,
        })
        .from(transfers)
        .where(and(eq(transfers.id, id), eq(transfers.householdId, householdId)))
        .limit(1)
        .for('update');
      if (!sourceRows[0]) {
        return { status: 'not_found' };
      }
      await lockCardSettingsForAccounts(transaction, householdId, [
        sourceRows[0].fromAccountId,
        sourceRows[0].toAccountId,
      ]);
      const categoryRows = await transaction
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.id, input.categoryId),
            eq(categories.householdId, householdId),
            eq(categories.type, input.type),
          ),
        )
        .limit(1);
      if (!categoryRows[0]) {
        return { status: 'validation_error', code: 'category_unavailable' };
      }
      const inserted = await transaction
        .insert(transactions)
        .values({
          householdId,
          type: input.type,
          amount: input.amount,
          occurredOn: input.occurredOn,
          categoryId: input.categoryId,
          accountId: null,
          memo: input.memo,
        })
        .returning();
      const transactionRow = inserted[0];
      if (!transactionRow) {
        throw new Error('Transfer conversion insert returned no row');
      }
      const deleted = await transaction
        .delete(transfers)
        .where(and(eq(transfers.id, id), eq(transfers.householdId, householdId)))
        .returning({ id: transfers.id });
      if (!deleted[0]) {
        throw new Error('Transfer conversion delete returned no row');
      }
      return { status: 'ok', transaction: transactionRow };
    });
  } catch (error) {
    console.error('[ledger/convertTransferToTransaction] database operation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'error' };
  }
}

export async function deleteTransfer(
  db: Database,
  householdId: string,
  id: number,
): Promise<TransferDeleteResult> {
  try {
    const rows = await db.transaction(async (transaction) => {
      const targetRows = await transaction
        .select({
          id: transfers.id,
          fromAccountId: transfers.fromAccountId,
          toAccountId: transfers.toAccountId,
        })
        .from(transfers)
        .where(and(eq(transfers.id, id), eq(transfers.householdId, householdId)))
        .for('update')
        .limit(1);
      const target = targetRows[0];
      if (!target) return [];
      await lockCardSettingsForAccounts(transaction, householdId, [
        target.fromAccountId,
        target.toAccountId,
      ]);
      return transaction
        .delete(transfers)
        .where(and(eq(transfers.id, id), eq(transfers.householdId, householdId)))
        .returning({ occurredOn: transfers.occurredOn });
    });
    const deleted = rows[0];
    return deleted ? { status: 'ok', occurredOn: deleted.occurredOn } : { status: 'not_found' };
  } catch (error) {
    console.error('[ledger/deleteTransfer] database operation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { status: 'error' };
  }
}
