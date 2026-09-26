import { NextResponse } from 'next/server';

import {
  checkDatabaseConnection,
  createDatabaseClient,
  getDatabaseUrl,
  redactDatabaseUrl,
  type DatabaseClient,
} from '@kobako/db';

import { healthStatus } from '../../../../src/lib/health';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

let databaseClient: DatabaseClient | undefined;

function getClient(): DatabaseClient {
  databaseClient ??= createDatabaseClient(getDatabaseUrl());
  return databaseClient;
}

function databaseLogContext(): string {
  try {
    return redactDatabaseUrl(getDatabaseUrl());
  } catch {
    return '[redacted database url]';
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    await checkDatabaseConnection(getClient().sql);
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
