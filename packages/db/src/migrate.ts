import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { createDatabaseClient, type DatabaseClient } from './client.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

export async function runMigrations(connectionString?: string): Promise<void> {
  const client: DatabaseClient = createDatabaseClient(connectionString);
  try {
    await migrate(client.db, { migrationsFolder });
  } finally {
    await client.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runMigrations();
}
