import { expect, test } from '@playwright/test';
import {
  assertSafeTestDatabaseTarget,
  createDatabaseClient,
  DEFAULT_HOUSEHOLD_ID,
  verifySafeTestDatabaseConnection,
  type DatabaseClient,
} from '@kobako/db';
import { seedDemoLedger } from '../src/lib/demo-ledger';

let databaseClient: DatabaseClient | undefined;

async function ensureRepresentativeFixedCosts(): Promise<void> {
  if (!databaseClient) throw new Error('fixed-cost E2E database is not initialized');
  const { sql } = databaseClient;
  const householdId = DEFAULT_HOUSEHOLD_ID;
  const accountSeeds = [
    ['給与口座', 'bank', 'bank', '銀行', 10],
    ['生活費口座', 'bank', 'bank', '銀行', 20],
    ['現金', 'cash', 'cash', '現金', 10],
    ['クレジットカード', 'credit_card', 'credit_card', 'クレジットカード', 10],
  ] as const;
  const accounts = await sql<{ id: number; name: string }[]>`
    select id, name from accounts where household_id = ${householdId} and deleted_at is null
  `;
  for (const [name, kind, assetKey, groupName, sortOrder] of accountSeeds) {
    if (accounts.some((account) => account.name === name)) continue;
    const [asset] = await sql<{ id: number }[]>`
      select id from asset_categories
      where household_id = ${householdId} and system_key = ${assetKey}
      limit 1
    `;
    const [group] = await sql<{ id: number }[]>`
      select id from account_groups
      where household_id = ${householdId} and name = ${groupName}
      limit 1
    `;
    if (!asset || !group) throw new Error(`missing demo account reference: ${name}`);
    const [created] = await sql<{ id: number; name: string }[]>`
      insert into accounts (household_id, name, kind, asset_category_id, group_id, sort_order)
      values (${householdId}, ${name}, ${kind}, ${asset.id}, ${group.id}, ${sortOrder})
      returning id, name
    `;
    if (created) accounts.push(created);
  }
  const categories = await sql<{ id: number; name: string }[]>`
    select id, name from categories
    where household_id = ${householdId} and type = 'expense'
  `;
  const accountId = (name: string): number => {
    const row = accounts.find((account) => account.name === name);
    if (!row) throw new Error(`missing demo account: ${name}`);
    return row.id;
  };
  const categoryId = (name: string): number => {
    const row = categories.find((category) => category.name === name);
    if (!row) throw new Error(`missing demo category: ${name}`);
    return row.id;
  };
  const tokyo = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const startMonth = `${tokyo.toISOString().slice(0, 7)}-01`;
  const fixedCosts = [
    ['家賃', 85000, '住居', '生活費口座', 1, 'month', 27],
    ['水道', 3240, '水道・光熱', '生活費口座', 2, 'month', 25],
    ['インターネット回線', 7800, '通信', 'クレジットカード', 1, 'month', 5],
    ['スマートフォン', 3278, '通信', 'クレジットカード', 1, 'month', 10],
    ['医療保険', 12000, '医療', '生活費口座', 3, 'month', 10],
    ['Netflix', 1490, '娯楽', 'クレジットカード', 1, 'month', 8],
    ['Spotify Premium', 1080, '娯楽', 'クレジットカード', 1, 'month', 8],
    ['ジム', 7700, '娯楽', '生活費口座', 1, 'month', 15],
    ['Amazon Prime', 5900, '娯楽', 'クレジットカード', 1, 'year', 15],
  ] as const;
  const existing = await sql<{ name: string }[]>`
    select name from fixed_costs where household_id = ${householdId}
  `;
  for (const [name, amount, category, account, intervalCount, intervalUnit, day] of fixedCosts) {
    if (existing.some((row) => row.name === name)) continue;
    await sql`
      insert into fixed_costs
        (household_id, name, amount, category_id, category_type, account_id,
         interval_count, interval_unit, start_month, day)
      values
        (${householdId}, ${name}, ${amount}, ${categoryId(category)}, 'expense',
         ${accountId(account)}, ${intervalCount}, ${intervalUnit}, ${startMonth}, ${day})
    `;
  }
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const safeTestDatabase = assertSafeTestDatabaseTarget();
  databaseClient = createDatabaseClient(safeTestDatabase.url);
  await verifySafeTestDatabaseConnection(
    databaseClient.sql,
    safeTestDatabase.target,
    process.env.DATABASE_URL,
  );
  // Chromium and mobile projects share the CI database; serialize the fixture seed so
  // both projects observe the complete representative fixed-cost set.
  await databaseClient.sql`select pg_advisory_lock(hashtext('kobako-fixed-cost-e2e-seed'))`;
  try {
    await seedDemoLedger(databaseClient);
    await ensureRepresentativeFixedCosts();
  } finally {
    await databaseClient.sql`select pg_advisory_unlock(hashtext('kobako-fixed-cost-e2e-seed'))`;
  }
});

