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
import { sql } from 'drizzle-orm';

import { AMOUNT_LIMIT } from './amount.js';

/** A domain-neutral table used to prove migrations and database connectivity. */
export const systemHealthchecks = pgTable('system_healthchecks', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 120 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const transactionType = pgEnum('transaction_type', ['expense', 'income']);

export type TransactionType = (typeof transactionType.enumValues)[number];

/** A single ownership boundary for the pre-auth local ledger. */
export const households = pgTable('households', {
  id: uuid('id').primaryKey(),
  slug: varchar('slug', { length: 80 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

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
  ],
);

export type SystemHealthcheck = typeof systemHealthchecks.$inferSelect;
export type NewSystemHealthcheck = typeof systemHealthchecks.$inferInsert;
export type Household = typeof households.$inferSelect;
export type NewHousehold = typeof households.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
