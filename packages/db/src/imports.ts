import { and, eq, sql } from 'drizzle-orm';

import type { Database } from './client.js';
import {
  accounts,
  categories,
  households,
  transactionImports,
  transactions,
  transfers,
  type TransactionType,
} from './schema.js';
import {
  MONEY_MANAGER_SOURCE,
  planMoneyManagerCategories,
  type MoneyManagerLedgerRow,
  type ExistingMoneyManagerCategory,
  type MoneyManagerNormalizedRow,
  type MoneyManagerTransferRow,
} from './money-manager-format.js';
import { lockCardSettingsForAccounts } from './ledger.js';
import type {
  MoneyManagerImportAccountSummary,
  MoneyManagerImportCategorySummary,
  MoneyManagerImportCommitResult,
  MoneyManagerImportCounts,
  MoneyManagerImportPeriod,
} from './money-manager-import-contract.js';

const TRANSACTION_INSERT_CHUNK_SIZE = 500;
const CATEGORY_SORT_STEP = 10;
const DUPLICATE_IMPORT_CONSTRAINT = 'transaction_imports_household_source_operation_unique';

interface AccountImportResult {
  summaries: MoneyManagerImportAccountSummary[];
  byKey: Map<string, number>;
}

export interface MoneyManagerImportInput {
  householdId: string;
  source?: string;
  sha256: string;
  operationKey?: string;
  originalFilename: string;
  rows: readonly MoneyManagerNormalizedRow[];
}

function categoryKey(type: TransactionType, name: string): string {
  return `${type}\u0000${name}`;
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as {
      code?: unknown;
      constraint_name?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (
      candidate.code === '23505' &&
      (candidate.constraint_name === constraint || candidate.constraint === constraint)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

async function lockHousehold(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  householdId: string,
): Promise<void> {
  const rows = await transaction.execute<{ id: string }>(
    sql`select ${households.id} from ${households} where ${households.id} = ${householdId} for update`,
  );
  if (rows.length === 0) {
    throw new Error('Household not found');
  }
}

function countsForRows(rows: readonly MoneyManagerNormalizedRow[]): MoneyManagerImportCounts {
  const counts: MoneyManagerImportCounts = {
    income: { count: 0, total: '0' },
    expense: { count: 0, total: '0' },
    transfer: { count: 0, total: '0' },
  };
  const totals = { income: 0n, expense: 0n, transfer: 0n };
  for (const row of rows) {
    counts[row.type].count += 1;
    totals[row.type] += BigInt(row.amount);
  }
  counts.income.total = totals.income.toString();
  counts.expense.total = totals.expense.toString();
  counts.transfer.total = totals.transfer.toString();
  return counts;
}

function periodForRows(
  rows: readonly MoneyManagerNormalizedRow[],
): MoneyManagerImportPeriod | undefined {
  const first = rows[0];
  if (!first) {
    return undefined;
  }
  let from = first.occurredOn;
  let to = first.occurredOn;
  for (const row of rows.slice(1)) {
    if (row.occurredOn < from) {
      from = row.occurredOn;
    }
    if (row.occurredOn > to) {
      to = row.occurredOn;
    }
  }
  return { from, to };
}

async function insertMissingCategories(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  householdId: string,
  rows: readonly MoneyManagerNormalizedRow[],
): Promise<MoneyManagerImportCategorySummary[]> {
  const current = await transaction
    .select({ type: categories.type, name: categories.name })
    .from(categories)
    .where(eq(categories.householdId, householdId));
  const existing: ExistingMoneyManagerCategory[] = current.map((category) => ({
    type: category.type,
    name: category.name,
  }));
  const plan = planMoneyManagerCategories(rows, existing);

  for (const type of ['expense', 'income'] as const) {
    const typePlan = plan.filter((category) => category.type === type);
    if (typePlan.length === 0) {
      continue;
    }
    const maxRows = await transaction
      .select({ maxSortOrder: sql<number | null>`max(${categories.sortOrder})` })
      .from(categories)
      .where(and(eq(categories.householdId, householdId), eq(categories.type, type)));
    const nextSortOrder = Number(maxRows[0]?.maxSortOrder ?? 0) + CATEGORY_SORT_STEP;
    const namesToCreate = typePlan.filter((category) => category.action === 'create');
    if (namesToCreate.length > 0) {
      await transaction
        .insert(categories)
        .values(
          namesToCreate.map((category, index) => ({
            householdId,
            type,
            name: category.name,
            sortOrder: nextSortOrder + index * CATEGORY_SORT_STEP,
          })),
        )
        .onConflictDoNothing({
          target: [categories.householdId, categories.type, categories.name],
        });
    }
  }

  const categoryRows = await transaction
    .select({ id: categories.id, type: categories.type, name: categories.name })
    .from(categories)
    .where(eq(categories.householdId, householdId));
  const categoryByKey = new Map(
    categoryRows.map((category) => [categoryKey(category.type, category.name), category]),
  );
  return plan.flatMap((item) => {
    const category = categoryByKey.get(categoryKey(item.type, item.name));
    return category
      ? [
          {
            type: item.type,
            name: item.name,
            id: category.id,
            action: item.action === 'create' ? ('created' as const) : ('reused' as const),
          },
        ]
      : [];
  });
}

function accountIdentityKey(name: string, sourceAccountId?: string): string {
  return sourceAccountId ? `id:${sourceAccountId}` : `name:${name}`;
}

function sourceAccounts(rows: readonly MoneyManagerNormalizedRow[]): {
  name: string;
  sourceAccountId?: string;
  key: string;
}[] {
  const seen = new Set<string>();
  const result: { name: string; sourceAccountId?: string; key: string }[] = [];
  for (const row of rows) {
    const accountsInRow =
      row.type === 'transfer'
        ? [
            { name: row.fromAccountName, sourceAccountId: row.fromSourceAccountId },
            { name: row.toAccountName, sourceAccountId: row.toSourceAccountId },
          ]
        : [{ name: row.accountName, sourceAccountId: row.sourceAccountId }];
    for (const account of accountsInRow) {
      const key = accountIdentityKey(account.name, account.sourceAccountId);
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ ...account, key });
      }
    }
  }
  return result;
}

