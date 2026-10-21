import type { SQL } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { getDatabaseUrl } from './env.js';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseClient {
  db: Database;
  sql: Sql;
  close: () => Promise<void>;
}

/** Neon and other serverless providers pause idle computes; waking one takes seconds. */
const CONNECT_TIMEOUT_SECONDS = 10;

/**
 * A pooled endpoint (pgbouncer in transaction mode) cannot keep server-side prepared
 * statements, so the connection has to stay in simple-query mode.
 */
function isPooledConnection(connectionString: string): boolean {
  try {
    return /-pooler\./.test(new URL(connectionString).hostname);
  } catch {
    return false;
  }
}

export function createDatabaseClient(connectionString = getDatabaseUrl()): DatabaseClient {
  const sql = postgres(connectionString, {
    connect_timeout: CONNECT_TIMEOUT_SECONDS,
    idle_timeout: 20,
    max: 5,
    ...(isPooledConnection(connectionString) ? { prepare: false } : {}),
  });

  return {
    db: drizzle(sql, { schema }),
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
}

export async function checkDatabaseConnection(sql: Sql, timeoutMs = 3_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('database health check timed out'));
    }, timeoutMs);
    timer.unref?.();
  });

  try {
    await Promise.race([sql`select 1`, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `db.execute` returns the rows in postgres.js but the whole result set in the Neon
 * drivers, so raw queries go through this helper instead of touching the driver shape.
 */
export async function executeRows<T>(
  executor: { execute(query: SQL): Promise<unknown> },
  query: SQL,
): Promise<T[]> {
  const result = (await executor.execute(query)) as T[] | { rows: T[] };
  return Array.isArray(result) ? result : result.rows;
}
