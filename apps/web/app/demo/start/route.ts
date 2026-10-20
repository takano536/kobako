import { NextResponse, type NextRequest } from 'next/server';

import { demoHouseholdExists, provisionDemoHousehold } from '../../../src/lib/demo-ledger';
import {
  DEMO_HOUSEHOLD_COOKIE,
  getLedgerClient,
  isDemoDeployment,
} from '../../../src/lib/ledger-data';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DEMO_HOUSEHOLD_MAX_AGE = 60 * 60 * 24;
const NO_STORE = { 'cache-control': 'no-store' };

/** Relative redirect so the Location never depends on the host the server sees. */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { ...NO_STORE, location: path } });
}

/**
 * Entry point for demo deployments. A visitor keeps their household for a day, then gets a
 * fresh one; the provisioning step also bounds how many households a deployment keeps.
 */
export async function GET(request: NextRequest): Promise<Response> {
  if (!isDemoDeployment()) {
    return redirectTo('/');
  }

  const client = getLedgerClient();
  const existing = request.cookies.get(DEMO_HOUSEHOLD_COOKIE)?.value;
  if (existing && (await demoHouseholdExists(client, existing))) {
    return redirectTo('/transactions');
  }

  const householdId = await provisionDemoHousehold(client);
  const response = redirectTo('/transactions');
  response.cookies.set({
    name: DEMO_HOUSEHOLD_COOKIE,
    value: householdId,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: DEMO_HOUSEHOLD_MAX_AGE,
  });
  return response;
}
