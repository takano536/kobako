import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseClient, type DatabaseClient } from './client.js';
import { createAccount, initializeDefaultLedger, listActiveManagedAccounts } from './index.js';
import {
  createFixedCost,
  deleteFixedCost,
  getFixedCostSummary,
  processDueFixedCosts,
  updateFixedCost,
} from './fixed-costs.js';
import { listAssetCategories } from './asset-categories.js';
import { listCategories } from './ledger.js';
import { runMigrations } from './migrate.js';
import {
  assertSafeTestDatabaseTarget,
  verifySafeTestDatabaseConnection,
  type DatabaseTarget,
} from './database-safety.js';
import { DEFAULT_HOUSEHOLD_ID, type HouseholdIdentity } from './ledger.js';
import { fixedCostOccurrences, transactions } from './schema.js';
import { type FixedCostInput } from './validation.js';

const OTHER_HOUSEHOLD: HouseholdIdentity = {
  id: '00000000-0000-0000-0000-000000000002',
  slug: 'fixed-cost-other',
  name: '別世帯',
};

let client: DatabaseClient;
let target: DatabaseTarget;
let developmentUrl: string | undefined;
let categoryId: number;
let accountId: number;
let otherCategoryId: number;
let otherAccountId: number;

async function input(overrides: Partial<FixedCostInput> = {}): Promise<FixedCostInput> {
  return {
    name: '固定費テスト',
    amount: 4321,
    categoryId,
    accountId,
    intervalCount: 1,
    intervalUnit: 'month',
    startMonth: '2026-01',
    day: 15,
    ...overrides,
  };
}

async function idsFor(householdId: string): Promise<{ category: number; account: number }> {
  const categories = await listCategories(client.db, householdId, 'expense');
  const assetCategories = await listAssetCategories(client.db, householdId);
  const assetCategory = assetCategories[0];
  if (!categories[0] || !assetCategory) throw new Error('default references are missing');
  const accounts = await listActiveManagedAccounts(client.db, householdId);
  if (!accounts[0]) {
    const created = await createAccount(client.db, householdId, {
      name: `${householdId}-口座`,
      assetCategoryId: assetCategory.id,
    });
    if (created.status !== 'ok') throw new Error('account setup failed');
    return { category: categories[0].id, account: created.account.id };
  }
  return { category: categories[0].id, account: accounts[0].id };
}

describe('fixed costs integration', () => {
  beforeAll(async () => {
    const safe = assertSafeTestDatabaseTarget();
    target = safe.target;
    developmentUrl = process.env.DATABASE_URL;
    const resetClient = createDatabaseClient(safe.url);
    try {
      await verifySafeTestDatabaseConnection(resetClient.sql, target, developmentUrl);
      await resetClient.sql`drop schema if exists drizzle cascade`;
      await resetClient.sql`drop schema public cascade`;
      await resetClient.sql`create schema public`;
    } finally {
      await resetClient.close();
    }
    await runMigrations(safe.url);
    client = createDatabaseClient(safe.url);
  });

  beforeEach(async () => {
    await verifySafeTestDatabaseConnection(client.sql, target, developmentUrl);
    await client.sql`truncate table fixed_cost_occurrences, fixed_costs, transactions restart identity cascade`;
    await initializeDefaultLedger(client.db);
    await initializeDefaultLedger(client.db, OTHER_HOUSEHOLD);
    ({ category: categoryId, account: accountId } = await idsFor(DEFAULT_HOUSEHOLD_ID));
    ({ category: otherCategoryId, account: otherAccountId } = await idsFor(OTHER_HOUSEHOLD.id));
  });

  afterAll(async () => {
    await client?.close();
  });

  it('records once per due date and keeps the transaction immutable after edit/delete', async () => {
    const created = await createFixedCost(client.db, DEFAULT_HOUSEHOLD_ID, await input());
    if (created.status !== 'ok') throw new Error('fixed cost setup failed');

    await expect(processDueFixedCosts(client.db, '2026-10-15')).resolves.toMatchObject({
      created: 1,
      skipped: 0,
    });
    await expect(processDueFixedCosts(client.db, '2026-10-15')).resolves.toMatchObject({
      created: 0,
      skipped: 1,
    });
    await expect(processDueFixedCosts(client.db, '2026-10-10')).resolves.toMatchObject({
      created: 0,
    });
    await expect(processDueFixedCosts(client.db, '2025-12-15')).resolves.toMatchObject({
      created: 0,
    });

    const recorded = await client.db
      .select()
      .from(transactions)
      .where(eq(transactions.externalId, `fixed-cost:${created.fixedCost.id}:2026-10-15`));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      householdId: DEFAULT_HOUSEHOLD_ID,
      type: 'expense',
      amount: 4321,
      occurredOn: '2026-10-15',
      categoryId,
      accountId,
      memo: '固定費テスト',
    });

    const updated = await updateFixedCost(
      client.db,
      DEFAULT_HOUSEHOLD_ID,
      created.fixedCost.id,
      await input({ name: '編集後', amount: 9999, day: 20 }),
    );
    expect(updated.status).toBe('ok');
    expect(await deleteFixedCost(client.db, DEFAULT_HOUSEHOLD_ID, created.fixedCost.id)).toBe('ok');
    const unchanged = await client.db
      .select()
      .from(transactions)
      .where(eq(transactions.externalId, `fixed-cost:${created.fixedCost.id}:2026-10-15`));
    expect(unchanged).toEqual(recorded);
  });

  it('enforces household scope for references and mutations', async () => {
    await expect(
      createFixedCost(
        client.db,
        DEFAULT_HOUSEHOLD_ID,
        await input({ categoryId: otherCategoryId, accountId: otherAccountId }),
      ),
    ).resolves.toMatchObject({ status: 'validation_error' });
    const other = await createFixedCost(client.db, OTHER_HOUSEHOLD.id, {
      ...(await input()),
      categoryId: otherCategoryId,
      accountId: otherAccountId,
    });
    if (other.status !== 'ok') throw new Error('other household setup failed');
    expect(
      await updateFixedCost(client.db, DEFAULT_HOUSEHOLD_ID, other.fixedCost.id, await input()),
    ).toEqual({ status: 'not_found' });
    expect(await deleteFixedCost(client.db, DEFAULT_HOUSEHOLD_ID, other.fixedCost.id)).toBe(
      'not_found',
    );
  });

  it('returns the representative monthly and annual summary', async () => {
    const rows = [
      [85000, 1, 'month'],
      [3240, 2, 'month'],
      [7800, 1, 'month'],
      [3278, 1, 'month'],
      [12000, 3, 'month'],
      [1490, 1, 'month'],
      [1080, 1, 'month'],
      [7700, 1, 'month'],
      [5900, 1, 'year'],
    ] as const;
    for (const [amount, intervalCount, intervalUnit] of rows) {
      const result = await createFixedCost(
        client.db,
        DEFAULT_HOUSEHOLD_ID,
        await input({ amount, intervalCount, intervalUnit }),
      );
      expect(result.status).toBe('ok');
    }
    await expect(getFixedCostSummary(client.db, DEFAULT_HOUSEHOLD_ID)).resolves.toEqual({
      monthly: 112460,
      annual: 1349516,
    });
    const occurrenceCount = await client.db
      .select()
      .from(fixedCostOccurrences)
      .where(
        and(
          eq(fixedCostOccurrences.householdId, DEFAULT_HOUSEHOLD_ID),
          eq(fixedCostOccurrences.occurredOn, '2026-10-15'),
        ),
      );
    expect(occurrenceCount).toHaveLength(0);
  });
});
