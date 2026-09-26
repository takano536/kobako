import { z } from 'zod';

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

export const databaseEnvSchema = z.object({
  DATABASE_URL: postgresUrl,
});

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;

/**
 * Parse a process environment only when server code actually needs a database.
 * Keeping this lazy lets a Next.js build run without production credentials.
 */
export function getDatabaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const result = databaseEnvSchema.safeParse(environment);
  if (!result.success) {
    throw new Error('DATABASE_URL is required and must be a valid PostgreSQL URL');
  }

  return result.data.DATABASE_URL;
}

/**
 * Return enough connection context for an operational log while never exposing
 * credentials or query-string options that may contain secrets.
 */
export function redactDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    const credentials = url.username || url.password ? '[redacted]:[redacted]@' : '';
    return `${url.protocol}//${credentials}${url.host}${url.pathname}`;
  } catch {
    return '[redacted database url]';
  }
}
