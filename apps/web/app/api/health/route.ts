import { NextResponse } from 'next/server';

import { healthStatus } from '../../../src/lib/health';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export function GET(): NextResponse {
  return NextResponse.json(healthStatus('ok'), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
