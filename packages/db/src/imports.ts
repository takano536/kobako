import { and, eq, sql } from 'drizzle-orm';

import type { Database } from './client.js';
import { ensureDefaultAccountGroups } from './ledger.js';
import {
  accountGroups,
  accountImportMappings,
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
  planMoneyManagerCategories,
  type MoneyManagerLedgerRow,
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
  MoneyManagerImportValidationError,
} from './money-manager-import-contract.js';

const TRANSACTION_INSERT_CHUNK_SIZE = 500;
const CATEGORY_SORT_STEP = 10;
const DUPLICATE_IMPORT_CONSTRAINT = 'transaction_imports_household_source_sha256_unique';

export interface MoneyManagerImportAccountResolution {
  sourceAccountName: string;
  sourceAccountId?: string;
  action: 'existing' | 'create';
  accountId?: number;
}

export interface MoneyManagerImportInput {
  householdId: string;
  source?: string;
  sha256: string;
  originalFilename: string;
  rows: readonly MoneyManagerNormalizedRow[];
  accountResolutions?: readonly MoneyManagerImportAccountResolution[];
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

interface AccountResolutionResult {
  summaries: MoneyManagerImportAccountSummary[];
  byKey: Map<string, number>;
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

type AccountResolutionExecutor = Pick<Database, 'select'>;

export async function validateMoneyManagerImportAccountResolutions(
  db: AccountResolutionExecutor,
  householdId: string,
  rows: readonly MoneyManagerNormalizedRow[],
  resolutions?: readonly MoneyManagerImportAccountResolution[],
  sourceName = MONEY_MANAGER_SOURCE,
): Promise<MoneyManagerImportValidationError | null> {
  const source = sourceAccounts(rows);
  const [current, mappingRows] = await Promise.all([
    db.select({ id: accounts.id }).from(accounts).where(eq(accounts.householdId, householdId)),
    db
      .select({
        sourceAccountId: accountImportMappings.sourceAccountId,
        sourceAccountName: accountImportMappings.sourceAccountName,
        accountId: accountImportMappings.accountId,
      })
      .from(accountImportMappings)
      .where(
        and(
          eq(accountImportMappings.householdId, householdId),
          eq(accountImportMappings.source, sourceName),
        ),
      ),
  ]);
  const currentIds = new Set(current.map((account) => account.id));
  const mappingByKey = new Map(
    mappingRows.map((mapping) => [
      accountIdentityKey(mapping.sourceAccountName, mapping.sourceAccountId ?? undefined),
      mapping.accountId,
    ]),
  );
  const submitted = resolutions ?? [];
  const resolutionByKey = new Map<string, MoneyManagerImportAccountResolution>();
  for (const resolution of submitted) {
    const key = accountIdentityKey(resolution.sourceAccountName, resolution.sourceAccountId);
    if (resolutionByKey.has(key)) {
      return {
        status: 'validation_error',
        code: 'duplicate_account_resolution',
        sourceAccountNames: [resolution.sourceAccountName],
      };
    }
    resolutionByKey.set(key, resolution);
  }

  const unmatched = source.filter((item) => !mappingByKey.has(item.key));
  const expectedKeys = new Set(unmatched.map((item) => item.key));
  const unexpected = submitted.filter((resolution) => {
    const key = accountIdentityKey(resolution.sourceAccountName, resolution.sourceAccountId);
    return !expectedKeys.has(key);
  });
  if (unexpected.length > 0) {
    return {
      status: 'validation_error',
      code: 'unexpected_account_resolution',
      sourceAccountNames: unexpected.map((resolution) => resolution.sourceAccountName),
    };
  }
  const missing = unmatched.filter((item) => !resolutionByKey.has(item.key));
  if (missing.length > 0) {
    return {
      status: 'validation_error',
      code: 'missing_account_resolution',
      sourceAccountNames: missing.map((item) => item.name),
    };
  }

  const targetByKey = new Map<string, number>();
  for (const item of source) {
    const mappingTarget = mappingByKey.get(item.key);
    if (mappingTarget !== undefined) {
      if (!currentIds.has(mappingTarget)) {
        return {
          status: 'validation_error',
          code: 'invalid_account_selection',
          sourceAccountNames: [item.name],
        };
      }
      targetByKey.set(item.key, mappingTarget);
      continue;
    }
    const resolution = resolutionByKey.get(item.key);
    if (!resolution) {
      continue;
    }
    if (
      resolution.sourceAccountName !== item.name ||
      resolution.sourceAccountId !== item.sourceAccountId
    ) {
      return {
        status: 'validation_error',
        code: 'invalid_account_selection',
        sourceAccountNames: [item.name],
      };
    }
    if (resolution.action === 'create') {
      if (resolution.accountId !== undefined) {
        return {
          status: 'validation_error',
          code: 'invalid_account_selection',
          sourceAccountNames: [item.name],
        };
      }
      continue;
    }
    if (resolution.action !== 'existing') {
      return {
        status: 'validation_error',
        code: 'invalid_account_selection',
        sourceAccountNames: [item.name],
      };
    }
    if (resolution.accountId === undefined || !currentIds.has(resolution.accountId)) {
      return {
        status: 'validation_error',
        code: 'invalid_account_selection',
        sourceAccountNames: [item.name],
      };
    }
    targetByKey.set(item.key, resolution.accountId);
  }
  for (const row of rows) {
    if (row.type !== 'transfer') continue;
    const fromKey = accountIdentityKey(row.fromAccountName, row.fromSourceAccountId);
    const toKey = accountIdentityKey(row.toAccountName, row.toSourceAccountId);
    if (fromKey === toKey || targetByKey.get(fromKey) === targetByKey.get(toKey)) {
      if (fromKey === toKey || (targetByKey.has(fromKey) && targetByKey.has(toKey))) {
        return {
          status: 'validation_error',
          code: 'same_account',
          sourceRow: row.sourceRow,
          sourceAccountNames: [row.fromAccountName, row.toAccountName],
        };
      }
    }
  }
  const targetSources = new Map<number, string[]>();
  for (const item of source) {
    const target = targetByKey.get(item.key);
    if (target === undefined) continue;
    const names = targetSources.get(target) ?? [];
    names.push(item.name);
    targetSources.set(target, names);
  }
  for (const names of targetSources.values()) {
    if (names.length > 1) {
      return {
        status: 'validation_error',
        code: 'duplicate_account_target',
        sourceAccountNames: names,
      };
    }
  }
  return null;
}

async function insertMissingAccounts(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  householdId: string,
  rows: readonly MoneyManagerNormalizedRow[],
  resolutions: readonly MoneyManagerImportAccountResolution[] | undefined,
  sourceName: string,
): Promise<AccountResolutionResult> {
  const source = sourceAccounts(rows);
  const current = await transaction
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.householdId, householdId));
  const currentById = new Map(current.map((account) => [account.id, account]));
  const mappingRows = await transaction
    .select({
      id: accountImportMappings.id,
      sourceAccountId: accountImportMappings.sourceAccountId,
      sourceAccountName: accountImportMappings.sourceAccountName,
      accountId: accountImportMappings.accountId,
    })
    .from(accountImportMappings)
    .where(
      and(
        eq(accountImportMappings.householdId, householdId),
        eq(accountImportMappings.source, sourceName),
      ),
    );
  const mappingByKey = new Map(
    mappingRows.map((mapping) => [
      accountIdentityKey(mapping.sourceAccountName, mapping.sourceAccountId ?? undefined),
      mapping,
    ]),
  );
  const resolutionByKey = new Map(
    (resolutions ?? []).map((resolution) => [
      accountIdentityKey(resolution.sourceAccountName, resolution.sourceAccountId),
      resolution,
    ]),
  );
  await ensureDefaultAccountGroups(transaction, householdId);
  const groupRows = await transaction
    .select({ id: accountGroups.id })
    .from(accountGroups)
    .where(and(eq(accountGroups.householdId, householdId), eq(accountGroups.defaultKind, 'other')))
    .limit(1);
  const group = groupRows[0];
  if (!group) {
    throw new Error('Default account group was not created');
  }
  const maxRows = await transaction
    .select({ maxSortOrder: sql<number | null>`max(${accounts.sortOrder})` })
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), eq(accounts.groupId, group.id)));
  let nextSortOrder = Number(maxRows[0]?.maxSortOrder ?? 0) + 10;
  const summaries: MoneyManagerImportAccountSummary[] = [];
  const byKey = new Map<string, number>();
  for (const item of source) {
    const mapping = mappingByKey.get(item.key);
    const resolution = resolutionByKey.get(item.key);
    let accountId: number | undefined;
    let action: 'created' | 'reused';
    if (mapping) {
      accountId = mapping.accountId;
      action = 'reused';
    } else if (!resolution) {
      throw new Error(`Import account resolution is missing for ${item.name}`);
    } else if (resolution.action === 'existing') {
      if (resolution.accountId === undefined || !currentById.has(resolution.accountId)) {
        throw new Error(`Import account selection is invalid for ${item.name}`);
      }
      accountId = resolution.accountId;
      action = 'reused';
    } else if (resolution.action === 'create') {
      const inserted = await transaction
        .insert(accounts)
        .values({
          householdId,
          name: item.name,
          kind: 'other' as const,
          groupId: group.id,
          status: 'active' as const,
          sortOrder: nextSortOrder,
        })
        .returning({ id: accounts.id });
      accountId = inserted[0]?.id;
      nextSortOrder += 10;
      action = 'created';
    } else {
      throw new Error(`Import account resolution is invalid for ${item.name}`);
    }
    if (accountId === undefined) {
      throw new Error('Import account was not created');
    }
    byKey.set(item.key, accountId);
    if (mapping) {
      if (mapping.sourceAccountId && mapping.sourceAccountName !== item.name) {
        await transaction
          .update(accountImportMappings)
          .set({ sourceAccountName: item.name, updatedAt: new Date() })
          .where(eq(accountImportMappings.id, mapping.id));
      }
    } else {
      await transaction.insert(accountImportMappings).values({
        householdId,
        source: sourceName,
        sourceAccountId: item.sourceAccountId ?? null,
        sourceAccountName: item.name,
        accountId,
      });
    }
    summaries.push({ name: item.name, id: accountId, action });
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
  const counts = countsForRows(input.rows);
  const period = periodForRows(input.rows);
  try {
    return await db.transaction(async (transaction) => {
      await lockHousehold(transaction, input.householdId);
      const existingRows = await transaction
        .select({
          id: transactionImports.id,
          createdAt: transactionImports.createdAt,
        })
        .from(transactionImports)
        .where(
          and(
            eq(transactionImports.householdId, input.householdId),
            eq(transactionImports.source, source),
            eq(transactionImports.sha256, input.sha256),
          ),
        )
        .limit(1);
      const existing = existingRows[0];
      if (existing) {
        return {
          status: 'duplicate' as const,
          importId: existing.id,
          previousImportDate: existing.createdAt.toISOString(),
        };
      }
      const resolutionError = await validateMoneyManagerImportAccountResolutions(
        transaction,
        input.householdId,
        input.rows,
        input.accountResolutions,
        source,
      );
      if (resolutionError) {
        return resolutionError;
      }
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
      const accountResolution = await insertMissingAccounts(
        transaction,
        input.householdId,
        input.rows,
        input.accountResolutions,
        source,
      );
      await insertTransactions(transaction, input.householdId, input.rows, accountResolution.byKey);
      await insertTransfers(transaction, input.householdId, input.rows, accountResolution.byKey);
      return {
        status: 'imported' as const,
        importId,
        transactionCount: input.rows.length,
        counts,
        period,
        createdCategories: categoriesSummary.filter((item) => item.action === 'created').length,
        createdAccounts: accountResolution.summaries.filter((item) => item.action === 'created')
          .length,
        categories: categoriesSummary,
        accounts: accountResolution.summaries,
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
