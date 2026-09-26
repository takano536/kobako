import {
  createDatabaseClient,
  DEFAULT_HOUSEHOLD_ID,
  getDatabaseUrl,
  type Database,
  type DatabaseClient,
} from '@kobako/db';

let databaseClient: DatabaseClient | undefined;

export function getLedgerDatabase(): Database {
  databaseClient ??= createDatabaseClient(getDatabaseUrl());
  return databaseClient.db;
}

/** Resolve the active household in one place until authentication supplies it. */
export function getCurrentHouseholdId(): string {
  return DEFAULT_HOUSEHOLD_ID;
}
