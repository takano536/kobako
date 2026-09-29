import { and, eq, sql } from 'drizzle-orm';

import type { Database } from './client.js';
import {
  accounts,
  categories,
  households,
  transactionImports,
  transactions,
  transfers,
  type TransactionImport,
  type TransactionType,
} from './schema.js';
import {
  MONEY_MANAGER_SOURCE,
  planMoneyManagerAccounts,
  planMoneyManagerCategories,
  type MoneyManagerLedgerRow,
  type ExistingMoneyManagerAccount,
  type ExistingMoneyManagerCategory,
  type MoneyManagerNormalizedRow,
  type MoneyManagerTransferRow,
} from './money-manager-format.js';
import type {
  MoneyManagerImportAccountSummary,
  MoneyManagerImportCategorySummary,
  MoneyManagerImportCommitResult,
  MoneyManagerImportCounts,
  MoneyManagerImportPeriod,
} from './money-manager-import-contract.js';

const TRANSACTION_INSERT_CHUNK_SIZE = 500;
const CATEGORY_SORT_STEP = 10;
const DUPLICATE_IMPORT_CONSTRAINT = 'transaction_imports_household_source_sha256_unique';

export interface MoneyManagerImportInput {
  householdId: string;
  source?: string;
  sha256: string;
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

async function findExistingImport(
  db: Database,
  householdId: string,
  source: string,
  sha256: string,
): Promise<TransactionImport | null> {
  const rows = await db
    .select()
    .from(transactionImports)
    .where(
      and(
        eq(transactionImports.householdId, householdId),
        eq(transactionImports.source, source),
        eq(transactionImports.sha256, sha256),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findMoneyManagerImport(
  db: Database,
  householdId: string,
  sha256: string,
  source = MONEY_MANAGER_SOURCE,
): Promise<TransactionImport | null> {
  return findExistingImport(db, householdId, source, sha256);
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

async function insertMissingAccounts(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  householdId: string,
  rows: readonly MoneyManagerNormalizedRow[],
): Promise<MoneyManagerImportAccountSummary[]> {
  const current = await transaction
    .select({ name: accounts.name })
    .from(accounts)
    .where(eq(accounts.householdId, householdId));
  const existing: ExistingMoneyManagerAccount[] = current.map((account) => ({
    name: account.name,
  }));
  const plan = planMoneyManagerAccounts(rows, existing);
  const namesToCreate = plan.filter((account) => account.action === 'create');
  if (namesToCreate.length > 0) {
    await transaction
      .insert(accounts)
      .values(namesToCreate.map((account) => ({ householdId, name: account.name })))
      .onConflictDoNothing({ target: [accounts.householdId, accounts.name] });
  }

  const inserted = await transaction
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.householdId, householdId));
  const byName = new Map(inserted.map((account) => [account.name, account]));
  return plan.flatMap((item) => {
    const account = byName.get(item.name);
    return account
      ? [
          {
            name: item.name,
            id: account.id,
            action: item.action === 'create' ? ('created' as const) : ('reused' as const),
          },
        ]
      : [];
  });
}

async function insertTransactions(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  householdId: string,
  rows: readonly MoneyManagerNormalizedRow[],
  accountSummary: readonly MoneyManagerImportAccountSummary[],
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
  const accountByName = new Map(accountSummary.map((account) => [account.name, account.id]));
  const values = normalRows.map((row) => {
    const categoryId = categoryByKey.get(categoryKey(row.type, row.categoryName));
    const accountId = accountByName.get(row.accountName);
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
  accountSummary: readonly MoneyManagerImportAccountSummary[],
): Promise<void> {
  const transferRows = rows.filter(
    (row): row is MoneyManagerTransferRow => row.type === 'transfer',
  );
  if (transferRows.length === 0) {
    return;
  }
  const accountByName = new Map(accountSummary.map((account) => [account.name, account.id]));
  const values = transferRows.map((row) => {
    const fromAccountId = accountByName.get(row.fromAccountName);
    const toAccountId = accountByName.get(row.toAccountName);
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
  const counts = countsForRows(input.rows);
  const period = periodForRows(input.rows);
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, input.householdId);
      const inserted = await transaction
        .insert(transactionImports)
        .values({
          householdId: input.householdId,
          source,
          sha256: input.sha256,
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
      const accountsSummary = await insertMissingAccounts(
        transaction,
        input.householdId,
        input.rows,
      );
      await insertTransactions(transaction, input.householdId, input.rows, accountsSummary);
      await insertTransfers(transaction, input.householdId, input.rows, accountsSummary);
      return {
        status: 'imported' as const,
        importId,
        transactionCount: input.rows.length,
        counts,
        period,
        createdCategories: categoriesSummary.filter((item) => item.action === 'created').length,
        createdAccounts: accountsSummary.filter((item) => item.action === 'created').length,
        categories: categoriesSummary,
        accounts: accountsSummary,
      };
    });
  } catch (error) {
    if (!isUniqueViolation(error, DUPLICATE_IMPORT_CONSTRAINT)) {
      throw error;
    }
    const existing = await findExistingImport(db, input.householdId, source, input.sha256);
    return {
      status: 'duplicate',
      importId: existing?.id,
      previousImportDate: existing?.createdAt.toISOString(),
    };
  }
}
