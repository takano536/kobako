import { pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

/** A domain-neutral table used to prove migrations and database connectivity. */
export const systemHealthchecks = pgTable('system_healthchecks', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 120 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type SystemHealthcheck = typeof systemHealthchecks.$inferSelect;
export type NewSystemHealthcheck = typeof systemHealthchecks.$inferInsert;
