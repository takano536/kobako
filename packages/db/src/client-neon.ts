import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import type { Sql } from 'postgres';

import type { Database, DatabaseClient } from './client.js';
import * as schema from './schema.js';

type Row = Record<string, unknown>;

interface InsertFragment {
  rows: Row[];
  columns: string[];
}

function isInsertFragment(value: unknown): value is InsertFragment {
  return typeof value === 'object' && value !== null && '__insertRows' in value;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * The seed code is written against the postgres.js tag: `sql` rows and a
 * `sql(rows, ...columns)` helper for multi-row inserts. Neon's WebSocket driver only
 * exposes `query(text, values)`, so this tag translates the subset the demo uses.
 */
function createSqlTag(pool: Pool): Sql {
  const build = (strings: TemplateStringsArray, values: unknown[]) => {
    const params: unknown[] = [];
    let text = '';
    strings.forEach((chunk, index) => {
      text += chunk;
      if (index >= values.length) return;
      const value = values[index];
      if (isInsertFragment(value)) {
        const columnList = value.columns.map(quoteIdent).join(', ');
        const rowPlaceholders = value.rows
          .map((row) => {
            const slots = value.columns.map((column) => {
              params.push(row[column] ?? null);
              return `$${params.length}`;
            });
            return `(${slots.join(', ')})`;
          })
          .join(', ');
        text += `(${columnList}) values ${rowPlaceholders}`;
        return;
      }
      params.push(value);
      text += `$${params.length}`;
    });
    return { text, params };
  };

  const run = async (strings: TemplateStringsArray, values: unknown[]) => {
    const { text, params } = build(strings, values);
    const result = await pool.query(text, params);
    return result.rows;
  };

  const tag = ((first: unknown, ...rest: unknown[]) => {
    // TemplateStringsArray is an array too, but it always carries `raw`.
    const isTemplate = Array.isArray(first) && 'raw' in (first as object);
    if (Array.isArray(first) && !isTemplate) {
      return { __insertRows: true, rows: first as Row[], columns: rest as string[] };
    }
    return run(first as TemplateStringsArray, rest);
  }) as unknown as Sql;

  return tag;
}

/**
 * Neon's serverless driver keeps the connection on a WebSocket instead of a raw TCP
 * socket, which is what the Workers runtime needs. Transactions still work through the
 * pooled client.
 */
export function createNeonDatabaseClient(connectionString: string): DatabaseClient {
  const pool = new Pool({ connectionString });
  return {
    db: drizzle(pool, { schema }) as unknown as Database,
    sql: createSqlTag(pool),
    close: () => pool.end(),
  };
}