async function insertMissingAccounts(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  householdId: string,
  rows: readonly MoneyManagerNormalizedRow[],
): Promise<AccountImportResult> {
  const source = sourceAccounts(rows);
  const maxRows = await transaction
    .select({ maxSortOrder: sql<number | null>`max(${accounts.sortOrder})` })
    .from(accounts)
    .where(eq(accounts.householdId, householdId));
  let nextSortOrder = Number(maxRows[0]?.maxSortOrder ?? 0) + 10;
  const summaries: MoneyManagerImportAccountSummary[] = [];
  const byKey = new Map<string, number>();
  for (const item of source) {
    const inserted = await transaction
      .insert(accounts)
      .values({
        householdId,
        name: item.name,
        kind: 'other' as const,
        status: 'active' as const,
        sortOrder: nextSortOrder,
      })
      .returning({ id: accounts.id });
    const accountId = inserted[0]?.id;
    if (accountId === undefined) {
      throw new Error('Import account was not created');
    }
    nextSortOrder += 10;
    byKey.set(item.key, accountId);
    summaries.push({ name: item.name, id: accountId, action: 'created' });
  }
  return { summaries, byKey };
}

async function insertTransactions(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  householdId: string,
  rows: readonly MoneyManagerNormalizedRow[],
  accountByKey: ReadonlyMap<string, number>,
): Promise<void> {
  const normalRows = rows.filter((row): row is MoneyManagerLedgerRow => row.type !== 'transfer');
  if (normalRows.length === 0) {
    return;
  }
  const categoryRows = await transaction
    .select({ id: categories.id, type: categories.type, name: categories.name })
    .from(categories)
    .where(eq(categories.householdId, householdId));
  const categoryByKey = new Map(
    categoryRows.map((category) => [categoryKey(category.type, category.name), category.id]),
  );
  const values = normalRows.map((row) => {
    const categoryId = categoryByKey.get(categoryKey(row.type, row.categoryName));
    const accountId = accountByKey.get(accountIdentityKey(row.accountName, row.sourceAccountId));
    if (categoryId === undefined || accountId === undefined) {
      throw new Error('Import category or account was not created');
    }
    return {
      householdId,
      type: row.type,
      amount: row.amount,
      occurredOn: row.occurredOn,
      categoryId,
      accountId,
      memo: row.memo,
    };
  });
  for (let offset = 0; offset < values.length; offset += TRANSACTION_INSERT_CHUNK_SIZE) {
    await transaction
      .insert(transactions)
      .values(values.slice(offset, offset + TRANSACTION_INSERT_CHUNK_SIZE));
  }
}

