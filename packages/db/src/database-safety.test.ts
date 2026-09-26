import { describe, expect, it } from 'vitest';

import {
  assertSafeTestDatabaseTarget,
  isTestDatabaseName,
  parseDatabaseTarget,
  sameDatabaseTarget,
} from './database-safety.js';

const databaseUrl = 'postgresql://kobako:password@localhost/kobako_dev';

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: 'postgresql://kobako:password@127.0.0.1:5432/kobako_test',
    ...overrides,
  };
}

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
