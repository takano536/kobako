import { expect, test } from '@playwright/test';
import {
  assertSafeTestDatabaseTarget,
  createDatabaseClient,
  DEFAULT_HOUSEHOLD_ID,
  verifySafeTestDatabaseConnection,
  type DatabaseClient,
} from '@kobako/db';
import { seedDemoLedger } from '../src/lib/demo-ledger';

declare global {
  interface Window {
    __fixedCostSkeletonObservation?: {
      state: {
        clickAt: number;
        appearedAt: number | null;
        removedAt: number | null;
      };
      observer: MutationObserver;
    };
  }
}

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
  test('ナビの固定費遷移は100ms以内にスケルトンを表示して一覧へ置き換える', async ({ page }) => {
    await page.goto('/transactions');
    await page.evaluate(() => {
      const state: {
        clickAt: number;
        appearedAt: number | null;
        removedAt: number | null;
      } = {
        clickAt: performance.now(),
        appearedAt: null,
        removedAt: null,
      };
      const selector = '[data-slot="page-skeleton"]';
      const record = () => {
        const present = document.querySelector(selector) !== null;
        if (present && state.appearedAt === null) state.appearedAt = performance.now();
        if (!present && state.appearedAt !== null && state.removedAt === null) {
          state.removedAt = performance.now();
        }
      };
      const observer = new MutationObserver(record);
      observer.observe(document.body, { childList: true, subtree: true });
      document.addEventListener(
        'pointerdown',
        (event) => {
          const target = event.target;
          if (target instanceof Element && target.closest('a[href="/fixed-costs"]')) {
            state.clickAt = performance.now();
          }
        },
        true,
      );
      window.__fixedCostSkeletonObservation = { state, observer };
    });
    let delayedNavigation = false;
    await page.route('**/fixed-costs*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const isRscNavigation = request.headers().rsc !== undefined || url.searchParams.has('_rsc');
      const isPrefetch = request.headers()['next-router-prefetch'] === '1';
      if (!isRscNavigation || isPrefetch || delayedNavigation) {
        await route.continue();
        return;
      }
      delayedNavigation = true;
      await page.waitForTimeout(400);
      await route.continue();
    });

    try {
      await page.getByRole('link', { name: '固定費' }).click();
      const skeleton = page.locator('[data-slot="page-skeleton"]');
      await expect(skeleton).toContainText('固定費の集計');
      await expect(skeleton).not.toContainText('種別');
      await expect(skeleton).not.toContainText('APIのみ');
      await expect
        .poll(() => page.evaluate(() => window.__fixedCostSkeletonObservation?.state.removedAt))
        .not.toBeNull();
      const observation = await page.evaluate(() => {
        const state = window.__fixedCostSkeletonObservation?.state;
        return state
          ? {
              appearedAfterClickMs:
                state.appearedAt === null ? null : state.appearedAt - state.clickAt,
              heldMs:
                state.appearedAt === null || state.removedAt === null
                  ? null
                  : state.removedAt - state.appearedAt,
            }
          : null;
      });
      expect(observation?.appearedAfterClickMs).not.toBeNull();
      expect(observation?.appearedAfterClickMs).toBeLessThanOrEqual(100);
      expect(observation?.heldMs).not.toBeNull();
      await expect(skeleton).toHaveCount(0);
    } finally {
      await page.unroute('**/fixed-costs*');
    }
  });
  test('一覧から登録・編集を開くとdialog、直接URLはページを表示する', async ({ page }) => {
    await page.goto('/fixed-costs');
    await page.getByRole('link', { name: '固定費を登録' }).click();
    await expect(page.locator('#entry-dialog[data-card-pattern="overlay-card"]')).toBeVisible();
    await expect(
      page.locator('#entry-dialog').getByRole('button', { name: 'キャンセル', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: '固定費を登録 — 戻る' }).click();
    await expect(page.locator('#entry-dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/fixed-costs$/);
    await page.getByRole('link', { name: /家賃/ }).click();
    await expect(page.locator('#entry-dialog[data-card-pattern="overlay-card"]')).toBeVisible();
    await expect(
      page.locator('#entry-dialog').getByRole('button', { name: 'キャンセル', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: '固定費を編集 — 戻る' }).click();
    await expect(page.locator('#entry-dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/fixed-costs$/);
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

  test('固定費の素のselectを共通メニューへ自動変換する', async ({ page }) => {
    await page.goto('/fixed-costs/new');
    const native = page.locator('select#fixed-cost-category');
    await expect(native).toHaveAttribute('data-kobako-select-enhanced', '');
    await expect(native).toHaveAttribute('aria-hidden', 'true');
    const trigger = page.locator('button#fixed-cost-category');
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await expect(trigger).toHaveAttribute('aria-controls', /-menu$/);
    await trigger.click();
    await expect(page.getByRole('menuitemradio', { name: '娯楽' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('#fixed-cost-frequency').selectOption('custom');
    await expect(page.locator('button#fixed-cost-frequency')).toHaveText('間隔を指定');
  });
  test('間隔指定の行と固定費用集計のスタイルを揃える', async ({ page }) => {
    await page.goto('/fixed-costs/new');
    await page.locator('#fixed-cost-frequency').selectOption('custom');

    const intervalCount = page.getByLabel('間隔', { exact: true });
    const intervalLine = intervalCount.locator('xpath=..');
    const nameValue = page.getByLabel('名称').locator('xpath=..');
    const intervalBox = await intervalLine.boundingBox();
    const nameValueBox = await nameValue.boundingBox();
    if (!intervalBox || !nameValueBox) throw new Error('interval row is not measurable');
    expect(Math.abs(intervalBox.x - nameValueBox.x)).toBeLessThanOrEqual(1);

    const spinStyles = await intervalCount.evaluate((element) => {
      const input = element as HTMLInputElement;
      const spinRules = [...document.styleSheets].flatMap((sheet) => {
        try {
          return [...sheet.cssRules]
            .map((rule) => rule.cssText)
            .filter((text) => text.includes('::-webkit-') && text.includes('spin-button'));
        } catch {
          return [];
        }
      });
      return {
        appearance: getComputedStyle(input).appearance,
        outerSpin: getComputedStyle(input, '::-webkit-outer-spin-button').display,
        innerSpin: getComputedStyle(input, '::-webkit-inner-spin-button').display,
        spinRules,
      };
    });
    expect(spinStyles.appearance).toBe('textfield');
    expect(spinStyles.spinRules.some((rule) => rule.includes('display: none'))).toBe(true);

    const selectStyles = await page.locator('form select').evaluateAll((selects) =>
      selects.map((select) => {
        const wrapper = select.parentElement;
        const pseudo = wrapper ? getComputedStyle(wrapper, '::after') : null;
        return {
          appearance: getComputedStyle(select).appearance,
          wrapper: wrapper?.className ?? '',
          pseudoContent: pseudo?.content ?? 'none',
          pseudoBorderColor: pseudo?.borderInlineEndColor ?? '',
          pseudoWidth: pseudo?.width ?? '',
          pseudoHeight: pseudo?.height ?? '',
          strokeToken: wrapper
            ? getComputedStyle(wrapper).getPropertyValue('--stroke-medium').trim()
            : '',
        };
      }),
    );
    expect(selectStyles.length).toBe(6);
    for (const select of selectStyles) {
      expect(select.appearance).toBe('none');
      expect(select.wrapper).toContain('selectChevronWrap');
      expect(select.pseudoContent).not.toBe('none');
      expect(select.pseudoBorderColor).not.toBe('');
      expect(select.pseudoWidth).toBe('7px');
      expect(select.pseudoHeight).toBe('7px');
      expect(select.strokeToken).toBe('1.5px');
    }

    await page.goto('/fixed-costs');
    const summaryValues = page.locator('dl dd');
    await expect(summaryValues).toHaveCount(2);
    const summaryStyles = await summaryValues.evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        return {
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          x: element.getBoundingClientRect().x,
        };
      }),
    );
    expect(
      summaryStyles.every(
        ({ fontSize, fontWeight }) => fontSize === '15px' && fontWeight === '600',
      ),
    ).toBe(true);
    expect(summaryStyles[1]!.x).toBeGreaterThan(summaryStyles[0]!.x);
  });

  test('登録・編集・削除、絞り込み、グルーピングを保持する', async ({ page }, testInfo) => {
    await page.goto('/fixed-costs');
    const e2eFixedCostName = `E2E固定費-${testInfo.project.name}-${Date.now()}`;
    const e2eFixedCostLink = () =>
      page.getByRole('link', { name: new RegExp(e2eFixedCostName) }).first();
    await page.getByRole('link', { name: '固定費を登録' }).click();
    await page.getByLabel('名称').fill(e2eFixedCostName);
    await page.getByLabel('金額').fill('1234');
    await page.locator('#fixed-cost-category').selectOption({ label: '娯楽' });
    await page.locator('#fixed-cost-account').selectOption({ label: '生活費口座' });
    await page.locator('#fixed-cost-day').selectOption('20');
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page).toHaveURL(/\/fixed-costs$/);
    await expect(e2eFixedCostLink()).toBeVisible();

    await e2eFixedCostLink().click();
    await page.getByLabel('金額').fill('4321');
    await page.getByRole('button', { name: '保存する' }).click();
    await expect(page).toHaveURL(/\/fixed-costs$/);
    await expect(e2eFixedCostLink()).toContainText('4,321円');

    await page.getByRole('button', { name: '頻度', exact: true }).click();
    await page.getByRole('menuitemradio', { name: '1年ごと' }).click();
    await expect(page.getByText('Amazon Prime')).toBeVisible();
    await expect(page.getByText(e2eFixedCostName)).not.toBeVisible();
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
    await e2eFixedCostLink().click();
    await page.locator('[data-slot="delete-confirm"] > summary').click();
    await page.getByRole('button', { name: '削除を確定' }).click();
    await expect(page).toHaveURL(/\/fixed-costs$/);
    await expect(page.getByText(e2eFixedCostName)).not.toBeVisible();
  });

  test('編集カードの削除と保存は同じ行にあり、金額の値列は他行に揃う', async ({ page }) => {
    await page.goto('/fixed-costs');
    await page.getByRole('link', { name: /家賃/ }).click();
    const dialog = page.locator('#entry-dialog');
    const deleteSummary = dialog.locator('[data-slot="delete-confirm"] > summary');
    const save = dialog.getByRole('button', { name: '保存する' });
    await expect(deleteSummary).toBeVisible();
    const deleteBox = await deleteSummary.boundingBox();
    const saveBox = await save.boundingBox();
    if (!deleteBox || !saveBox) throw new Error('action buttons are not measurable');
    expect(Math.abs(deleteBox.y - saveBox.y)).toBeLessThanOrEqual(1);
    expect(deleteBox.x).toBeLessThan(saveBox.x);
    const nameBox = await page.locator('#fixed-cost-name').boundingBox();
    const amountLineBox = await page
      .locator('#fixed-cost-amount')
      .locator('xpath=../..')
      .boundingBox();
    if (!nameBox || !amountLineBox) throw new Error('amount row is not measurable');
    expect(Math.abs(amountLineBox.x - nameBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(amountLineBox.width - nameBox.width)).toBeLessThanOrEqual(1);
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
