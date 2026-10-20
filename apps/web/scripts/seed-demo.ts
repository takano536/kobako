/**
 * Seed or reset the demo ledger used by Cloudflare preview deployments.
 *
 *   node --import tsx apps/web/scripts/seed-demo.ts           # seed when empty
 *   node --import tsx apps/web/scripts/seed-demo.ts --reset   # rebuild from scratch
 */
import { createDatabaseClient } from '@kobako/db';

import { seedDemoLedger } from '../src/lib/demo-ledger';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const reset = process.argv.includes('--reset');
const client = createDatabaseClient(databaseUrl);
const result = await seedDemoLedger(client, { reset });
await client.close();

if (result.status === 'skipped') {
  console.log(`demo ledger already has ${result.accounts} accounts; nothing to seed`);
} else {
  console.log(
    `demo ledger rebuilt: ${result.accounts} accounts, ${result.transactions} transactions, ${result.transfers} transfer`,
  );
}
