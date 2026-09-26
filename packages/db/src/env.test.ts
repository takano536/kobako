import { describe, expect, it } from 'vitest';

import { databaseEnvSchema, getDatabaseUrl, redactDatabaseUrl } from './env.js';

describe('database environment', () => {
  it('accepts a PostgreSQL connection URL', () => {
    const result = databaseEnvSchema.safeParse({
      DATABASE_URL: 'postgresql://kobako:local-password@localhost:5432/kobako',
    });

    expect(result.success).toBe(true);
    expect(getDatabaseUrl({ DATABASE_URL: 'postgres://localhost/kobako' })).toBe(
      'postgres://localhost/kobako',
    );
  });

  it('rejects missing, malformed, and non-PostgreSQL URLs', () => {
    expect(databaseEnvSchema.safeParse({}).success).toBe(false);
    expect(databaseEnvSchema.safeParse({ DATABASE_URL: 'not-a-url' }).success).toBe(false);
    expect(databaseEnvSchema.safeParse({ DATABASE_URL: 'https://example.test/db' }).success).toBe(
      false,
    );
    expect(() => getDatabaseUrl({})).toThrow('DATABASE_URL is required');
  });

  it('redacts credentials and query parameters from operational logs', () => {
    const redacted = redactDatabaseUrl(
      'postgresql://kobako:super-secret@db.example.test:5432/kobako?sslpassword=also-secret',
    );

    expect(redacted).toBe('postgresql://[redacted]:[redacted]@db.example.test:5432/kobako');
    expect(redacted).not.toContain('super-secret');
    expect(redacted).not.toContain('also-secret');
  });
});
