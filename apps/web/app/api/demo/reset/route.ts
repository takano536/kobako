import { NextResponse } from 'next/server';

import { purgeDemoHouseholds } from '../../../../src/lib/demo-ledger';
import { getLedgerClient, isDemoDeployment } from '../../../../src/lib/ledger-data';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Drop every visitor household. Used by the scheduled reset and by CI before a deployment;
 * requires `DEMO_RESET_TOKEN` as a bearer token whenever that variable is configured.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isDemoDeployment()) {
    return new NextResponse('not found', { status: 404 });
  }

  const expected = process.env.DEMO_RESET_TOKEN;
  if (expected && request.headers.get('authorization') !== `Bearer ${expected}`) {
    return new NextResponse('unauthorized', { status: 401 });
  }

  const purged = await purgeDemoHouseholds(getLedgerClient());
  return NextResponse.json({ purged }, { headers: { 'cache-control': 'no-store' } });
}
