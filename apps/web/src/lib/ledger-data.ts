import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  createDatabaseClient,
  createNeonDatabaseClient,
  DEFAULT_HOUSEHOLD_ID,
  getDatabaseUrl,
  type Database,
  type DatabaseClient,
} from '@kobako/db';

import { demoHouseholdExists } from './demo-ledger';

let databaseClient: DatabaseClient | undefined;

/** Worker deployments reach Neon over WebSocket, so they cannot share a cached client. */
export function usesServerlessDriver(): boolean {
  return process.env.DEMO_DB_DRIVER === 'neon';
}

export const DEMO_HOUSEHOLD_COOKIE = 'kobako-demo-household';

/** True on deployments that hand out throwaway households instead of using the default one. */
export function isDemoDeployment(): boolean {
  return process.env.DEMO_MODE === '1';
}

export function getLedgerClient(): DatabaseClient {
  if (usesServerlessDriver()) return createNeonDatabaseClient(getDatabaseUrl());
  databaseClient ??= createDatabaseClient(getDatabaseUrl());
  return databaseClient;
}

export function getLedgerDatabase(): Database {
  return getLedgerClient().db;
}

/**
 * Resolve the active household in one place until authentication supplies it.
 * Demo deployments read the cookie issued by `/demo/start` and send visitors there when
 * the household is missing or was evicted.
 */
export async function getCurrentHouseholdId(): Promise<string> {
  if (!isDemoDeployment()) return DEFAULT_HOUSEHOLD_ID;

  const householdId = (await cookies()).get(DEMO_HOUSEHOLD_COOKIE)?.value;
  if (householdId && (await demoHouseholdExists(getLedgerClient(), householdId)))
    return householdId;
  redirect('/demo/start');
}
