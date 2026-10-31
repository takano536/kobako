import { and, asc, eq, getTableColumns, gte, isNull } from 'drizzle-orm';

import type { Database } from './client.js';
import { currentTokyoDate, isValidMonth } from './month.js';
import { AMOUNT_LIMIT } from './amount.js';
import {
  accounts,
  categories,
  fixedCostOccurrences,
  fixedCosts,
  transactions,
  type FixedCost,
} from './schema.js';
import { fixedCostInputSchema, type FixedCostInput } from './validation.js';

export interface ListedFixedCost extends FixedCost {
  categoryName: string;
  accountName: string;
}

export interface FixedCostSummary {
  monthly: number;
  annual: number;
}

export type FixedCostMutationResult =
  | { status: 'ok'; fixedCost: FixedCost }
  | { status: 'not_found' }
  | { status: 'validation_error'; message: string }
  | { status: 'error' };

function monthNumber(month: string): number {
  const [yearText, valueText] = month.split('-');
  const year = Number(yearText);
  const value = Number(valueText);
  return year * 12 + value - 1;
}

function monthLength(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function fixedCostOccurrenceOn(
  fixedCost: Pick<FixedCost, 'startMonth' | 'day' | 'intervalCount' | 'intervalUnit'>,
  month: string,
): string | null {
  if (!isValidMonth(month)) return null;
  const start = fixedCost.startMonth.slice(0, 7);
  const distance = monthNumber(month) - monthNumber(start);
  const interval =
    fixedCost.intervalUnit === 'year' ? fixedCost.intervalCount * 12 : fixedCost.intervalCount;
  if (distance < 0 || distance % interval !== 0) return null;
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthNumberValue = Number(monthText);
  const day = Math.min(fixedCost.day, monthLength(year, monthNumberValue));
  return `${month}-${String(day).padStart(2, '0')}`;
}

export function isFixedCostDueOn(
  fixedCost: Pick<FixedCost, 'startMonth' | 'day' | 'intervalCount' | 'intervalUnit'>,
  date: string,
): boolean {
  return fixedCostOccurrenceOn(fixedCost, date.slice(0, 7)) === date;
}

function normalizedInput(input: FixedCostInput): FixedCostInput {
  return {
    ...input,
    startMonth: `${input.startMonth}-01`,
  };
}

export async function listFixedCosts(
  db: Database,
  householdId: string,
): Promise<ListedFixedCost[]> {
  return db
    .select({
      ...getTableColumns(fixedCosts),
      categoryName: categories.name,
      accountName: accounts.name,
    })
    .from(fixedCosts)
    .innerJoin(
      categories,
      and(
        eq(categories.id, fixedCosts.categoryId),
        eq(categories.householdId, fixedCosts.householdId),
        eq(categories.type, fixedCosts.categoryType),
      ),
    )
    .innerJoin(
      accounts,
      and(eq(accounts.id, fixedCosts.accountId), eq(accounts.householdId, fixedCosts.householdId)),
    )
    .where(eq(fixedCosts.householdId, householdId))
    .orderBy(asc(fixedCosts.id));
}

export async function getFixedCost(
  db: Database,
  householdId: string,
  id: number,
): Promise<ListedFixedCost | null> {
  const rows = await listFixedCosts(db, householdId);
  return rows.find((row) => row.id === id) ?? null;
}

async function validateReferences(
  db: Database,
  householdId: string,
  input: FixedCostInput,
): Promise<boolean> {
  const [category, account] = await Promise.all([
    db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.id, input.categoryId),
          eq(categories.householdId, householdId),
          eq(categories.type, 'expense'),
        ),
      )
      .limit(1),
    db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, input.accountId),
          eq(accounts.householdId, householdId),
          isNull(accounts.deletedAt),
        ),
      )
      .limit(1),
  ]);
  return Boolean(category[0] && account[0]);
}

export async function createFixedCost(
  db: Database,
  householdId: string,
  input: FixedCostInput,
): Promise<FixedCostMutationResult> {
  const parsed = fixedCostInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      status: 'validation_error',
      message: parsed.error.issues[0]?.message ?? '入力を確認してください。',
    };
  if (!(await validateReferences(db, householdId, parsed.data)))
    return { status: 'validation_error', message: 'カテゴリまたは資産を確認してください。' };
  const data = normalizedInput(parsed.data);
  const [fixedCost] = await db
    .insert(fixedCosts)
    .values({ householdId, ...data, categoryType: 'expense' })
    .returning();
  return fixedCost ? { status: 'ok', fixedCost } : { status: 'error' };
}

