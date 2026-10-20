import { NextResponse } from 'next/server';

import { getLedgerClient } from '../../../../src/lib/ledger-data';
import { seedDemoLedger } from '../../../../src/lib/demo-ledger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Rebuild the demo ledger. Only enabled when the deployment sets DEMO_MODE=1. */
export async function POST(): Promise<Response> {
  if (process.env.DEMO_MODE !== '1') {
    return new NextResponse('not found', { status: 404 });
  }

  const result = await seedDemoLedger(getLedgerClient(), { reset: true });
  return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
}
