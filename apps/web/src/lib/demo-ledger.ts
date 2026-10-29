import {
  DEFAULT_HOUSEHOLD_ID,
  deleteHousehold,
  getHousehold,
  ingestApiBatch,
  initializeDefaultLedger,
  type ApiTransactionRow,
  type ApiTransferRow,
  type DatabaseClient,
} from '@kobako/db';

export type DemoSeedResult =
  | { status: 'skipped'; accounts: number }
  | {
      status: 'seeded';
      accounts: number;
      transactions: number;
      transfers: number;
      apiTransactions: number;
      apiTransfers: number;
    };

type DemoRow = Record<string, string | number | null>;

function tokyoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function recentMonths(count: number): Array<{ year: number; month: number }> {
  const now = new Date();
  const tokyo = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const months: Array<{ year: number; month: number }> = [];
  for (let offset = 0; offset < count; offset += 1) {
    const shifted = new Date(Date.UTC(tokyo.getUTCFullYear(), tokyo.getUTCMonth() - offset, 1));
    months.push({ year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 });
  }
  return months;
}

/**
 * Fill the demo ledger with a readable household: four accounts, three months of
 * transactions, and two transfers. The newest month mixes hand-entered rows with a card
 * statement written through the real API ingest path, so the "API" badge and the API-only
 * filter have something to show. `reset` truncates the ledger first so a preview always
 * starts from the same state, while the default run is a no-op once accounts exist.
 */
