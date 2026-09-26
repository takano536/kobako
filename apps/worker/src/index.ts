import {
  checkDatabaseConnection,
  createDatabaseClient,
  getDatabaseUrl,
  redactDatabaseUrl,
  type DatabaseClient,
} from '@kobako/db';

async function runWorker(): Promise<void> {
  let client: DatabaseClient | undefined;
  let connectionString: string | undefined;

  try {
    connectionString = getDatabaseUrl();
    client = createDatabaseClient(connectionString);
    await checkDatabaseConnection(client.sql);
    console.log('[worker] database connection ok', {
      database: redactDatabaseUrl(connectionString),
    });

    // Keep one ref'd handle alive until pg-boss lands; this does no work or polling.
    const keepAlive = setInterval(() => undefined, 2 ** 31 - 1);
    let resolveShutdown: (() => void) | undefined;
    const shutdownRequested = new Promise<void>((resolve) => {
      resolveShutdown = resolve;
    });
    let shuttingDown = false;
    const handleSignal = (signal: NodeJS.Signals): void => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      console.log(`[worker] received ${signal}; shutting down`);
      resolveShutdown?.();
    };

    process.once('SIGTERM', handleSignal);
    process.once('SIGINT', handleSignal);
    try {
      await shutdownRequested;
    } finally {
      clearInterval(keepAlive);
    }

    await client.close();
    console.log('[worker] shutdown complete');
  } catch (error) {
    const errorType = error instanceof Error ? error.name : 'UnknownError';
    if (connectionString) {
      console.error('[worker] database connection failed', {
        database: redactDatabaseUrl(connectionString),
        errorType,
      });
    } else {
      console.error('[worker] database environment validation failed', { errorType });
    }

    try {
      await client?.close();
    } catch {
      console.error('[worker] database client close failed', { errorType: 'ShutdownError' });
    }
    process.exitCode = 1;
  }
}

await runWorker();
