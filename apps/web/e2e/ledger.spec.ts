import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import {
  DEFAULT_HOUSEHOLD_ID,
  assertSafeTestDatabaseTarget,
  createDatabaseClient,
  initializeDefaultLedger,
  verifySafeTestDatabaseConnection,
  type DatabaseClient,
} from '@kobako/db';
import {
  E2E_MARKER_PREFIX,
  SENTINEL_CLEANUP_END_YEAR,
  SENTINEL_MIN_YEAR,
  assertCleanupMarker,
  assertEmptyMonth as assertEmptyMonthInDatabase,
  chooseEmptyMonthPair,
  labelForMonth,
  markerFor as markerForPrefix,
} from './e2e-safety';
import {
  assertDeleteAndSaveAligned,
  assertDeleteModalGeometry,
  assertDeleteModalInteraction,
  type ModalViewport,
} from './delete-modal-helpers';

const runId = randomUUID();
const runMarkerPrefix = `${E2E_MARKER_PREFIX}${runId}:`;

let databaseClient: DatabaseClient | undefined;
let month = '';
let nextMonth = '';
let nextMonthLabel = '';

function markerFor(testName: string): string {
  return markerForPrefix(runMarkerPrefix, testName);
}
async function assertEmptyMonth(value: string): Promise<void> {
  if (!databaseClient) {
    throw new Error(`E2E sentinel month ${value} cannot be checked without a database`);
  }
  await assertEmptyMonthInDatabase(databaseClient, value);
}

async function deleteRunTransactions(client: DatabaseClient): Promise<void> {
  assertCleanupMarker(runMarkerPrefix);
  await client.sql`
    delete from transactions
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and occurred_on >= ${`${SENTINEL_MIN_YEAR}-01-01`}
      and occurred_on < ${`${SENTINEL_CLEANUP_END_YEAR}-01-01`}
      and memo like ${`${runMarkerPrefix}%`}
  `;
}

test.beforeAll(async () => {
  const safeTestDatabase = assertSafeTestDatabaseTarget();
  databaseClient = createDatabaseClient(safeTestDatabase.url);
  try {
    await verifySafeTestDatabaseConnection(
      databaseClient.sql,
      safeTestDatabase.target,
      process.env.DATABASE_URL,
    );
    await initializeDefaultLedger(databaseClient.db);
    [month, nextMonth] = await chooseEmptyMonthPair(databaseClient, runId);
    nextMonthLabel = labelForMonth(nextMonth);
  } catch (error) {
    await databaseClient.close();
    databaseClient = undefined;
    throw error;
  }
});

test.afterAll(async () => {
  if (!databaseClient) {
    return;
  }
  try {
    const safeTestDatabase = assertSafeTestDatabaseTarget();
    await verifySafeTestDatabaseConnection(
      databaseClient.sql,
      safeTestDatabase.target,
      process.env.DATABASE_URL,
    );
    await deleteRunTransactions(databaseClient);
  } finally {
    await databaseClient.close();
    databaseClient = undefined;
  }
});

test.describe.configure({ mode: 'serial' });