export async function seedDemoLedger(
  client: DatabaseClient,
  options: { householdId?: string; reset?: boolean } = {},
): Promise<DemoSeedResult> {
  const { db, sql } = client;
  const householdId = options.householdId ?? DEFAULT_HOUSEHOLD_ID;

  // Extra households are initialized by their creator, which owns the slug.
  if (householdId === DEFAULT_HOUSEHOLD_ID) await initializeDefaultLedger(db);

  if (options.reset) {
    // Categories, asset categories, and groups stay; only ledger rows are rebuilt.
    // api_batches goes too: the API rows it recorded are gone, so it would only be an orphan.
    // The cascade notices are expected, so keep them out of the deploy log.
    await sql`set client_min_messages = warning`;
    try {
      await sql`truncate table transfers, transactions, api_batches, accounts restart identity cascade`;
    } finally {
      await sql`set client_min_messages = notice`;
    }
  } else {
    const [existing] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from accounts
      where household_id = ${householdId} and deleted_at is null
    `;
    if (existing && existing.count > 0) {
      return { status: 'skipped', accounts: existing.count };
    }
  }

  const assetCategories = await sql<{ id: number; system_key: string }[]>`
    select id, system_key from asset_categories where household_id = ${householdId}
  `;
  const groups = await sql<{ id: number; name: string }[]>`
    select id, name from account_groups where household_id = ${householdId}
  `;
  const categories = await sql<{ id: number; name: string; type: string }[]>`
    select id, name, type from categories where household_id = ${householdId}
  `;

  const assetCategoryId = (systemKey: string): number => {
    const row = assetCategories.find((category) => category.system_key === systemKey);
    if (!row) throw new Error(`missing asset category: ${systemKey}`);
    return row.id;
  };
  const groupId = (name: string): number => {
    const row = groups.find((group) => group.name === name);
    if (!row) throw new Error(`missing account group: ${name}`);
    return row.id;
  };
  const categoryId = (type: string, name: string): number => {
    const row = categories.find((category) => category.type === type && category.name === name);
    if (!row) throw new Error(`missing category: ${type}/${name}`);
    return row.id;
  };

  const accountRows: DemoRow[] = [
    {
      household_id: householdId,
      name: '給与口座',
      kind: 'bank',
      asset_category_id: assetCategoryId('bank'),
      group_id: groupId('銀行'),
      sort_order: 10,
    },
    {
      household_id: householdId,
      name: '生活費口座',
      kind: 'bank',
      asset_category_id: assetCategoryId('bank'),
      group_id: groupId('銀行'),
      sort_order: 20,
    },
    {
      household_id: householdId,
      name: '現金',
      kind: 'cash',
      asset_category_id: assetCategoryId('cash'),
      group_id: groupId('現金'),
      sort_order: 10,
    },
    {
      household_id: householdId,
      name: 'クレジットカード',
      kind: 'credit_card',
      asset_category_id: assetCategoryId('credit_card'),
      group_id: groupId('クレジットカード'),
      sort_order: 10,
    },
  ];
  await sql`
    insert into accounts ${sql(
      accountRows,
      'household_id',
      'name',
      'kind',
      'asset_category_id',
      'group_id',
      'sort_order',
    )}
  `;

  const accountIds = await sql<{ id: number; name: string }[]>`
    select id, name from accounts where household_id = ${householdId} and deleted_at is null
  `;
  const accountId = (name: string): number => {
    const row = accountIds.find((account) => account.name === name);
    if (!row) throw new Error(`missing account: ${name}`);
    return row.id;
  };

  const salaryAccount = accountId('給与口座');
  const livingAccount = accountId('生活費口座');
  const cashAccount = accountId('現金');
  const cardAccount = accountId('クレジットカード');

  const fixedCostStartMonth = (() => {
    const current = recentMonths(1)[0] ?? {
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
    };
    return tokyoDate(current.year, current.month, 1);
  })();
  const fixedCostRows: DemoRow[] = (
    [
      ['家賃', 85000, '住居', livingAccount, 1, 'month', 27],
      ['水道', 3240, '水道・光熱', livingAccount, 2, 'month', 25],
      ['インターネット回線', 7800, '通信', cardAccount, 1, 'month', 5],
      ['スマートフォン', 3278, '通信', cardAccount, 1, 'month', 10],
      ['医療保険', 12000, '医療', livingAccount, 3, 'month', 10],
      ['Netflix', 1490, '娯楽', cardAccount, 1, 'month', 8],
      ['Spotify Premium', 1080, '娯楽', cardAccount, 1, 'month', 8],
      ['ジム', 7700, '娯楽', livingAccount, 1, 'month', 15],
      ['Amazon Prime', 5900, '娯楽', cardAccount, 1, 'year', 15],
    ] as const
  ).map(([name, amount, category, account, intervalCount, intervalUnit, day]) => ({
    household_id: householdId,
    name,
    amount,
    category_id: categoryId('expense', String(category)),
    category_type: 'expense',
    account_id: account,
    interval_count: intervalCount,
    interval_unit: intervalUnit,
    start_month: fixedCostStartMonth,
    day,
  }));
  await sql`insert into fixed_costs ${sql(fixedCostRows, 'household_id', 'name', 'amount', 'category_id', 'category_type', 'account_id', 'interval_count', 'interval_unit', 'start_month', 'day')}`;

  const apiMemos: Record<string, true> = {
    'スーパー・外食': true,
    '書籍・サブスクリプション': true,
    メルカリ売上: true,
  };
  const months = recentMonths(3);
  const transactions: DemoRow[] = [];
  for (const [index, { year, month }] of months.entries()) {
    const day = (value: number): string => tokyoDate(year, month, value);
    const monthRows: DemoRow[] = [
      {
        household_id: householdId,
        type: 'income',
        amount: 320000,
        occurred_on: day(25),
        category_id: categoryId('income', '給与'),
        account_id: salaryAccount,
        memo: '給与',
      },
      {
        household_id: householdId,
        type: 'income',
        amount: 8000,
        occurred_on: day(18),
        category_id: categoryId('income', '臨時収入'),
        account_id: salaryAccount,
        memo: 'メルカリ売上',
      },
      {
        household_id: householdId,
        type: 'expense',
        amount: 85000,
        occurred_on: day(27),
        category_id: categoryId('expense', '住居'),
        account_id: livingAccount,
        memo: '家賃',
      },
      {
        household_id: householdId,
        type: 'expense',
        amount: 12000,
        occurred_on: day(8),
        category_id: categoryId('expense', '水道・光熱'),
        account_id: livingAccount,
        memo: '電気・ガス',
      },
      {
        household_id: householdId,
        type: 'expense',
        amount: 7800,
        occurred_on: day(5),
        category_id: categoryId('expense', '通信'),
        account_id: cardAccount,
        memo: 'インターネット回線',
      },
      {
        household_id: householdId,
        type: 'expense',
        amount: 42000,
        occurred_on: day(4),
        category_id: categoryId('expense', '食費'),
        account_id: cardAccount,
        memo: 'スーパー・外食',
      },
      {
        household_id: householdId,
        type: 'expense',
        amount: 16000,
        occurred_on: day(12),
        category_id: categoryId('expense', '日用品'),
        account_id: cashAccount,
        memo: 'ドラッグストア',
      },
      {
        household_id: householdId,
        type: 'expense',
        amount: 9500,
        occurred_on: day(15),
        category_id: categoryId('expense', '交通'),
        account_id: cashAccount,
        memo: '定期券',
      },
      {
        household_id: householdId,
        type: 'expense',
        amount: 14500,
        occurred_on: day(21),
        category_id: categoryId('expense', '娯楽'),
        account_id: cardAccount,
        memo: '書籍・サブスクリプション',
      },
    ];
    transactions.push(
      ...(index === 0 ? monthRows.filter((row) => !apiMemos[String(row.memo)]) : monthRows),
    );
  }
  await sql`
    insert into transactions ${sql(
      transactions,
      'household_id',
      'type',
      'amount',
      'occurred_on',
      'category_id',
      'account_id',
      'memo',
    )}
  `;

  const oldest = months.at(-1) ?? {
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
  };
  await sql`
    insert into transfers ${sql(
      [
        {
          household_id: householdId,
          from_account_id: salaryAccount,
          to_account_id: livingAccount,
          amount: 150000,
          occurred_on: tokyoDate(oldest.year, oldest.month, 26),
          memo: '生活費へ振替',
        },
      ],
      'household_id',
      'from_account_id',
      'to_account_id',
      'amount',
      'occurred_on',
      'memo',
    )}
  `;

  // The same path as POST /api/v1/transactions: names are resolved by the server, rows carry
  // origin 'api', an api_batches row is recorded, and the income row gets a server fingerprint.
  const newest = months[0] ?? oldest;
  const newestDay = (value: number): string => tokyoDate(newest.year, newest.month, value);
  const apiTransactions: ApiTransactionRow[] = [
    {
      type: 'expense',
      amount: 42000,
      occurredOn: newestDay(4),
      category: '食費',
      account: 'クレジットカード',
      memo: 'スーパー・外食',
      externalId: 'demo-card-groceries',
    },
    {
      type: 'expense',
      amount: 14500,
      occurredOn: newestDay(21),
      category: '娯楽',
      account: 'クレジットカード',
      memo: '書籍・サブスクリプション',
      externalId: 'demo-card-subscriptions',
    },
    {
      type: 'income',
      amount: 8000,
      occurredOn: newestDay(18),
      category: '臨時収入',
      account: '給与口座',
      memo: 'メルカリ売上',
    },
  ];
  const apiTransfers: ApiTransferRow[] = [
    {
      amount: 20000,
      occurredOn: newestDay(10),
      from: '給与口座',
      to: '現金',
      memo: 'ATMで引き出し',
      externalId: 'demo-atm-withdrawal',
    },
  ];
  const ingested = await ingestApiBatch(client.db, householdId, {
    label: 'カード明細の取り込み（デモ）',
    idempotencyKey: 'demo-seed-card-statement',
    transactions: apiTransactions,
    transfers: apiTransfers,
  });
  if (
    ingested.status !== 'ok' ||
    ingested.created !== apiTransactions.length + apiTransfers.length
  ) {
    throw new Error(`demo API ingest failed: ${JSON.stringify(ingested.rows)}`);
  }

  return {
    status: 'seeded',
    accounts: accountRows.length,
    transactions: transactions.length + apiTransactions.length,
    transfers: 1 + apiTransfers.length,
    apiTransactions: apiTransactions.length,
    apiTransfers: apiTransfers.length,
  };
}

/**
 * Create one isolated demo household with the standard demo ledger.
 * Used by `/demo/start` so every visitor gets a ledger of their own.
 */
export async function createDemoHousehold(client: DatabaseClient): Promise<string> {
  const id = crypto.randomUUID();
  await initializeDefaultLedger(client.db, { id, slug: `demo-${id.slice(0, 8)}`, name: 'デモ' });
  await seedDemoLedger(client, { householdId: id });
  return id;
}

/** True when the household still exists; evicted demo households return false. */
export async function demoHouseholdExists(
  client: DatabaseClient,
  householdId: string,
): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(householdId)) return false;
  return (await getHousehold(client.db, householdId)) !== null;
}

/**
 * Delete demo households. `olderThanHours` removes only expired ones, `keep` protects the
 * newest rows, and no option at all wipes every demo household.
 */
export async function purgeDemoHouseholds(
  client: DatabaseClient,
  options: { olderThanHours?: number; keep?: number } = {},
): Promise<number> {
  const { sql } = client;
  const { olderThanHours, keep = 0 } = options;
  const rows =
    olderThanHours === undefined
      ? await sql<{ id: string }[]>`
          select id from households
          where id <> ${DEFAULT_HOUSEHOLD_ID}
          order by created_at desc, id desc
          offset ${keep}
        `
      : await sql<{ id: string }[]>`
          select id from households
          where id <> ${DEFAULT_HOUSEHOLD_ID}
            and created_at < now() - make_interval(hours => ${olderThanHours})
          order by created_at desc, id desc
          offset ${keep}
        `;

  let deleted = 0;
  for (const row of rows) {
    const result = await deleteHousehold(client.db, row.id);
    if (result.status === 'ok') deleted += 1;
  }
  return deleted;
}

/**
 * Provision a demo household for one visitor while keeping the deployment bounded:
 * expired households go first, and a full deployment evicts its oldest household.
 */
export async function provisionDemoHousehold(
  client: DatabaseClient,
  options: { limit?: number; ttlHours?: number } = {},
): Promise<string> {
  const { limit = 200, ttlHours = 24 } = options;
  const { sql } = client;

  await purgeDemoHouseholds(client, { olderThanHours: ttlHours });

  const [counted] = await sql<{ count: number }[]>`
    select count(*)::int as count from households where id <> ${DEFAULT_HOUSEHOLD_ID}
  `;
  if ((counted?.count ?? 0) >= limit) {
    const [oldest] = await sql<{ id: string }[]>`
      select id from households
      where id <> ${DEFAULT_HOUSEHOLD_ID}
      order by created_at asc, id asc
      limit 1
    `;
    if (oldest) await deleteHousehold(client.db, oldest.id);
  }

  return createDemoHousehold(client);
}
