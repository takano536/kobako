import { and, eq, inArray } from 'drizzle-orm';

import type { Database } from './client.js';
import { lockCardSettingsForAccounts, lockHousehold } from './ledger.js';
import {
  accounts,
  apiBatches,
  categories,
  transactions,
  transfers,
  type TransactionOriginValue,
  type TransactionType,
} from './schema.js';

/** The origin stamped on every row that an external program creates. */
export const API_ORIGIN: TransactionOriginValue = 'api';

const FINGERPRINT_VERSION = 'v1';

export interface ApiTransactionRow {
  type: TransactionType;
  amount: number;
  occurredOn: string;
  category: string;
  account?: string | null;
  memo?: string;
  externalId?: string | null;
}

export interface ApiTransferRow {
  amount: number;
  occurredOn: string;
  from: string;
  to: string;
  memo?: string;
  externalId?: string | null;
}

export type ApiRowResult =
  | {
      index: number;
      status: 'created' | 'skipped' | 'would_create';
      id: number;
      externalId: string;
    }
  | {
      index: number;
      status: 'error';
      code: string;
      field?: string;
      message: string;
      hint?: string;
    };

export interface ApiBatchResult {
  status: 'ok' | 'replayed' | 'error';
  batchId?: number;
  created: number;
  skipped: number;
  errors: number;
  rows: ApiRowResult[];
}

/** Case, width, and spacing differences must not split the same name into two lookups. */
export function normalizeName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function editDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const columns = right.length + 1;
  let previous = Array.from({ length: columns }, (_, index) => index);
  for (let row = 1; row < rows; row += 1) {
    const current = new Array<number>(columns).fill(0);
    current[0] = row;
    for (let column = 1; column < columns; column += 1) {
      const deleted = previous[column]! + 1;
      const inserted = current[column - 1]! + 1;
      const substituted = previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1);
      current[column] = Math.min(deleted, inserted, substituted);
    }
    previous = current;
  }
  return previous[columns - 1]!;
}

/** Names the caller probably meant, used in the hint of an unknown-name error. */
export function nearestNames(candidate: string, names: readonly string[], limit = 3): string[] {
  const target = normalizeName(candidate);
  if (target === '') return names.slice(0, limit);
  return [...names]
    .map((name) => {
      const normalized = normalizeName(name);
      const contains = normalized.includes(target) || target.includes(normalized);
      return { name, score: contains ? 0 : editDistance(target, normalized) };
    })
    .sort((left, right) => left.score - right.score || left.name.localeCompare(right.name, 'ja'))
    .slice(0, limit)
    .map((entry) => entry.name);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Deterministic identity for a row whose sender supplied no id. Two identical legitimate rows
 * in one statement are kept apart by the occurrence suffix added by `dedupeKey`.
 */
export async function transactionFingerprint(input: {
  type: TransactionType;
  occurredOn: string;
  amount: number;
  categoryId: number;
  accountId: number | null;
  memo: string;
}): Promise<string> {
  const payload = [
    FINGERPRINT_VERSION,
    input.type,
    input.occurredOn,
    String(input.amount),
    String(input.categoryId),
    input.accountId === null ? '' : String(input.accountId),
    normalizeName(input.memo),
  ].join('|');
  return sha256Hex(payload);
}

export async function transferFingerprint(input: {
  occurredOn: string;
  amount: number;
  fromAccountId: number;
  toAccountId: number;
  memo: string;
}): Promise<string> {
  const payload = [
    FINGERPRINT_VERSION,
    'transfer',
    input.occurredOn,
    String(input.amount),
    String(input.fromAccountId),
    String(input.toAccountId),
    normalizeName(input.memo),
  ].join('|');
  return sha256Hex(payload);
}

function clientExternalId(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 200) : undefined;
}

function unknownNameError(index: number, field: string, label: string, value: string, names: string[]) {
  const suggestions = nearestNames(value, names);
  return {
    index,
    status: 'error' as const,
    code: `unknown_${field}`,
    field,
    message: `${label}「${value}」が見つかりません。`,
    hint:
      suggestions.length > 0
        ? `近い名前: ${suggestions.join(' / ')}`
        : `${label}を先に登録してください。`,
  };
}

interface BatchCounts {
  createdTransactions: number;
  skippedTransactions: number;
  createdTransfers: number;
  skippedTransfers: number;
}

/**
 * Write one API call as a unit: resolve names, dedupe on (household, external id), and record the
 * call for audit. Duplicates are skipped, never rejected, so a retry is harmless.
 */
