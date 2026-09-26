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

export function createDatabaseClient(connectionString = getDatabaseUrl()): DatabaseClient {
  const sql = postgres(connectionString, {
    connect_timeout: 3,
    idle_timeout: 20,
    max: 5,
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
