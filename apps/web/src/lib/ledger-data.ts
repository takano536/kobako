import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { cache } from 'react';

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

/**
 * Neon's WebSocket `Pool` has to be connected, used, and ended within one request on
 * Workers. Pools that were never ended piled up in the isolate until it hit its resource
 * limits (Error 1102) and answered every request, RSC navigations included, with a 503.
 * A render shares one pool, and it is ended once the response has been sent.
 */
const requestScopedServerlessClient = cache((): DatabaseClient => {
  const client = createNeonDatabaseClient(getDatabaseUrl());
  after(() => client.close());
  return client;
});

export function getLedgerClient(): DatabaseClient {
  if (usesServerlessDriver()) return requestScopedServerlessClient();
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