export async function ingestApiBatch(
  db: Database,
  householdId: string,
  input: {
    label?: string;
    idempotencyKey?: string | null;
    transactions?: readonly ApiTransactionRow[];
    transfers?: readonly ApiTransferRow[];
    dryRun?: boolean;
  },
): Promise<ApiBatchResult> {
  const rows: ApiRowResult[] = [];
  const counts: BatchCounts = {
    createdTransactions: 0,
    skippedTransactions: 0,
    createdTransfers: 0,
    skippedTransfers: 0,
  };
  const label = (input.label ?? '').trim().slice(0, 120);
  const idempotencyKey = input.idempotencyKey?.trim().slice(0, 200) || null;
  const dryRun = input.dryRun === true;

  try {
    return await db.transaction(async (transaction) => {
      if (idempotencyKey && !dryRun) {
        const existing = await transaction
          .select()
          .from(apiBatches)
          .where(
            and(
              eq(apiBatches.householdId, householdId),
              eq(apiBatches.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);
        if (existing[0]) {
          return {
            status: 'replayed' as const,
            batchId: existing[0].id,
            created: 0,
            skipped: existing[0].createdTransactionCount + existing[0].createdTransferCount,
            errors: 0,
            rows: [],
          };
        }
      }

      await lockHousehold(transaction, householdId);

      const [categoryRows, accountRows] = await Promise.all([
        transaction
          .select({ id: categories.id, name: categories.name, type: categories.type })
          .from(categories)
          .where(eq(categories.householdId, householdId)),
        transaction
          .select({ id: accounts.id, name: accounts.name })
          .from(accounts)
          .where(eq(accounts.householdId, householdId)),
      ]);
      const categoryByName = new Map<string, number>();
      for (const row of categoryRows) {
        categoryByName.set(`${row.type}\u0000${normalizeName(row.name)}`, row.id);
      }
      const accountByName = new Map<string, number>();
      for (const row of accountRows) {
        accountByName.set(normalizeName(row.name), row.id);
      }
      const categoryNames = (type: TransactionType) =>
        categoryRows.filter((row) => row.type === type).map((row) => row.name);
      const accountNames = accountRows.map((row) => row.name);

      const accountIds = new Set<number>();
      const transactionPlans: Array<{ index: number; values: typeof transactions.$inferInsert }> = [];
      const transferPlans: Array<{ index: number; values: typeof transfers.$inferInsert }> = [];
      const occurrences = new Map<string, number>();

      for (const [index, row] of (input.transactions ?? []).entries()) {
        const categoryId = categoryByName.get(`${row.type}\u0000${normalizeName(row.category)}`);
        if (categoryId === undefined) {
          rows.push(
            unknownNameError(index, 'category', 'カテゴリ', row.category, categoryNames(row.type)),
          );
          continue;
        }
        let accountId: number | null = null;
        if (row.account) {
          const resolved = accountByName.get(normalizeName(row.account));
          if (resolved === undefined) {
            rows.push(unknownNameError(index, 'account', '資産', row.account, accountNames));
            continue;
          }
          accountId = resolved;
          accountIds.add(resolved);
        }
        const memo = row.memo ?? '';
        let externalId = clientExternalId(row.externalId);
        if (!externalId) {
          const base = await transactionFingerprint({
            type: row.type,
            occurredOn: row.occurredOn,
            amount: row.amount,
            categoryId,
            accountId,
            memo,
          });
          const seen = (occurrences.get(base) ?? 0) + 1;
          occurrences.set(base, seen);
          externalId = `${base}#${seen}`;
        }
        transactionPlans.push({
          index,
          values: {
            householdId,
            type: row.type,
            amount: row.amount,
            occurredOn: row.occurredOn,
            categoryId,
            accountId,
            memo,
            origin: API_ORIGIN,
            externalId,
          },
        });
      }

      for (const [index, row] of (input.transfers ?? []).entries()) {
        const fromAccountId = accountByName.get(normalizeName(row.from));
        if (fromAccountId === undefined) {
          rows.push(unknownNameError(index, 'from', '振替元', row.from, accountNames));
          continue;
        }
        const toAccountId = accountByName.get(normalizeName(row.to));
        if (toAccountId === undefined) {
          rows.push(unknownNameError(index, 'to', '振替先', row.to, accountNames));
          continue;
        }
        if (fromAccountId === toAccountId) {
          rows.push({
            index,
            status: 'error',
            code: 'same_account',
            field: 'to',
            message: '振替元と振替先が同じです。',
            hint: '別の資産を指定してください。',
          });
          continue;
        }
        accountIds.add(fromAccountId);
        accountIds.add(toAccountId);
        const memo = row.memo ?? '';
        let externalId = clientExternalId(row.externalId);
        if (!externalId) {
          const base = await transferFingerprint({
            occurredOn: row.occurredOn,
            amount: row.amount,
            fromAccountId,
            toAccountId,
            memo,
          });
          const seen = (occurrences.get(base) ?? 0) + 1;
          occurrences.set(base, seen);
          externalId = `${base}#${seen}`;
        }
        transferPlans.push({
          index,
          values: {
            householdId,
            fromAccountId,
            toAccountId,
            amount: row.amount,
            occurredOn: row.occurredOn,
            memo,
            origin: API_ORIGIN,
            externalId,
          },
        });
      }

      if (dryRun) {
        const existingTransactions = await transaction
          .select({ externalId: transactions.externalId })
          .from(transactions)
          .where(
            and(
              eq(transactions.householdId, householdId),
              inArray(
                transactions.externalId,
                transactionPlans.map((plan) => plan.values.externalId ?? ''),
              ),
            ),
          );
        const existingTransfers = await transaction
          .select({ externalId: transfers.externalId })
          .from(transfers)
          .where(
            and(
              eq(transfers.householdId, householdId),
              inArray(
                transfers.externalId,
                transferPlans.map((plan) => plan.values.externalId ?? ''),
              ),
            ),
          );
        const seenTransactions = new Set(existingTransactions.map((row) => row.externalId));
        const seenTransfers = new Set(existingTransfers.map((row) => row.externalId));
        for (const plan of transactionPlans) {
          const externalId = plan.values.externalId ?? '';
          const exists = seenTransactions.has(externalId);
          counts[exists ? 'skippedTransactions' : 'createdTransactions'] += 1;
          rows.push({
            index: plan.index,
            status: exists ? 'skipped' : 'would_create',
            id: 0,
            externalId,
          });
        }
        for (const plan of transferPlans) {
          const externalId = plan.values.externalId ?? '';
          const exists = seenTransfers.has(externalId);
          counts[exists ? 'skippedTransfers' : 'createdTransfers'] += 1;
          rows.push({
            index: plan.index,
            status: exists ? 'skipped' : 'would_create',
            id: 0,
            externalId,
          });
        }
        rows.sort((left, right) => left.index - right.index);
        return {
          status: 'ok' as const,
          created: counts.createdTransactions + counts.createdTransfers,
          skipped: counts.skippedTransactions + counts.skippedTransfers,
          errors: rows.filter((row) => row.status === 'error').length,
          rows,
        };
      }

      const inserted = await transaction
        .insert(apiBatches)
        .values({ householdId, label, idempotencyKey })
        .onConflictDoNothing()
        .returning({ id: apiBatches.id });
      if (!inserted[0]) {
        // A concurrent call with the same idempotency key won the race.
        const existing = await transaction
          .select()
          .from(apiBatches)
          .where(
            and(
              eq(apiBatches.householdId, householdId),
              eq(apiBatches.idempotencyKey, idempotencyKey ?? ''),
            ),
          )
          .limit(1);
        return {
          status: 'replayed' as const,
          batchId: existing[0]?.id,
          created: 0,
          skipped: 0,
          errors: 0,
          rows: [],
        };
      }
      const batchId = inserted[0].id;

      await lockCardSettingsForAccounts(transaction, householdId, [...accountIds]);

      for (const plan of transactionPlans) {
        const created = await transaction
          .insert(transactions)
          .values({ ...plan.values, apiBatchId: batchId })
          .onConflictDoNothing()
          .returning({ id: transactions.id });
        if (created[0]) {
          counts.createdTransactions += 1;
          rows.push({
            index: plan.index,
            status: 'created',
            id: created[0].id,
            externalId: plan.values.externalId ?? '',
          });
        } else {
          counts.skippedTransactions += 1;
          rows.push({
            index: plan.index,
            status: 'skipped',
            id: 0,
            externalId: plan.values.externalId ?? '',
          });
        }
      }

      for (const plan of transferPlans) {
        const created = await transaction
          .insert(transfers)
          .values({ ...plan.values, apiBatchId: batchId })
          .onConflictDoNothing()
          .returning({ id: transfers.id });
        if (created[0]) {
          counts.createdTransfers += 1;
          rows.push({
            index: plan.index,
            status: 'created',
            id: created[0].id,
            externalId: plan.values.externalId ?? '',
          });
        } else {
          counts.skippedTransfers += 1;
          rows.push({
            index: plan.index,
            status: 'skipped',
            id: 0,
            externalId: plan.values.externalId ?? '',
          });
        }
      }

      await transaction
        .update(apiBatches)
        .set({
          createdTransactionCount: counts.createdTransactions,
          skippedTransactionCount: counts.skippedTransactions,
          createdTransferCount: counts.createdTransfers,
          skippedTransferCount: counts.skippedTransfers,
        })
        .where(eq(apiBatches.id, batchId));

      rows.sort((left, right) => left.index - right.index);
      return {
        status: 'ok' as const,
        batchId,
        created: counts.createdTransactions + counts.createdTransfers,
        skipped: counts.skippedTransactions + counts.skippedTransfers,
        errors: rows.filter((row) => row.status === 'error').length,
        rows,
      };
    });
  } catch (error) {
    console.error('[ingest/ingestApiBatch] failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
      constraint:
        typeof error === 'object' && error !== null && 'constraint_name' in error
          ? String((error as { constraint_name?: unknown }).constraint_name ?? '')
          : '',
      idempotency: idempotencyKey !== null,
      dryRun,
    });
    return { status: 'error', created: 0, skipped: 0, errors: 0, rows: [] };
  }
}
