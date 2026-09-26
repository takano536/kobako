import { and, asc, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';

import type { Database } from './client.js';
import { monthRange } from './month.js';
import {
  categories,
  households,
  transactions,
  type Category,
  type NewTransaction,
  type Transaction,
  type TransactionType,
} from './schema.js';
import type { TransactionInput } from './validation.js';

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
  limit?: number;
}

export interface ListedTransaction {
  id: number;
  type: TransactionType;
  amount: number;
  occurredOn: string;
  categoryId: number;
  categoryName: string;
  memo: string;
}

function transactionConditions(householdId: string, filters: TransactionFilters): SQL[] {
  const range = monthRange(filters.month);
  const conditions: SQL[] = [
    eq(transactions.householdId, householdId),
    gte(transactions.occurredOn, range.start),
    lt(transactions.occurredOn, range.endExclusive),
  ];
  if (filters.type) {
    conditions.push(eq(transactions.type, filters.type));
  }
  if (filters.categoryId) {
    conditions.push(eq(transactions.categoryId, filters.categoryId));
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
    .where(and(...transactionConditions(householdId, filters)))
    .orderBy(desc(transactions.occurredOn), desc(transactions.id));
  return filters.limit ? query.limit(filters.limit) : query;
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
    .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId)))
    .limit(1);
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
  const values: NewTransaction = {
    householdId,
    type: input.type,
    amount: input.amount,
    occurredOn: input.occurredOn,
    categoryId: input.categoryId,
    memo: input.memo,
  };
  const rows = await db.insert(transactions).values(values).returning();
  const transaction = rows[0];
  if (!transaction) {
    throw new Error('Transaction insert returned no row');
  }
  return transaction;
}

export async function updateTransaction(
  db: Database,
  householdId: string,
  id: number,
  input: TransactionInput,
): Promise<Transaction | null> {
  const rows = await db
    .update(transactions)
    .set({
      type: input.type,
      amount: input.amount,
      occurredOn: input.occurredOn,
      categoryId: input.categoryId,
      memo: input.memo,
      updatedAt: new Date(),
    })
    .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId)))
    .returning();
  return rows[0] ?? null;
}

export async function deleteTransaction(
  db: Database,
  householdId: string,
  id: number,
): Promise<Pick<Transaction, 'occurredOn'> | null> {
  const rows = await db
    .delete(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId)))
    .returning({ occurredOn: transactions.occurredOn });
  return rows[0] ?? null;
}