test.afterAll(async () => {
  await databaseClient?.close();
  databaseClient = undefined;
});

test.describe('固定費', () => {
  test('一覧から登録・編集を開くとdialog、直接URLはページを表示する', async ({ page }) => {
    await page.goto('/fixed-costs');
    await page.getByRole('link', { name: '固定費を登録' }).click();
    await expect(page.locator('#entry-dialog[data-card-pattern="overlay-card"]')).toBeVisible();
    await page.getByRole('button', { name: '固定費を登録 — 戻る' }).click();
    await expect(page.locator('#entry-dialog')).toHaveCount(0);
    await page.getByRole('link', { name: /家賃/ }).click();
    await expect(page.locator('#entry-dialog[data-card-pattern="overlay-card"]')).toBeVisible();
    await page.getByRole('button', { name: '固定費を編集 — 戻る' }).click();
    await page.goto('/fixed-costs/new');
    await expect(page.locator('#entry-dialog')).toHaveCount(0);
  });

  test('一覧に代表的な固定費と集計を表示する', async ({ page }) => {
    await page.goto('/fixed-costs');
    await expect(page.getByRole('heading', { name: /^固定費\s*\d+件$/ })).toBeVisible();
    await expect(page.getByText('月あたり')).toBeVisible();
    await expect(page.getByText('112,460円')).toBeVisible();
    await expect(page.getByText('年間')).toBeVisible();
    await expect(page.getByText('1,349,516円')).toBeVisible();
    await expect(page.getByText('家賃')).toBeVisible();
    await expect(page.getByText('Amazon Prime')).toBeVisible();
  });

  test('登録・編集・削除、絞り込み、グルーピングを保持する', async ({ page }) => {
    await page.goto('/fixed-costs');
    await page.getByRole('link', { name: '固定費を登録' }).click();
    await page.getByLabel('名称').fill('E2E固定費');
    await page.getByLabel('金額').fill('1234');
    await page.getByLabel('カテゴリ').selectOption({ label: '娯楽' });
    await page.getByLabel('資産').selectOption({ label: '生活費口座' });
    await page.getByLabel('日付').selectOption('20');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page).toHaveURL(/\/fixed-costs$/);
    await expect(page.getByRole('link', { name: /E2E固定費/ }).first()).toBeVisible();

    await page.getByRole('link', { name: /E2E固定費/ }).click();
    await page.getByLabel('金額').fill('4321');
    await page.getByRole('button', { name: '保存する' }).click();
    await expect(page).toHaveURL(/\/fixed-costs$/);
    await expect(page.getByText('4,321円')).toBeVisible();

    await page.getByRole('button', { name: '頻度', exact: true }).click();
    await page.getByRole('menuitemradio', { name: '1年ごと' }).click();
    await expect(page.getByText('Amazon Prime')).toBeVisible();
    await expect(page.getByText('E2E固定費')).not.toBeVisible();
    await page.getByRole('button', { name: '条件をクリア' }).click();
    await page.getByRole('button', { name: /^グループ/ }).click();
    await page.getByRole('menuitemradio', { name: '頻度別' }).click();
    await expect(page.getByRole('button', { name: /グループ.*頻度別/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('kobako-fixed-cost-group')))
      .toBe('frequency');
    await page.reload();
    await expect(page.getByRole('button', { name: /グループ.*頻度別/ })).toBeVisible();

    await page.getByRole('button', { name: 'カテゴリ', exact: true }).click();
    await page.getByRole('menuitemradio', { name: '娯楽' }).click();
    await expect(page.getByText('Netflix')).toBeVisible();
    await expect(page.getByText('家賃')).not.toBeVisible();
    await page.getByRole('button', { name: /カテゴリ.*娯楽/ }).click();
    await page.getByRole('menuitemradio', { name: 'すべて' }).click();
    await page.getByRole('link', { name: /E2E固定費/ }).click();
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '固定費を削除' }).click();
    await expect(page).toHaveURL(/\/fixed-costs$/);
    await expect(page.getByText('E2E固定費')).not.toBeVisible();
  });

  test('入力エラーを表示する', async ({ page }) => {
    await page.goto('/fixed-costs/new');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: '入力内容を確認してください。' }),
    ).toBeVisible();
  });

  test('モバイル幅で横 overflow を発生させない', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/fixed-costs');
    await expect(page.getByRole('heading', { name: /^固定費\s*\d+件$/ })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
