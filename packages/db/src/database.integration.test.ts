import { asc } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, afterAll } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from './client.js';
import { runMigrations } from './migrate.js';
import { systemHealthchecks } from './schema.js';

describe('PostgreSQL migrations and connectivity', () => {
  let client: DatabaseClient;

  beforeAll(async () => {
    const testUrl = process.env.TEST_DATABASE_URL;
    const developmentUrl = process.env.DATABASE_URL;
    if (!testUrl) {
      throw new Error('TEST_DATABASE_URL is required for integration tests');
    }
    if (developmentUrl && testUrl === developmentUrl) {
      throw new Error('TEST_DATABASE_URL must be different from DATABASE_URL');
    }

    await runMigrations(testUrl);
    client = createDatabaseClient(testUrl);
  });

  beforeEach(async () => {
    await client.sql`truncate table "system_healthchecks" restart identity`;
  });

  afterAll(async () => {
    await client?.close();
  });

  it('writes and reads the minimal connectivity table', async () => {
    const key = `integration-${Date.now()}`;
    await client.db.insert(systemHealthchecks).values({ key });

    const rows = await client.db
      .select()
      .from(systemHealthchecks)
      .orderBy(asc(systemHealthchecks.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe(key);
    expect(rows[0]?.id).toBe(1);
  });

  it('starts each test with isolated data', async () => {
    const rows = await client.db.select().from(systemHealthchecks);

    expect(rows).toEqual([]);
  });
});
