import postgres, { type Sql } from 'postgres';

const DEFAULT_POSTGRES_PORT = 5432;
const TEST_DATABASE_NAME_PATTERN = /(?:^|[_-])tests?(?:$|[_-])/i;

export interface DatabaseTarget {
  host: string;
  port: number;
  database: string;
  isLoopback: boolean;
}

export interface SafeTestDatabaseTarget {
  url: string;
  target: DatabaseTarget;
}

interface DatabaseIdentity {
  database: string;
  systemIdentifier: string;
}

export type ReferenceSqlFactory = (
  connectionString: string,
  options: {
    connect_timeout: number;
    idle_timeout: number;
    max: number;
  },
) => Sql;

const defaultReferenceSqlFactory: ReferenceSqlFactory = (connectionString, options) =>
  postgres(connectionString, options);

class SameDatabaseError extends Error {}

const DATABASE_IDENTITY_ERROR = 'could not verify DATABASE_URL database identity';

function normalizeHost(hostname: string): { host: string; isLoopback: boolean } {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  const isLoopback =
    host === 'localhost' ||
    host === '::1' ||
    /^127(?:\.\d{1,3}){3}$/.test(host) ||
    host === '0:0:0:0:0:0:0:1';

  return { host: isLoopback ? 'loopback' : host, isLoopback };
}

export function parseDatabaseTarget(
  connectionString: string,
  label = 'database URL',
): DatabaseTarget {
  let url: URL;
  try {
    url = new URL(connectionString.trim());
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL`);
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(`${label} must be a valid PostgreSQL URL`);
  }

  const databasePath = url.pathname.replace(/^\//, '');
  let database: string;
  try {
    database = decodeURIComponent(databasePath);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL`);
  }
  if (!url.hostname || !database) {
    throw new Error(`${label} must include a host and database name`);
  }

  const { host, isLoopback } = normalizeHost(url.hostname);
  const port = url.port ? Number(url.port) : DEFAULT_POSTGRES_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${label} must include a valid port`);
  }

  return { host, port, database, isLoopback };
}

export function isTestDatabaseName(database: string): boolean {
  return TEST_DATABASE_NAME_PATTERN.test(database);
}

export function sameDatabaseTarget(left: DatabaseTarget, right: DatabaseTarget): boolean {
  return left.host === right.host && left.port === right.port && left.database === right.database;
}

export function assertSafeTestDatabaseTarget(
  environment: NodeJS.ProcessEnv = process.env,
): SafeTestDatabaseTarget {
  const testUrl = environment.TEST_DATABASE_URL?.trim();
  if (!testUrl) {
    throw new Error('TEST_DATABASE_URL is required for integration tests');
  }
  if (environment.NODE_ENV?.trim().toLowerCase() === 'production') {
    throw new Error('destructive integration tests are not allowed in production');
  }

  const target = parseDatabaseTarget(testUrl, 'TEST_DATABASE_URL');
  if (!target.isLoopback) {
    throw new Error('TEST_DATABASE_URL must use a loopback host');
  }
  if (!isTestDatabaseName(target.database)) {
    throw new Error('TEST_DATABASE_URL must use a test-designated database name');
  }

  const databaseUrl = environment.DATABASE_URL;
  if (databaseUrl !== undefined) {
    const normalizedDatabaseUrl = databaseUrl.trim();
    if (!normalizedDatabaseUrl) {
      throw new Error('DATABASE_URL must be a non-empty PostgreSQL URL when provided');
    }
    const developmentTarget = parseDatabaseTarget(normalizedDatabaseUrl, 'DATABASE_URL');
    if (sameDatabaseTarget(target, developmentTarget)) {
      throw new Error('TEST_DATABASE_URL must be different from DATABASE_URL');
    }
  }

  return { url: testUrl, target };
}

async function readDatabaseIdentity(sql: Sql): Promise<DatabaseIdentity> {
  const rows = await sql<DatabaseIdentity[]>`
    select
      current_database() as database,
      (select system_identifier::text from pg_control_system()) as "systemIdentifier"
  `;
  const row = rows[0];
  if (!row?.database || !row.systemIdentifier) {
    throw new Error('database identity query returned no identity');
  }
  return row;
}

export async function verifySafeTestDatabaseConnection(
  testSql: Sql,
  target: DatabaseTarget,
  databaseUrl?: string,
  referenceSqlFactory: ReferenceSqlFactory = defaultReferenceSqlFactory,
): Promise<void> {
  let testIdentity: DatabaseIdentity;
  try {
    testIdentity = await readDatabaseIdentity(testSql);
  } catch {
    throw new Error('could not verify TEST_DATABASE_URL database identity');
  }
  if (testIdentity.database !== target.database) {
    throw new Error('TEST_DATABASE_URL connected to an unexpected database');
  }

  const referenceUrl = databaseUrl?.trim();
  if (databaseUrl !== undefined && !referenceUrl) {
    throw new Error(DATABASE_IDENTITY_ERROR);
  }
  if (!referenceUrl) {
    return;
  }

  let referenceSql: Sql | undefined;
  let failure: Error | undefined;
  try {
    referenceSql = referenceSqlFactory(referenceUrl, {
      connect_timeout: 3,
      idle_timeout: 5,
      max: 1,
    });
    await referenceSql`select 1`;

    const referenceIdentity = await readDatabaseIdentity(referenceSql);
    if (
      testIdentity.database === referenceIdentity.database &&
      testIdentity.systemIdentifier === referenceIdentity.systemIdentifier
    ) {
      throw new SameDatabaseError(
        'TEST_DATABASE_URL resolved to the same database as DATABASE_URL',
      );
    }
  } catch (error) {
    failure = error instanceof SameDatabaseError ? error : new Error(DATABASE_IDENTITY_ERROR);
  } finally {
    try {
      await referenceSql?.end({ timeout: 5 });
    } catch {
      failure = new Error(DATABASE_IDENTITY_ERROR);
    }
  }

  if (failure) {
    throw failure;
  }
}
