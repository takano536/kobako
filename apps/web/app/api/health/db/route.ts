import { NextResponse } from 'next/server';

import { checkDatabaseConnection, getDatabaseUrl, redactDatabaseUrl } from '@kobako/db';

import { healthStatus } from '../../../../src/lib/health';
import { getLedgerClient, usesServerlessDriver } from '../../../../src/lib/ledger-data';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

function databaseLogContext(): string {
  try {
    return redactDatabaseUrl(getDatabaseUrl());
  } catch {
    return '[redacted database url]';
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    await checkDatabaseConnection(getLedgerClient().sql, usesServerlessDriver() ? 10_000 : 3_000);
    return NextResponse.json(healthStatus('ok'), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const errorType = error instanceof Error ? error.name : 'UnknownError';
    console.error('[health/db] database check failed', {
      database: databaseLogContext(),
      errorType,
    });
    return NextResponse.json(healthStatus('error'), {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
