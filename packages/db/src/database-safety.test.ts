import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import {
  assertSafeTestDatabaseTarget,
  isTestDatabaseName,
  parseDatabaseTarget,
  sameDatabaseTarget,
  verifySafeTestDatabaseConnection,
  type DatabaseTarget,
  type ReferenceSqlFactory,
} from './database-safety.js';

const databaseUrl = 'postgresql://kobako:password@localhost/kobako_dev';

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: 'postgresql://kobako:password@127.0.0.1:5432/kobako_test',
    ...overrides,
  };
}

interface FakeSql extends Sql {
  queries: string[];
}

function fakeSql(
  identity: { database?: string; systemIdentifier?: string } | Error,
  endFailure?: Error,
  queryFailure?: Error,
): FakeSql {
  const queries: string[] = [];
  const query = vi.fn(async (strings: TemplateStringsArray) => {
    const text = strings.join('');
    queries.push(text);
    if (queryFailure && !text.includes('current_database')) {
      throw queryFailure;
    }
    if (text.includes('current_database')) {
      if (identity instanceof Error) {
        throw identity;
      }
      return [identity];
    }
    return [];
  });
  const sql = query as unknown as FakeSql;
  sql.queries = queries;
  sql.end = vi.fn(async () => {
    if (endFailure) {
      throw endFailure;
    }
  });
  return sql;
}

function referenceFactory(sql: Sql): ReferenceSqlFactory {
  return vi.fn(() => sql);
}

const testTarget: DatabaseTarget = {
  host: 'loopback',
  port: 5432,
  database: 'kobako_test',
  isLoopback: true,
};

describe('database safety guard', () => {
  it('normalizes loopback aliases and the default PostgreSQL port', () => {
    const localhost = parseDatabaseTarget('postgresql://user:pass@localhost/kobako_test');
    const ipv4 = parseDatabaseTarget('postgresql://user:pass@127.0.0.1:5432/kobako_test');
    const ipv6 = parseDatabaseTarget('postgresql://user:pass@[::1]:5432/kobako_test');

    expect(localhost).toMatchObject({ host: 'loopback', port: 5432, database: 'kobako_test' });
    expect(sameDatabaseTarget(localhost, ipv4)).toBe(true);
    expect(sameDatabaseTarget(localhost, ipv6)).toBe(true);
  });

  it('requires an explicit test-designated database name', () => {
    expect(isTestDatabaseName('kobako_test')).toBe(true);
    expect(isTestDatabaseName('kobako-tests')).toBe(true);
    expect(isTestDatabaseName('kobako_dev')).toBe(false);
    expect(() =>
      assertSafeTestDatabaseTarget(
        environment({ TEST_DATABASE_URL: 'postgresql://localhost/kobako_dev' }),
      ),
    ).toThrow('test-designated');
  });

  it('rejects equal targets even when URLs use loopback aliases', () => {
    expect(() =>
      assertSafeTestDatabaseTarget(
        environment({
          DATABASE_URL: 'postgresql://user:pass@localhost:5432/kobako_test',
          TEST_DATABASE_URL: 'postgresql://other:pass@127.0.0.1/kobako_test',
        }),
      ),
    ).toThrow('different from DATABASE_URL');
  });

  it('fails closed for missing, production, and non-loopback targets', () => {
    expect(() => assertSafeTestDatabaseTarget({ DATABASE_URL: databaseUrl })).toThrow(
      'TEST_DATABASE_URL is required',
    );
    expect(() => assertSafeTestDatabaseTarget(environment({ NODE_ENV: 'production' }))).toThrow(
      'not allowed in production',
    );
    expect(() =>
      assertSafeTestDatabaseTarget(
        environment({ TEST_DATABASE_URL: 'postgresql://db.example.test/kobako_test' }),
      ),
    ).toThrow('loopback host');
  });

  it('returns the validated URL and target for CI localhost service conventions', () => {
    expect(assertSafeTestDatabaseTarget(environment({ CI: 'true' }))).toMatchObject({
      url: 'postgresql://kobako:password@127.0.0.1:5432/kobako_test',
      target: {
        host: 'loopback',
        port: 5432,
        database: 'kobako_test',
        isLoopback: true,
      },
    });
  });
});

