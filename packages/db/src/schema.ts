import { sql } from 'drizzle-orm';
import {
  boolean,
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
  uniqueIndex,
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

/** The user-facing account kinds; credit cards are the only fixed liability kind. */
export const accountKind = pgEnum('account_kind', [
  'cash',
  'bank',
  'credit_card',
  'debit_card',
  'electronic_money',
  'other',
]);

export type AccountKind = (typeof accountKind.enumValues)[number];

export const accountStatus = pgEnum('account_status', ['active', 'closed']);

export type AccountStatus = (typeof accountStatus.enumValues)[number];

export const cardPaymentMonthOffset = pgEnum('card_payment_month_offset', [
  'same_month',
  'next_month',
  'two_months_later',
]);

export type CardPaymentMonthOffset = (typeof cardPaymentMonthOffset.enumValues)[number];

export const cardAutoPaymentStatus = pgEnum('card_auto_payment_status', [
  'completed',
  'settled',
  'blocked',
]);

export type CardAutoPaymentStatus = (typeof cardAutoPaymentStatus.enumValues)[number];

/** A transfer is deliberately kept out of the income/expense enum and totals. */
export type TransferType = 'transfer';

/** A single ownership boundary for the pre-auth local ledger. */
export const households = pgTable('households', {
  id: uuid('id').primaryKey(),
  slug: varchar('slug', { length: 80 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  ledgerInitialized: boolean('ledger_initialized').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const accountGroups = pgTable(
  'account_groups',
  {
    id: serial('id').primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    defaultKind: accountKind('default_kind'),
    sortOrder: integer('sort_order').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('account_groups_household_name_unique').on(table.householdId, table.name),
    uniqueIndex('account_groups_household_default_kind_unique')
      .on(table.householdId, table.defaultKind)
      .where(sql`${table.defaultKind} is not null`),
    unique('account_groups_id_household_unique').on(table.id, table.householdId),
    index('account_groups_household_sort_order_idx').on(
      table.householdId,
      table.sortOrder,
      table.id,
    ),
    check('account_groups_sort_order_check', sql`${table.sortOrder} >= 0`),
  ],
);

export const accounts = pgTable(
  'accounts',
  {
    id: serial('id').primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    kind: accountKind('kind').notNull().default('other'),
    groupId: integer('group_id'),
    status: accountStatus('status').notNull().default('active'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('accounts_id_household_unique').on(table.id, table.householdId),
    foreignKey({
      name: 'accounts_group_household_fk',
      columns: [table.groupId, table.householdId],
      foreignColumns: [accountGroups.id, accountGroups.householdId],
    }).onDelete('restrict'),
    index('accounts_household_name_idx').on(table.householdId, table.name),
    index('accounts_household_kind_sort_order_idx').on(
      table.householdId,
      table.kind,
      table.sortOrder,
      table.id,
    ),
    check('accounts_sort_order_check', sql`${table.sortOrder} >= 0`),
    check(
      'accounts_name_not_blank_check',
      sql`length(regexp_replace(${table.name}, '[[:space:]]', '', 'g')) > 0`,
    ),
  ],
);

export const accountImportMappings = pgTable(
  'account_import_mappings',
  {
    id: serial('id').primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 80 }).notNull(),
    sourceAccountId: varchar('source_account_id', { length: 255 }),
    sourceAccountName: varchar('source_account_name', { length: 120 }).notNull(),
    accountId: integer('account_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'account_import_mappings_account_household_fk',
      columns: [table.accountId, table.householdId],
      foreignColumns: [accounts.id, accounts.householdId],
    }).onDelete('restrict'),
    uniqueIndex('account_import_mappings_source_id_unique')
      .on(table.householdId, table.source, table.sourceAccountId)
      .where(sql`${table.sourceAccountId} is not null`),
    uniqueIndex('account_import_mappings_source_name_unique')
      .on(table.householdId, table.source, table.sourceAccountName)
      .where(sql`${table.sourceAccountId} is null`),
    index('account_import_mappings_household_source_name_idx').on(
      table.householdId,
      table.source,
      table.sourceAccountName,
    ),
    index('account_import_mappings_household_account_idx').on(table.householdId, table.accountId),
    check(
      'account_import_mappings_identity_check',
      sql`${table.sourceAccountId} is not null or length(btrim(${table.sourceAccountName})) > 0`,
    ),
    check(
      'account_import_mappings_source_id_check',
      sql`${table.sourceAccountId} is null or length(btrim(${table.sourceAccountId})) > 0`,
    ),
  ],
);

export const accountCardConditions = pgTable(
  'account_card_conditions',
  {
    id: serial('id').primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    accountId: integer('account_id').notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }),
    closingDay: varchar('closing_day', { length: 5 }),
    paymentDay: varchar('payment_day', { length: 5 }),
    paymentMonthOffset: cardPaymentMonthOffset('payment_month_offset'),
    debitAccountId: integer('debit_account_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'account_card_conditions_account_household_fk',
      columns: [table.accountId, table.householdId],
      foreignColumns: [accounts.id, accounts.householdId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'account_card_conditions_debit_account_household_fk',
      columns: [table.debitAccountId, table.householdId],
      foreignColumns: [accounts.id, accounts.householdId],
    }).onDelete('restrict'),
    uniqueIndex('account_card_conditions_account_effective_from_unique')
      .on(table.accountId, table.effectiveFrom)
      .where(sql`${table.effectiveFrom} is not null`),
    uniqueIndex('account_card_conditions_account_unset_unique')
      .on(table.accountId)
      .where(sql`${table.effectiveFrom} is null`),
    index('account_card_conditions_household_account_effective_idx').on(
      table.householdId,
      table.accountId,
      table.effectiveFrom,
    ),
    check(
      'account_card_conditions_closing_day_check',
      sql`${table.closingDay} is null or ${table.closingDay} ~ '^(?:[1-9]|[12][0-9]|3[01]|last)$'`,
    ),
    check(
      'account_card_conditions_payment_day_check',
      sql`${table.paymentDay} is null or ${table.paymentDay} ~ '^(?:[1-9]|[12][0-9]|3[01]|last)$'`,
    ),
  ],
);
export const accountCardSettings = pgTable(
  'account_card_settings',
  {
    id: serial('id').primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    accountId: integer('account_id').notNull(),
    closingDay: varchar('closing_day', { length: 5 }),
    paymentDay: varchar('payment_day', { length: 5 }),
    paymentMonthOffset: cardPaymentMonthOffset('payment_month_offset'),
    debitAccountId: integer('debit_account_id'),
    autoPaymentStartsOn: date('auto_payment_starts_on', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'account_card_settings_account_household_fk',
      columns: [table.accountId, table.householdId],
      foreignColumns: [accounts.id, accounts.householdId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'account_card_settings_debit_account_household_fk',
      columns: [table.debitAccountId, table.householdId],
      foreignColumns: [accounts.id, accounts.householdId],
    }).onDelete('restrict'),
    unique('account_card_settings_account_unique').on(table.accountId, table.householdId),
    check(
      'account_card_settings_closing_day_check',
      sql`${table.closingDay} is null or ${table.closingDay} ~ '^(?:[1-9]|[12][0-9]|3[01]|last)$'`,
    ),
    check(
      'account_card_settings_payment_day_check',
      sql`${table.paymentDay} is null or ${table.paymentDay} ~ '^(?:[1-9]|[12][0-9]|3[01]|last)$'`,
    ),
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
    operationKey: varchar('operation_key', { length: 120 }),
    originalFilename: varchar('original_filename', { length: 255 }).notNull(),
    transactionCount: integer('transaction_count').notNull(),
    incomeCount: integer('income_count').notNull().default(0),
    expenseCount: integer('expense_count').notNull().default(0),
    transferCount: integer('transfer_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('transaction_imports_household_source_operation_unique')
      .on(table.householdId, table.source, table.operationKey)
      .where(sql`${table.operationKey} is not null`),
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

export const cardAutoPaymentRuns = pgTable(
  'card_auto_payment_runs',
  {
    id: serial('id').primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    cardAccountId: integer('card_account_id').notNull(),
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    status: cardAutoPaymentStatus('status').notNull(),
    transferId: integer('transfer_id').references(() => transfers.id, { onDelete: 'set null' }),
    reason: varchar('reason', { length: 200 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'card_auto_payment_runs_card_account_household_fk',
      columns: [table.cardAccountId, table.householdId],
      foreignColumns: [accounts.id, accounts.householdId],
    }).onDelete('restrict'),
    unique('card_auto_payment_runs_household_card_due_unique').on(
      table.householdId,
      table.cardAccountId,
      table.dueOn,
    ),
    index('card_auto_payment_runs_household_card_due_idx').on(
      table.householdId,
      table.cardAccountId,
      table.dueOn,
    ),
  ],
);

export type SystemHealthcheck = typeof systemHealthchecks.$inferSelect;
export type NewSystemHealthcheck = typeof systemHealthchecks.$inferInsert;
export type Household = typeof households.$inferSelect;
export type NewHousehold = typeof households.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type AccountCardSetting = typeof accountCardSettings.$inferSelect;
export type NewAccountCardSetting = typeof accountCardSettings.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type TransactionImport = typeof transactionImports.$inferSelect;
export type NewTransactionImport = typeof transactionImports.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Transfer = typeof transfers.$inferSelect;
export type NewTransfer = typeof transfers.$inferInsert;
export type CardAutoPaymentRun = typeof cardAutoPaymentRuns.$inferSelect;
export type NewCardAutoPaymentRun = typeof cardAutoPaymentRuns.$inferInsert;
