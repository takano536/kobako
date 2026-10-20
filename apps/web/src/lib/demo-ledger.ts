import { DEFAULT_HOUSEHOLD_ID, initializeDefaultLedger, type DatabaseClient } from '@kobako/db';

export type DemoSeedResult =
  | { status: 'skipped'; accounts: number }
  | { status: 'seeded'; accounts: number; transactions: number; transfers: number };

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
 * transactions, and one transfer. `reset` truncates the ledger first so a preview always
 * starts from the same state, while the default run is a no-op once accounts exist.
 */
export async function seedDemoLedger(
  client: DatabaseClient,
  options: { reset?: boolean } = {},
): Promise<DemoSeedResult> {
  const { db, sql } = client;

  await initializeDefaultLedger(db);

  if (options.reset) {
    // Categories, asset categories, and groups stay; only ledger rows are rebuilt.
    // The cascade notices are expected, so keep them out of the deploy log.
    await sql`set client_min_messages = warning`;
    try {
      await sql`truncate table transfers, transactions, accounts restart identity cascade`;
    } finally {
      await sql`set client_min_messages = notice`;
    }
  } else {
    const [existing] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from accounts
      where household_id = ${DEFAULT_HOUSEHOLD_ID} and deleted_at is null
    `;
    if (existing && existing.count > 0) {
      return { status: 'skipped', accounts: existing.count };
    }
  }

  const assetCategories = await sql<{ id: number; system_key: string }[]>`
    select id, system_key from asset_categories where household_id = ${DEFAULT_HOUSEHOLD_ID}
  `;
  const groups = await sql<{ id: number; name: string }[]>`
    select id, name from account_groups where household_id = ${DEFAULT_HOUSEHOLD_ID}
  `;
  const categories = await sql<{ id: number; name: string; type: string }[]>`
    select id, name, type from categories where household_id = ${DEFAULT_HOUSEHOLD_ID}
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
      household_id: DEFAULT_HOUSEHOLD_ID,
      name: '給与口座',
      kind: 'bank',
      asset_category_id: assetCategoryId('bank'),
      group_id: groupId('銀行'),
      sort_order: 10,
    },
    {
      household_id: DEFAULT_HOUSEHOLD_ID,
      name: '生活費口座',
      kind: 'bank',
      asset_category_id: assetCategoryId('bank'),
      group_id: groupId('銀行'),
      sort_order: 20,
    },
    {
      household_id: DEFAULT_HOUSEHOLD_ID,
      name: '現金',
      kind: 'cash',
      asset_category_id: assetCategoryId('cash'),
      group_id: groupId('現金'),
      sort_order: 10,
    },
    {
      household_id: DEFAULT_HOUSEHOLD_ID,
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
    select id, name from accounts where household_id = ${DEFAULT_HOUSEHOLD_ID} and deleted_at is null
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

  const transactions: DemoRow[] = [];
  for (const { year, month } of recentMonths(3)) {
    const day = (value: number): string => tokyoDate(year, month, value);
    transactions.push(
      {
        household_id: DEFAULT_HOUSEHOLD_ID,
        type: 'income',
        amount: 320000,
        occurred_on: day(25),
        category_id: categoryId('income', '給与'),
        account_id: salaryAccount,
        memo: '給与',
      },
      {
        household_id: DEFAULT_HOUSEHOLD_ID,
        type: 'income',
        amount: 8000,
        occurred_on: day(18),
        category_id: categoryId('income', '臨時収入'),
        account_id: salaryAccount,
        memo: 'メルカリ売上',
      },
      {
        household_id: DEFAULT_HOUSEHOLD_ID,
        type: 'expense',
        amount: 85000,
        occurred_on: day(27),
        category_id: categoryId('expense', '住居'),
        account_id: livingAccount,
        memo: '家賃',
      },
      {
        household_id: DEFAULT_HOUSEHOLD_ID,
        type: 'expense',
        amount: 12000,
        occurred_on: day(8),
        category_id: categoryId('expense', '水道・光熱'),
        account_id: livingAccount,
        memo: '電気・ガス',
      },
      {
        household_id: DEFAULT_HOUSEHOLD_ID,
        type: 'expense',
        amount: 7800,
        occurred_on: day(5),
        category_id: categoryId('expense', '通信'),
        account_id: cardAccount,
        memo: 'インターネット回線',
      },
      {
        household_id: DEFAULT_HOUSEHOLD_ID,
        type: 'expense',
        amount: 42000,
        occurred_on: day(4),
        category_id: categoryId('expense', '食費'),
        account_id: cardAccount,
        memo: 'スーパー・外食',
      },
      {
        household_id: DEFAULT_HOUSEHOLD_ID,
        type: 'expense',
        amount: 16000,
        occurred_on: day(12),
        category_id: categoryId('expense', '日用品'),
        account_id: cashAccount,
        memo: 'ドラッグストア',
      },
      {
        household_id: DEFAULT_HOUSEHOLD_ID,
        type: 'expense',
        amount: 9500,
        occurred_on: day(15),
        category_id: categoryId('expense', '交通'),
        account_id: cashAccount,
        memo: '定期券',
      },
      {
        household_id: DEFAULT_HOUSEHOLD_ID,
        type: 'expense',
        amount: 14500,
        occurred_on: day(21),
        category_id: categoryId('expense', '娯楽'),
        account_id: cardAccount,
        memo: '書籍・サブスクリプション',
      },
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

  const oldest = recentMonths(3).at(-1) ?? {
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
  };
  await sql`
    insert into transfers ${sql(
      [
        {
          household_id: DEFAULT_HOUSEHOLD_ID,
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

  return {
    status: 'seeded',
    accounts: accountRows.length,
    transactions: transactions.length,
    transfers: 1,
  };
}