describe('verifySafeTestDatabaseConnection', () => {
  it('rejects when the DATABASE_URL connection fails before reset SQL runs', async () => {
    const testSql = fakeSql({ database: 'kobako_test', systemIdentifier: 'test-system' });
    const factory = vi.fn(() => {
      throw new Error('password=super-secret host=private.example.test');
    }) as unknown as ReferenceSqlFactory;
    const reset = vi.fn();

    const guardedReset = (async () => {
      await verifySafeTestDatabaseConnection(
        testSql,
        testTarget,
        'postgresql://alice:super-secret@private.example.test/kobako_dev',
        factory,
      );
      reset();
    })();

    await expect(guardedReset).rejects.toThrow('could not verify DATABASE_URL database identity');
    await expect(guardedReset).rejects.not.toThrow('super-secret');
    expect(reset).not.toHaveBeenCalled();
  });

  it('rejects identity query failures and closes the reference connection', async () => {
    const testSql = fakeSql({ database: 'kobako_test', systemIdentifier: 'test-system' });
    const referenceSql = fakeSql(new Error('permission denied for function pg_control_system'));

    await expect(
      verifySafeTestDatabaseConnection(
        testSql,
        testTarget,
        'postgresql://alice:super-secret@private.example.test/kobako_dev',
        referenceFactory(referenceSql),
      ),
    ).rejects.toThrow('could not verify DATABASE_URL database identity');
    expect(referenceSql.end).toHaveBeenCalledOnce();
  });
  it('rejects reference query connection failures and closes the reference connection', async () => {
    const testSql = fakeSql({ database: 'kobako_test', systemIdentifier: 'test-system' });
    const referenceSql = fakeSql(
      { database: 'kobako_dev', systemIdentifier: 'reference-system' },
      undefined,
      new Error('password=super-secret host=private.example.test'),
    );

    await expect(
      verifySafeTestDatabaseConnection(
        testSql,
        testTarget,
        'postgresql://alice:super-secret@private.example.test/kobako_dev',
        referenceFactory(referenceSql),
      ),
    ).rejects.toThrow('could not verify DATABASE_URL database identity');
    expect(referenceSql.end).toHaveBeenCalledOnce();
  });
  it('rejects missing system identifiers without exposing connection details', async () => {
    const testSql = fakeSql({ database: 'kobako_test', systemIdentifier: 'test-system' });
    const referenceSql = fakeSql({ database: 'kobako_dev' });

    await expect(
      verifySafeTestDatabaseConnection(
        testSql,
        testTarget,
        'postgresql://alice:super-secret@private.example.test/kobako_dev',
        referenceFactory(referenceSql),
      ),
    ).rejects.toThrow('could not verify DATABASE_URL database identity');
    expect(referenceSql.end).toHaveBeenCalledOnce();
  });

  it('rejects when closing the reference connection fails', async () => {
    const testSql = fakeSql({ database: 'kobako_test', systemIdentifier: 'test-system' });
    const referenceSql = fakeSql(
      { database: 'kobako_dev', systemIdentifier: 'reference-system' },
      new Error('password=super-secret'),
    );

    await expect(
      verifySafeTestDatabaseConnection(
        testSql,
        testTarget,
        'postgresql://alice:super-secret@private.example.test/kobako_dev',
        referenceFactory(referenceSql),
      ),
    ).rejects.toThrow('could not verify DATABASE_URL database identity');
    expect(referenceSql.end).toHaveBeenCalledOnce();
  });

  it('accepts a distinct verified reference database', async () => {
    const testSql = fakeSql({ database: 'kobako_test', systemIdentifier: 'test-system' });
    const referenceSql = fakeSql({
      database: 'kobako_dev',
      systemIdentifier: 'reference-system',
    });

    await expect(
      verifySafeTestDatabaseConnection(
        testSql,
        testTarget,
        'postgresql://alice:super-secret@private.example.test/kobako_dev',
        referenceFactory(referenceSql),
      ),
    ).resolves.toBeUndefined();
    expect(referenceSql.end).toHaveBeenCalledOnce();
  });
});