export async function updateFixedCost(
  db: Database,
  householdId: string,
  id: number,
  input: FixedCostInput,
): Promise<FixedCostMutationResult> {
  const parsed = fixedCostInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      status: 'validation_error',
      message: parsed.error.issues[0]?.message ?? '入力を確認してください。',
    };
  if (!(await validateReferences(db, householdId, parsed.data)))
    return { status: 'validation_error', message: 'カテゴリまたは資産を確認してください。' };
  const [fixedCost] = await db
    .update(fixedCosts)
    .set({ ...normalizedInput(parsed.data), updatedAt: new Date() })
    .where(and(eq(fixedCosts.id, id), eq(fixedCosts.householdId, householdId)))
    .returning();
  return fixedCost ? { status: 'ok', fixedCost } : { status: 'not_found' };
}

export async function deleteFixedCost(
  db: Database,
  householdId: string,
  id: number,
): Promise<'ok' | 'not_found'> {
  const rows = await db
    .delete(fixedCosts)
    .where(and(eq(fixedCosts.id, id), eq(fixedCosts.householdId, householdId)))
    .returning({ id: fixedCosts.id });
  return rows[0] ? 'ok' : 'not_found';
}

export function summarizeFixedCosts(
  fixedCostRows: ReadonlyArray<Pick<FixedCost, 'amount' | 'intervalCount' | 'intervalUnit'>>,
): FixedCostSummary {
  const annualExact = fixedCostRows.reduce((sum, row) => {
    const periodMonths = row.intervalUnit === 'year' ? row.intervalCount * 12 : row.intervalCount;
    return sum + (row.amount * 12) / periodMonths;
  }, 0);
  const annual = Math.round(annualExact);
  return { monthly: Math.round(annual / 12), annual };
}

export async function getFixedCostSummary(
  db: Database,
  householdId: string,
): Promise<FixedCostSummary> {
  const rows = await db
    .select({
      amount: fixedCosts.amount,
      intervalCount: fixedCosts.intervalCount,
      intervalUnit: fixedCosts.intervalUnit,
    })
    .from(fixedCosts)
    .where(eq(fixedCosts.householdId, householdId));
  return summarizeFixedCosts(rows);
}

export interface FixedCostProcessingResult {
  checked: number;
  created: number;
  skipped: number;
}

export async function processDueFixedCosts(
  db: Database,
  date = currentTokyoDate(),
): Promise<FixedCostProcessingResult> {
  const [yearText, monthText, dayText] = date.split('-');
  const currentDay = Number(dayText);
  const monthEnd =
    currentDay === new Date(Date.UTC(Number(yearText), Number(monthText), 0)).getUTCDate();
  const rows = await db
    .select()
    .from(fixedCosts)
    .where(monthEnd ? gte(fixedCosts.day, currentDay) : eq(fixedCosts.day, currentDay));
  let created = 0;
  let skipped = 0;
  for (const fixedCost of rows) {
    if (!isFixedCostDueOn(fixedCost, date)) continue;
    const inserted = await db.transaction(async (tx) => {
      const occurrence = await tx
        .insert(fixedCostOccurrences)
        .values({ householdId: fixedCost.householdId, fixedCostId: fixedCost.id, occurredOn: date })
        .onConflictDoNothing({
          target: [fixedCostOccurrences.fixedCostId, fixedCostOccurrences.occurredOn],
        })
        .returning({ id: fixedCostOccurrences.id });
      if (!occurrence[0]) return false;
      const [transaction] = await tx
        .insert(transactions)
        .values({
          householdId: fixedCost.householdId,
          type: 'expense',
          amount: fixedCost.amount,
          occurredOn: date,
          categoryId: fixedCost.categoryId,
          accountId: fixedCost.accountId,
          memo: fixedCost.name,
          externalId: `fixed-cost:${fixedCost.id}:${date}`,
        })
        .returning({ id: transactions.id });
      if (!transaction) throw new Error('fixed cost transaction insert failed');
      await tx
        .update(fixedCostOccurrences)
        .set({ transactionId: transaction.id })
        .where(eq(fixedCostOccurrences.id, occurrence[0].id));
      return true;
    });
    if (inserted) created += 1;
    else skipped += 1;
  }
  return { checked: rows.length, created, skipped };
}

export const FIXED_COST_AMOUNT_LIMIT = AMOUNT_LIMIT;