test('shows an empty month and reflects an added expense in the list and overview total', async ({
  page,
}) => {
  await assertEmptyMonth(month);
  await page.goto(`/?month=${month}`);
  await expect(page.getByRole('heading', { name: '概要' })).toBeVisible();
  await expect(page.getByText('まだ記録がありません')).toBeVisible();

  await page.locator('.page-header .action-link-primary').click();
  await expect(page.getByRole('heading', { name: '新規登録' })).toBeVisible();
  await page.getByLabel('金額').fill('1,200');
  await page.locator('input[name="occurredOn"]').fill(`${month}-10`);
  await page.locator('.category-field-expense select').selectOption({ label: '食費' });
  await page.getByLabel('メモ（任意）').fill(markerFor('expense'));
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(page.getByRole('link', { name: /支出.*1,200円/ })).toBeVisible();
  await page.goto(`/?month=${month}`);
  await expect(
    page.getByRole('group', { name: 'この月の支出' }).locator('.lead-amount'),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: '収支差額' }).locator('dd')).toHaveText(
    'マイナス−1,200円',
  );
});
test('keeps shared chrome aligned across viewports and wraps long content', async ({ page }) => {
  if (!databaseClient) {
    throw new Error('database client is not initialized');
  }

  const categoryName = `長いカテゴリ名-${runId}-折り返し確認用`;
  const memo = `${markerFor('layout-long')} / ${'長いメモ '.repeat(24)}`;
  const categoryRows = await databaseClient.sql`
    insert into categories (household_id, type, name, sort_order)
    values (${DEFAULT_HOUSEHOLD_ID}, 'expense', ${categoryName}, 98)
    returning id
  `;
  const categoryId = Number(categoryRows[0]?.id);
  if (!Number.isInteger(categoryId)) {
    throw new Error('long layout category fixture was not created');
  }
  const transactionRows = await databaseClient.sql`
    insert into transactions (household_id, type, amount, occurred_on, category_id, memo)
    values (${DEFAULT_HOUSEHOLD_ID}, 'expense', 9876, ${`${month}-17`}, ${categoryId}, ${memo})
    returning id
  `;
  const transactionId = Number(transactionRows[0]?.id);
  if (!Number.isInteger(transactionId)) {
    throw new Error('long layout transaction fixture was not created');
  }

  const measure = async (selector: string) =>
    page.locator(selector).evaluate((element) => {
      const { x, y, width } = element.getBoundingClientRect();
      return { x, y, width };
    });
  const assertNoHorizontalOverflow = async () => {
    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  };
  const assertAligned = (
    overview: { x: number; y: number; width: number },
    transactions: { x: number; y: number; width: number },
  ) => {
    expect(Math.abs(overview.x - transactions.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(overview.y - transactions.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(overview.width - transactions.width)).toBeLessThanOrEqual(1);
  };

  try {
    for (const { width, height } of [
      { width: 320, height: 780 },
      { width: 360, height: 780 },
      { width: 390, height: 844 },
      { width: 414, height: 844 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto(`/?month=${month}`);
      await expect(page.getByRole('heading', { name: '概要' })).toBeVisible();
      const overviewHeading = await measure('.page-header h1');
      const overviewPrimary = await measure('.page-header .action-link-primary');
      const overviewMonth = await measure('.month-switcher');
      const overviewSummary = page.locator('.overview-summary');
      await expect(overviewSummary).toHaveCount(1);
      await expect(overviewSummary.locator('.overview-lead')).toHaveCount(1);
      await expect(overviewSummary.locator('.summary-inline > div')).toHaveCount(2);
      await assertNoHorizontalOverflow();

      await page.goto(`/transactions?month=${month}`);
      await expect(page.getByRole('heading', { name: /取引/ })).toBeVisible();
      const transactionsHeading = await measure('.page-header h1');
      const transactionActionSizes = await page
        .locator('.page-header-actions .action-link')
        .evaluateAll((links) => links.map((link) => getComputedStyle(link).fontSize));
      expect(new Set(transactionActionSizes).size).toBe(1);
      const transactionsPrimary = await measure('.page-header .action-link-primary');
      const transactionsMonth = await measure('.month-switcher');
      for (const [overview, transactions] of [
        [overviewHeading, transactionsHeading],
        [overviewPrimary, transactionsPrimary],
        [overviewMonth, transactionsMonth],
      ] as const) {
        assertAligned(overview, transactions);
      }
      await assertNoHorizontalOverflow();
      await expect(page.locator('.transaction-memo').filter({ hasText: memo })).toBeVisible();

      await page.goto(`/transactions?month=${month}&type=expense&category=${categoryId}`);
      await expect(page.locator('.filter-summary')).toContainText(categoryName);
      await assertNoHorizontalOverflow();
    }
    for (const width of [320, 360, 390, 414, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/transactions?month=${nextMonth}`);
      await expect(page.getByRole('heading', { name: 'この月はまだ空です' })).toBeVisible();
      const emptyDescription = page.locator('.empty-state-description');
      await expect(emptyDescription).toHaveText('最初の取引を記録すると、ここに並びます。');
      const emptyMetrics = await emptyDescription.evaluate((description) => {
        const style = getComputedStyle(description);
        return {
          height: description.getBoundingClientRect().height,
          lineHeight: Number.parseFloat(style.lineHeight),
          phraseDisplays: Array.from(description.querySelectorAll<HTMLElement>('.phrase-wrap')).map(
            (phrase) => getComputedStyle(phrase).display,
          ),
        };
      });
      expect(emptyMetrics.phraseDisplays).toEqual(['inline-block', 'inline-block']);
      expect(emptyMetrics.height).toBeLessThanOrEqual(emptyMetrics.lineHeight * 2 + 1);
      if (width >= 414) {
        expect(emptyMetrics.height).toBeLessThanOrEqual(emptyMetrics.lineHeight + 1);
      }
      const centers = await Promise.all(
        ['.empty-state h2', '.empty-state-description', '.empty-state-action'].map((selector) =>
          page
            .locator(selector)
            .boundingBox()
            .then((box) => {
              if (!box) {
                throw new Error(`empty state geometry unavailable for ${selector}`);
              }
              return box.x + box.width / 2;
            }),
        ),
      );
      expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
      await assertNoHorizontalOverflow();
    }
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`/?month=${month}`);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await assertNoHorizontalOverflow();
    const sectionHeadingMetrics = await page
      .locator('.section-heading h2')
      .first()
      .evaluate((heading) => {
        const styles = getComputedStyle(heading);
        return {
          height: heading.getBoundingClientRect().height,
          lineHeight: Number.parseFloat(styles.lineHeight),
        };
      });
    expect(sectionHeadingMetrics.height).toBeLessThanOrEqual(
      sectionHeadingMetrics.lineHeight * 2 + 1,
    );

    await page.goto('/transactions/import');
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await assertNoHorizontalOverflow();
    const importHeadingBox = await page.locator('.import-heading h1').boundingBox();
    const importActionBox = await page
      .locator('.import-heading .page-header-actions')
      .boundingBox();
    const dropzoneBox = await page.locator('.import-dropzone').boundingBox();
    const dropzoneButtonBox = await page.locator('.import-dropzone-copy strong').boundingBox();
    if (!importHeadingBox || !importActionBox || !dropzoneBox || !dropzoneButtonBox) {
      throw new Error('zoomed import geometry is unavailable');
    }
    expect(importActionBox.y).toBeGreaterThanOrEqual(
      importHeadingBox.y + importHeadingBox.height - 1,
    );
    expect(dropzoneButtonBox.x + dropzoneButtonBox.width).toBeLessThanOrEqual(
      dropzoneBox.x + dropzoneBox.width + 1,
    );
    expect(dropzoneButtonBox.y + dropzoneButtonBox.height).toBeLessThanOrEqual(
      dropzoneBox.y + dropzoneBox.height + 1,
    );
  } finally {
    await databaseClient.sql`delete from transactions where id = ${transactionId}`;
    await databaseClient.sql`delete from categories where id = ${categoryId}`;
  }
});

test('supports keyboard entry and mobile layout for an ordinary transaction', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/transactions/new?month=${month}`);
  const amount = page.getByLabel('金額');
  const category = page.locator('.category-field-expense select');
  const memo = page.getByLabel('メモ（任意）');
  await amount.focus();
  await amount.pressSequentially('321');
  await page.keyboard.press('Tab');
  await expect(category).toBeFocused();
  await category.press('Home');
  await category.press('ArrowDown');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(memo).toBeFocused();
  await memo.pressSequentially(markerFor('keyboard-mobile'));
  const dimensions = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  await page.getByRole('button', { name: '登録する' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  const row = page.locator('.transaction-link').filter({ hasText: markerFor('keyboard-mobile') });
  await expect(row).toHaveCount(1);
  await row.click();
  await page.locator('.delete-confirm > summary').click();
  await page.getByRole('button', { name: '削除を確定' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(
    page.locator('.transaction-link').filter({ hasText: markerFor('keyboard-mobile') }),
  ).toHaveCount(0);
});

test('adds income and updates the difference, then edits and deletes a transaction', async ({
  page,
}) => {
  await page.goto(`/transactions/new?month=${month}`);
  await page.getByText('収入', { exact: true }).click();
  await page.getByLabel('金額').fill('5,000');
  await page.locator('input[name="occurredOn"]').fill(`${month}-20`);
  await page.locator('.category-field-income select').selectOption({ label: '給与' });
  await page.getByLabel('メモ（任意）').fill(markerFor('income'));
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await page.goto(`/?month=${month}`);
  await expect(page.getByRole('group', { name: '収入' }).getByText('5,000円')).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'この月の支出' }).locator('.lead-amount'),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: '収支差額' }).getByText('3,800円')).toBeVisible();

  await page.goto(`/transactions?month=${month}`);
  await page.getByRole('link', { name: /10日/ }).click();
  await page.getByLabel('金額').fill('2,000');
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(page.getByRole('link', { name: /支出.*2,000円/ })).toBeVisible();

  await page.getByRole('link', { name: /10日/ }).click();
  const deleteTrigger = page.locator('.delete-confirm > summary');
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 375, height: 812 },
  ] satisfies ModalViewport[]) {
    await page.setViewportSize(viewport);
    await assertDeleteAndSaveAligned(page);
    await assertDeleteModalInteraction(page, viewport);
  }
  await deleteTrigger.click();
  await expect(page.getByText('この取引を削除しますか？')).toBeVisible();
  await page.getByRole('link', { name: 'キャンセル' }).click();
  await expect(deleteTrigger).toBeVisible();
  await deleteTrigger.click();
  await page.locator('#delete-transaction-form input[name="confirm"]').evaluate((input) => {
    input.remove();
  });
  await page.getByRole('button', { name: '削除を確定' }).click();
  await expect(page.locator('.form-error-dialog')).toContainText('確認操作を完了してください');
  await page
    .locator('.form-error-dialog')
    .getByRole('button', { name: '閉じる', exact: true })
    .click();
  await page.reload();
  await page.locator('.delete-confirm > summary').click();
  await page.getByRole('button', { name: '削除を確定' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(page.getByRole('link', { name: /支出.*2,000円/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /収入.*5,000円/ })).toBeVisible();
});

test('requires explicit delete confirmation when JavaScript is disabled', async ({ browser }) => {
  if (!databaseClient) {
    throw new Error('database client is not initialized');
  }
  const categoryRows = await databaseClient.sql`
    select id
    from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and type = 'expense'
    order by id
    limit 1
  `;
  const categoryId = Number(categoryRows[0]?.id);
  if (!Number.isInteger(categoryId)) {
    throw new Error('expense category fixture is missing');
  }
  const memo = markerFor('js-disabled-delete');
  const insertedRows = await databaseClient.sql`
    insert into transactions (household_id, type, amount, occurred_on, category_id, memo)
    values (${DEFAULT_HOUSEHOLD_ID}, 'expense', 321, ${`${month}-28`}, ${categoryId}, ${memo})
    returning id
  `;
  const transactionId = Number(insertedRows[0]?.id);
  if (!Number.isInteger(transactionId)) {
    throw new Error('delete fixture was not created');
  }

  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(`/transactions/${transactionId}/edit`);
    const desktopViewport = { width: 1280, height: 900 } satisfies ModalViewport;
    await page.setViewportSize(desktopViewport);
    let deleteTrigger = page.locator('.delete-confirm > summary');
    await expect(deleteTrigger).toBeVisible();
    await deleteTrigger.click();
    await expect(page.getByText('この取引を削除しますか？')).toBeVisible();
    await assertDeleteModalGeometry(page, desktopViewport);
    await page.getByRole('link', { name: 'キャンセル' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}/edit`));

    const mobileViewport = { width: 375, height: 812 } satisfies ModalViewport;
    await page.setViewportSize(mobileViewport);
    deleteTrigger = page.locator('.delete-confirm > summary');
    await deleteTrigger.click();
    await expect(page.getByText('この取引を削除しますか？')).toBeVisible();
    await assertDeleteModalGeometry(page, mobileViewport);
    await page.getByRole('button', { name: '削除を確定' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
    await expect(page.getByRole('link', { name: /支出.*321円/ })).toHaveCount(0);
  } finally {
    await context.close();
    await databaseClient.sql`delete from transactions where id = ${transactionId}`;
  }
});

test('preselects an unknown category when editing its transaction', async ({ page }) => {
  if (!databaseClient) {
    throw new Error('database client is not initialized');
  }

  const categoryRows = await databaseClient.sql`
    select id
    from categories
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and type = 'expense'
      and name = '不明なカテゴリ'
    limit 1
  `;
  let categoryId: number;
  let createdCategory = false;
  const existingCategoryId = categoryRows[0]?.id;
  if (existingCategoryId !== undefined) {
    categoryId = Number(existingCategoryId);
  } else {
    const insertedCategories = await databaseClient.sql`
      insert into categories (household_id, type, name, sort_order)
      values (${DEFAULT_HOUSEHOLD_ID}, 'expense', '不明なカテゴリ', 95)
      returning id
    `;
    categoryId = Number(insertedCategories[0]?.id);
    createdCategory = true;
  }
  if (!Number.isInteger(categoryId)) {
    throw new Error('unknown category fixture was not created');
  }

  const memo = markerFor('unknown-category-edit');
  const insertedTransactions = await databaseClient.sql`
    insert into transactions (household_id, type, amount, occurred_on, category_id, memo)
    values (${DEFAULT_HOUSEHOLD_ID}, 'expense', 450, ${`${month}-25`}, ${categoryId}, ${memo})
    returning id
  `;
  const transactionId = Number(insertedTransactions[0]?.id);
  if (!Number.isInteger(transactionId)) {
    throw new Error('unknown category transaction fixture was not created');
  }

  try {
    await page.goto(`/transactions/${transactionId}/edit`);
    const categorySelect = page.locator('.category-field-expense select');
    await expect(categorySelect).toHaveValue(String(categoryId));
    await expect(categorySelect.locator('option:checked')).toHaveText('不明なカテゴリ');
    await expect(page.getByLabel('メモ（任意）')).toHaveValue(memo);
  } finally {
    await databaseClient.sql`delete from transactions where id = ${transactionId}`;
    if (createdCategory) {
      await databaseClient.sql`delete from categories where id = ${categoryId}`;
    }
  }
});

test('isolates months: a transaction in one month never appears in another', async ({ page }) => {
  await assertEmptyMonth(nextMonth);
  await page.goto(`/transactions/new?month=${nextMonth}`);
  await page.getByLabel('金額').fill('700');
  await page.locator('input[name="occurredOn"]').fill(`${nextMonth}-05`);
  await page.locator('.category-field-expense select').selectOption({ label: '日用品' });
  await page.getByLabel('メモ（任意）').fill(markerFor('next-month'));
  await page.getByRole('button', { name: '登録する' }).click();

  await page.goto(`/?month=${month}`);
  await expect(page.getByText('700円')).toHaveCount(0);
  await expect(page.getByRole('group', { name: '収入' }).getByText('5,000円')).toBeVisible();

  await page.goto(`/transactions?month=${month}`);
  await expect(page.getByRole('link', { name: /700円/ })).toHaveCount(0);

  await page.goto(`/?month=${nextMonth}`);
  await expect(page.getByRole('heading', { name: '概要' })).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'この月の支出' }).locator('.lead-amount'),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: '収入' }).getByText('0円')).toBeVisible();

  await page.goto(`/transactions?month=${nextMonth}`);
  const rows = page.getByRole('list', { name: '取引' }).getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('700円');

  await page.goto(`/?month=${month}`);
  await page.getByRole('link', { name: '翌月' }).click();
  await expect(page.locator('.month-switcher-label')).toHaveText(nextMonthLabel);
});

test('filters transactions with a native GET form when JavaScript is disabled', async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });
  const page = await context.newPage();
  try {
    await page.goto(`/transactions?month=${month}`);
    await expect(page.getByText('すべての種別・すべてのカテゴリ')).toBeVisible();
    await page.getByText('条件を変更する', { exact: true }).click();
    await page.getByRole('combobox', { name: '種別' }).selectOption('income');
    await page.getByRole('button', { name: '適用' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}.*type=income`));
    await expect(page.getByText('収入・すべてのカテゴリ')).toBeVisible();
    await expect(page.getByRole('link', { name: /収入.*円/ })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('saves and displays zero and negative amounts', async ({ page }) => {
  await page.goto(`/transactions/new?month=${month}`);
  await page.getByLabel('金額').fill('0');
  await page.locator('input[name="occurredOn"]').fill(`${month}-26`);
  await page.locator('.category-field-expense select').selectOption({ label: '食費' });
  await page.getByLabel('メモ（任意）').fill(markerFor('zero'));
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(page.getByRole('link', { name: /支出.*0円/ })).toBeVisible();

  await page.goto(`/transactions/new?month=${month}`);
  await page.getByLabel('金額').fill('-1200');
  await page.locator('input[name="occurredOn"]').fill(`${month}-27`);
  await page.locator('.category-field-expense select').selectOption({ label: '食費' });
  await page.getByLabel('メモ（任意）').fill(markerFor('negative'));
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(page.getByRole('link', { name: /支出.*＋1,200円/ })).toBeVisible();
});

test('rejects invalid amount input without stripping and shows an accessible format popup', async ({
  page,
}) => {
  await page.goto(`/transactions/new?month=${month}`);
  const amount = page.getByLabel('金額');
  await amount.fill('1,200');
  await expect(amount).toHaveValue('1,200');

  await amount.press('a');
  await expect(amount).toHaveValue('1,200');
  await expect(page.locator('#transaction-amount-format-error')).toContainText(
    '整数で入力してください',
  );

  for (const invalidValue of ['1.5', '1.', '.5', '1e3', '12abc', '1-2', '--2', '1_200']) {
    await amount.fill(invalidValue);
    await expect(amount).toHaveValue('1,200');
    const error = page.locator('#transaction-amount-format-error');
    await expect(error).toContainText('整数で入力してください');
    await expect(error).toHaveAttribute('id', 'transaction-amount-format-error');
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(amount).toHaveAttribute('aria-invalid', 'true');
    await expect(amount).toHaveAttribute('aria-describedby', 'transaction-amount-format-error');
  }

  await amount.fill('-');
  await expect(amount).toHaveValue('-');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(/\/transactions\/new\?month=/);
  await expect(page.locator('#transaction-amount-format-error')).toContainText(
    '整数で入力してください',
  );
  await page.getByRole('dialog').getByRole('button', { name: '閉じる' }).click();
  await amount.fill('-1,200');
  await expect(amount).toHaveValue('-1,200');
  await expect(page.locator('#transaction-amount-format-error')).toHaveCount(0);
  for (const selector of [
    '.amount-line .field-value',
    '.category-field-expense .field-value',
    '.date-field .field-value',
    '.memo-field .field-value',
  ]) {
    const valueBox = await page.locator(selector).boundingBox();
    const controlBox = await page
      .locator(
        `${selector} > input, ${selector} > select, ${selector} > textarea, ${selector} .date-picker-display`,
      )
      .first()
      .boundingBox();
    if (!valueBox || !controlBox) {
      throw new Error(`value control is not measurable: ${selector}`);
    }
    expect(controlBox.width).toBeCloseTo(valueBox.width, 1);
  }
});

test('centers and auto-grows the memo field up to five lines', async ({ page }) => {
  await page.goto(`/transactions/new?month=${month}`);

  const memo = page.locator('#transaction-memo');
  const memoRow = page.locator('.memo-field');
  const categoryRow = page.locator('.category-field-expense');
  const measureMemo = () =>
    memoRow.evaluate((field) => {
      const label = field.querySelector('label');
      const textarea = field.querySelector('textarea');
      if (!label || !textarea) {
        throw new Error('memo field controls are not measurable');
      }
      const labelBox = label.getBoundingClientRect();
      const textareaBox = textarea.getBoundingClientRect();
      const style = getComputedStyle(textarea);
      return {
        rowHeight: field.getBoundingClientRect().height,
        labelCenter: labelBox.top + labelBox.height / 2,
        textareaCenter: textareaBox.top + textareaBox.height / 2,
        textareaHeight: textareaBox.height,
        clientHeight: textarea.clientHeight,
        scrollHeight: textarea.scrollHeight,
        lineHeight: Number.parseFloat(style.lineHeight),
        padding: Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom),
      };
    });

  const emptyMetrics = await measureMemo();
  const categoryBox = await categoryRow.boundingBox();
  if (!categoryBox) {
    throw new Error('category row is not measurable');
  }
  expect(Math.abs(emptyMetrics.rowHeight - categoryBox.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(emptyMetrics.labelCenter - emptyMetrics.textareaCenter)).toBeLessThanOrEqual(1);

  const threeLineMemo = 'one\ntwo\nthree';
  await memo.fill(threeLineMemo);
  await expect
    .poll(async () => (await measureMemo()).textareaHeight)
    .toBeGreaterThan(emptyMetrics.textareaHeight);
  const threeLineMetrics = await measureMemo();
  expect(threeLineMetrics.rowHeight).toBeGreaterThan(emptyMetrics.rowHeight);
  expect(
    Math.abs(threeLineMetrics.labelCenter - threeLineMetrics.textareaCenter),
  ).toBeLessThanOrEqual(1);
  await expect(memo).toHaveValue(threeLineMemo);

  const tenLineMemo = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n');
  await memo.fill(tenLineMemo);
  await expect
    .poll(async () => {
      const metrics = await measureMemo();
      return metrics.scrollHeight - metrics.clientHeight;
    })
    .toBeGreaterThan(0);
  const maxMetrics = await measureMemo();
  expect(maxMetrics.scrollHeight).toBeGreaterThan(maxMetrics.clientHeight);
  expect(
    Math.abs(maxMetrics.clientHeight - (maxMetrics.lineHeight * 5 + maxMetrics.padding)),
  ).toBeLessThanOrEqual(2);
  expect(Math.abs(maxMetrics.labelCenter - maxMetrics.textareaCenter)).toBeLessThanOrEqual(1);
  await expect(memo).toHaveValue(tenLineMemo);
});

test('shows server amount errors in the fallback dialog without changing row height', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    for (const [invalidAmount, expectedMessage] of [
      ['1.5', '金額は整数で入力してください。'],
      ['1000000000', '金額は999,999,999円以下で入力してください。'],
    ] as const) {
      await page.goto(`/transactions/new?month=${month}`);
      const amount = page.getByLabel('金額');
      const row = page.locator('.amount-field');
      await amount.fill('100');
      const validBox = await row.boundingBox();
      if (!validBox) {
        throw new Error('amount row is not measurable');
      }
      await amount.fill(invalidAmount);
      await page.getByRole('button', { name: '登録する' }).click();
      const dialog = page.locator('dialog[open]');
      await expect(dialog).toContainText(expectedMessage);
      await expect(page.locator('#transaction-amount-error')).toHaveClass(/sr-only/);
      await expect(amount).toHaveAttribute('aria-invalid', 'true');
      await expect(row).toHaveClass(/has-error/);
      const errorBox = await row.boundingBox();
      if (!errorBox) {
        throw new Error('amount error row is not measurable');
      }
      expect(errorBox.height).toBe(validBox.height);
    }
  } finally {
    await context.close();
  }
});

test('opens an error dialog and restores focus without changing invalid row height', async ({
  page,
}) => {
  await page.goto(`/transactions/new?month=${month}`);
  const amount = page.getByLabel('金額');
  const row = page.locator('.amount-field');
  const validBox = await row.boundingBox();
  if (!validBox) {
    throw new Error('amount row is not measurable');
  }
  await amount.fill('1000000000');
  await page.getByRole('button', { name: '登録する' }).click();

  const dialog = page.getByRole('dialog', { name: '入力内容を確認してください' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('金額は999,999,999円以下で入力してください。');
  await expect(page.locator('#transaction-amount-error')).toHaveClass(/sr-only/);
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  await expect(row).toHaveClass(/has-error/);
  const errorColor = await row.evaluate((element) => getComputedStyle(element).borderBottomColor);
  expect(errorColor).toBe('rgb(138, 91, 91)');
  const errorBox = await row.boundingBox();
  if (!errorBox) {
    throw new Error('amount error row is not measurable');
  }
  expect(errorBox.height).toBe(validBox.height);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(amount).toBeFocused();

  await page.getByRole('button', { name: '登録する' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '閉じる' }).click();
  await expect(dialog).toBeHidden();
  await expect(amount).toBeFocused();
});

test('keeps the date picker tab stop visible and saves after picking a date', async ({ page }) => {
  await page.goto(`/transactions/new?month=${month}`);
  const amount = page.getByLabel('金額');
  const category = page.locator('.category-field-expense select');
  const account = page.getByLabel('資産', { exact: true });
  const dateDisplay = page.locator('.date-picker-display');
  const memo = page.getByLabel('メモ（任意）');
  await amount.focus();

  await page.keyboard.press('Tab');
  await expect(category).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(account).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dateDisplay).toBeFocused();
  const dateInput = page.locator('input[type="date"][name="occurredOn"]');
  await expect(dateInput).toHaveJSProperty('tabIndex', -1);
  const dateBox = await dateDisplay.boundingBox();
  if (!dateBox || dateBox.width === 0 || dateBox.height === 0) {
    throw new Error('date picker display is not visible');
  }
  await page.keyboard.press('Tab');
  await expect(memo).toBeFocused();

  const pickedDate = `${month}-03`;
  await dateInput.fill(pickedDate);
  await expect(dateDisplay).toContainText(pickedDate.replaceAll('-', '/'));
  await amount.fill('432');
  await category.selectOption({ label: '食費' });
  await memo.fill(markerFor('date-tab-save'));
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));
  await expect(page.getByRole('link', { name: /支出.*432円/ })).toBeVisible();
});

test('formats date and month controls independently of browser locale', async ({ browser }) => {
  const context = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'Asia/Tokyo',
  });
  const page = await context.newPage();
  const day = `${month}-27`;
  const initialDate = `${month.replace('-', '/')}/01`;
  const expectedDate = `${month.replace('-', '/')}/27`;
  const expectedMonth = month.replace('-', '/');
  try {
    await page.goto(`/transactions/new?month=${month}`);
    const dateInput = page.locator('input[type="date"][name="occurredOn"]');
    await expect(page.locator('.date-picker-display')).toContainText(initialDate);
    await dateInput.fill(day);
    await expect(page.locator('.date-picker-display')).toContainText(expectedDate);
    await page.getByLabel('金額').fill('321');
    await page.locator('.category-field-expense select').selectOption({ label: '食費' });
    await page.getByLabel('メモ（任意）').fill(markerFor('locale-date'));
    await page.getByRole('button', { name: '登録する' }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}`));

    await page.getByText('条件を変更する', { exact: true }).click();
    await expect(page.locator('.month-picker-display')).toHaveText(expectedMonth);
    const monthInput = page.locator('input[type="month"][name="month"]');
    await monthInput.fill(month);
    await expect(monthInput).toHaveValue(month);
  } finally {
    await context.close();
  }
});

test('treats non-int4 transaction ids as not found', async ({ request }) => {
  for (const id of ['2147483648', '007']) {
    const response = await request.get(`/transactions/${id}/edit`);
    expect(response.status()).toBe(404);
  }
});

test('health endpoints are available', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'kobako 家計ノート ホーム' })).toBeVisible();

  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({ status: 'ok' });

  const databaseHealth = await request.get('/api/health/db');
  expect(databaseHealth.ok()).toBe(true);
  expect(await databaseHealth.json()).toEqual({ status: 'ok' });
});
