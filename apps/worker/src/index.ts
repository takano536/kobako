import {
  checkDatabaseConnection,
  createDatabaseClient,
  getDatabaseUrl,
  processDueCardPayments,
  redactDatabaseUrl,
  type DatabaseClient,
} from '@kobako/db';

const WORKER_INTERVAL_MS = 60_000;

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

    let tickRunning = false;
    let tickPromise = Promise.resolve();
    const tick = (): void => {
      if (tickRunning || !client) return;
      tickRunning = true;
      tickPromise = processDueCardPayments(client.db)
        .then((result) => {
          if (result.completed + result.settled + result.blocked + result.errors > 0) {
            console.log('[worker] card billing tick complete', result);
          }
        })
        .catch((error: unknown) => {
          console.error('[worker] card billing tick failed', {
            errorType: error instanceof Error ? error.name : 'UnknownError',
          });
        })
        .finally(() => {
          tickRunning = false;
        });
    };
    tick();
    const interval = setInterval(tick, WORKER_INTERVAL_MS);
    let resolveShutdown: (() => void) | undefined;
    const shutdownRequested = new Promise<void>((resolve) => {
      resolveShutdown = resolve;
    });
    let shuttingDown = false;
    const handleSignal = (signal: NodeJS.Signals): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[worker] received ${signal}; shutting down`);
      resolveShutdown?.();
    };

    process.once('SIGTERM', handleSignal);
    process.once('SIGINT', handleSignal);
    try {
      await shutdownRequested;
    } finally {
      clearInterval(interval);
      await tickPromise;
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