async function insertTransfers(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  householdId: string,
  rows: readonly MoneyManagerNormalizedRow[],
  accountByKey: ReadonlyMap<string, number>,
): Promise<void> {
  const transferRows = rows.filter(
    (row): row is MoneyManagerTransferRow => row.type === 'transfer',
  );
  if (transferRows.length === 0) {
    return;
  }
  const values = transferRows.map((row) => {
    const fromAccountId = accountByKey.get(
      accountIdentityKey(row.fromAccountName, row.fromSourceAccountId),
    );
    const toAccountId = accountByKey.get(
      accountIdentityKey(row.toAccountName, row.toSourceAccountId),
    );
    if (fromAccountId === undefined || toAccountId === undefined) {
      throw new Error('Import transfer account was not created');
    }
    if (fromAccountId === toAccountId) {
      throw new Error('Transfer source and destination must differ');
    }
    if (row.amount <= 0) {
      throw new Error('Transfer amount must be positive');
    }
    return {
      householdId,
      fromAccountId,
      toAccountId,
      amount: row.amount,
      occurredOn: row.occurredOn,
      memo: row.memo,
    };
  });
  for (let offset = 0; offset < values.length; offset += TRANSACTION_INSERT_CHUNK_SIZE) {
    await transaction
      .insert(transfers)
      .values(values.slice(offset, offset + TRANSACTION_INSERT_CHUNK_SIZE));
  }
}

export async function commitMoneyManagerImport(
  db: Database,
  input: MoneyManagerImportInput,
): Promise<MoneyManagerImportCommitResult> {
  if (input.rows.length === 0) {
    throw new Error('Money Manager import requires at least one row');
  }
  const source = input.source ?? MONEY_MANAGER_SOURCE;
  const operationKey = input.operationKey?.trim() || null;
  if (operationKey && operationKey.length > 120) {
    throw new Error('Import operation key is too long');
  }
  const counts = countsForRows(input.rows);
  const period = periodForRows(input.rows);
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, input.householdId);
      const existingRows = operationKey
        ? await transaction
            .select({
              id: transactionImports.id,
            })
            .from(transactionImports)
            .where(
              and(
                eq(transactionImports.householdId, input.householdId),
                eq(transactionImports.source, source),
                eq(transactionImports.operationKey, operationKey),
              ),
            )
            .limit(1)
        : [];
      const existing = existingRows[0];
      if (existing) {
        return {
          status: 'duplicate' as const,
          importId: existing.id,
        };
      }
      const inserted = await transaction
        .insert(transactionImports)
        .values({
          householdId: input.householdId,
          source,
          sha256: input.sha256,
          operationKey,
          originalFilename: input.originalFilename,
          transactionCount: input.rows.length,
          incomeCount: counts.income.count,
          expenseCount: counts.expense.count,
          transferCount: counts.transfer.count,
        })
        .returning({ id: transactionImports.id });
      const importId = inserted[0]?.id;
      if (importId === undefined) {
        throw new Error('Import record insert returned no row');
      }
      const categoriesSummary = await insertMissingCategories(
        transaction,
        input.householdId,
        input.rows,
      );
      const accountImport = await insertMissingAccounts(transaction, input.householdId, input.rows);
      await lockCardSettingsForAccounts(transaction, input.householdId, [
        ...accountImport.byKey.values(),
      ]);
      await insertTransactions(transaction, input.householdId, input.rows, accountImport.byKey);
      await insertTransfers(transaction, input.householdId, input.rows, accountImport.byKey);
      return {
        status: 'imported' as const,
        importId,
        transactionCount: input.rows.length,
        counts,
        period,
        createdCategories: categoriesSummary.filter((item) => item.action === 'created').length,
        createdAccounts: accountImport.summaries.filter((item) => item.action === 'created').length,
        categories: categoriesSummary,
        accounts: accountImport.summaries,
      };
    });
  } catch (error) {
    if (!operationKey || !isUniqueViolation(error, DUPLICATE_IMPORT_CONSTRAINT)) {
      throw error;
    }
    const existingRows = await db
      .select({
        id: transactionImports.id,
      })
      .from(transactionImports)
      .where(
        and(
          eq(transactionImports.householdId, input.householdId),
          eq(transactionImports.source, source),
          eq(transactionImports.operationKey, operationKey),
        ),
      )
      .limit(1);
    const existing = existingRows[0];
    return {
      status: 'duplicate',
      importId: existing?.id,
    };
  }
}
