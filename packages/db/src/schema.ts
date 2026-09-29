import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { AMOUNT_LIMIT } from './amount.js';

/** A domain-neutral table used to prove migrations and database connectivity. */
export const systemHealthchecks = pgTable('system_healthchecks', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 120 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const transactionType = pgEnum('transaction_type', ['expense', 'income']);

export type TransactionType = (typeof transactionType.enumValues)[number];

/** A transfer is deliberately kept out of the income/expense enum and totals. */
export type TransferType = 'transfer';

/** A single ownership boundary for the pre-auth local ledger. */
export const households = pgTable('households', {
  id: uuid('id').primaryKey(),
  slug: varchar('slug', { length: 80 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const accounts = pgTable(
  'accounts',
  {
    id: serial('id').primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('accounts_household_name_unique').on(table.householdId, table.name),
    unique('accounts_id_household_unique').on(table.id, table.householdId),
  ],
);

export const transactionImports = pgTable(
  'transaction_imports',
  {
    id: serial('id').primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 80 }).notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    originalFilename: varchar('original_filename', { length: 255 }).notNull(),
    transactionCount: integer('transaction_count').notNull(),
    incomeCount: integer('income_count').notNull().default(0),
    expenseCount: integer('expense_count').notNull().default(0),
    transferCount: integer('transfer_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('transaction_imports_household_source_sha256_unique').on(
      table.householdId,
      table.source,
      table.sha256,
    ),
    check('transaction_imports_transaction_count_check', sql`${table.transactionCount} >= 0`),
    check('transaction_imports_income_count_check', sql`${table.incomeCount} >= 0`),
    check('transaction_imports_expense_count_check', sql`${table.expenseCount} >= 0`),
    check('transaction_imports_transfer_count_check', sql`${table.transferCount} >= 0`),
    check('transaction_imports_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    index('transaction_imports_household_created_at_idx').on(table.householdId, table.createdAt),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: serial('id').primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    type: transactionType('type').notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    sortOrder: integer('sort_order').notNull(),
  },
  (table) => [
    unique('categories_household_type_name_unique').on(table.householdId, table.type, table.name),
    unique('categories_id_household_type_unique').on(table.id, table.householdId, table.type),
    index('categories_household_type_sort_order_idx').on(
      table.householdId,
      table.type,
      table.sortOrder,
    ),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    id: serial('id').primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    type: transactionType('type').notNull(),
    amount: integer('amount').notNull(),
    occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
    categoryId: integer('category_id').notNull(),
    accountId: integer('account_id'),
    memo: varchar('memo', { length: 200 }).notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'transactions_category_household_type_fk',
      columns: [table.categoryId, table.householdId, table.type],
      foreignColumns: [categories.id, categories.householdId, categories.type],
    }).onDelete('restrict'),
    foreignKey({
      name: 'transactions_account_household_fk',
      columns: [table.accountId, table.householdId],
      foreignColumns: [accounts.id, accounts.householdId],
    }).onDelete('restrict'),
    check(
      'transactions_amount_limit_check',
      sql`${table.amount} >= ${sql.raw(String(-AMOUNT_LIMIT))} AND ${table.amount} <= ${sql.raw(
        String(AMOUNT_LIMIT),
      )}`,
    ),
    index('transactions_household_occurred_on_idx').on(table.householdId, table.occurredOn),
    index('transactions_household_type_occurred_on_idx').on(
      table.householdId,
      table.type,
      table.occurredOn,
    ),
    index('transactions_household_category_idx').on(table.householdId, table.categoryId),
    index('transactions_household_account_idx').on(table.householdId, table.accountId),
  ],
);

export const transfers = pgTable(
  'transfers',
  {
    id: serial('id').primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    fromAccountId: integer('from_account_id').notNull(),
    toAccountId: integer('to_account_id').notNull(),
    amount: integer('amount').notNull(),
    occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
    memo: varchar('memo', { length: 200 }).notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'transfers_from_account_household_fk',
      columns: [table.fromAccountId, table.householdId],
      foreignColumns: [accounts.id, accounts.householdId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'transfers_to_account_household_fk',
      columns: [table.toAccountId, table.householdId],
      foreignColumns: [accounts.id, accounts.householdId],
    }).onDelete('restrict'),
    check('transfers_distinct_accounts_check', sql`${table.fromAccountId} <> ${table.toAccountId}`),
    check(
      'transfers_amount_positive_limit_check',
      sql`${table.amount} > 0 AND ${table.amount} <= ${sql.raw(String(AMOUNT_LIMIT))}`,
    ),
    index('transfers_household_occurred_on_idx').on(table.householdId, table.occurredOn),
    index('transfers_household_from_account_idx').on(table.householdId, table.fromAccountId),
    index('transfers_household_to_account_idx').on(table.householdId, table.toAccountId),
  ],
);

export type SystemHealthcheck = typeof systemHealthchecks.$inferSelect;
export type NewSystemHealthcheck = typeof systemHealthchecks.$inferInsert;
export type Household = typeof households.$inferSelect;
export type NewHousehold = typeof households.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type TransactionImport = typeof transactionImports.$inferSelect;
export type NewTransactionImport = typeof transactionImports.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Transfer = typeof transfers.$inferSelect;
export type NewTransfer = typeof transfers.$inferInsert;
