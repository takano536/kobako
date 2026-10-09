import { expect, test, type Page } from '@playwright/test';

const runSuffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function categoryRow(page: Page, name: string) {
  return page.locator('.settings-category-row').filter({ hasText: name });
}

async function addCategory(page: Page, name: string) {
  await page.getByLabel('新しいカテゴリ').fill(name);
  await page.getByRole('button', { name: '追加' }).click();
  await expect(categoryRow(page, name)).toHaveCount(1);
}

async function removeCategory(page: Page, name: string) {
  const row = categoryRow(page, name);
  if ((await row.count()) === 0) return;
  await row.getByRole('button', { name: '削除' }).click();
  await expect(row).toHaveCount(0);
}

test.describe('設定画面', () => {
  test('カテゴリ管理とデータ管理を分けて表示する', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '設定' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'カテゴリ管理' })).toBeVisible();
    await expect(page.getByRole('link', { name: '資産カテゴリ' })).toHaveAttribute(
      'href',
      '/settings/categories/asset',
    );
    await expect(page.getByRole('link', { name: '支出カテゴリ' })).toHaveAttribute(
      'href',
      '/settings/categories/expense',
    );
    await expect(page.getByRole('link', { name: '収入カテゴリ' })).toHaveAttribute(
      'href',
      '/settings/categories/income',
    );
    await expect(page.getByRole('heading', { name: 'データ管理' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'すべてのデータを削除' })).toBeVisible();
    await expect(page.getByRole('link', { name: '設定' })).toHaveAttribute('aria-current', 'page');
    const row = page.getByRole('link', { name: '支出カテゴリ' });
    expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect(
      await row
        .locator('span')
        .first()
        .evaluate((el) => getComputedStyle(el).textDecorationLine),
    ).toBe('none');
    const headingLeft = (await page.getByRole('heading', { name: 'カテゴリ管理' }).boundingBox())
      ?.x;
    const textLeft = (await row.locator('span').first().boundingBox())?.x;
    expect(Math.abs((textLeft ?? 0) - (headingLeft ?? 99))).toBeLessThanOrEqual(1);
  });

  test('カテゴリごとに独立したページを開ける', async ({ page }) => {
    for (const [path, title] of [
      ['/settings/categories/asset', '資産カテゴリ'],
      ['/settings/categories/expense', '支出カテゴリ'],
      ['/settings/categories/income', '収入カテゴリ'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
      await expect(page.getByRole('link', { name: '設定へ戻る' })).toHaveAttribute(
        'href',
        '/settings',
      );
    }
  });

  test('削除ページは確認文字列が一致しないと実行しない', async ({ page }) => {
    await page.goto('/settings/delete');
    await expect(page.getByRole('heading', { name: 'すべてのデータを削除' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '削除されるデータ' })).toBeVisible();
    await expect(page.getByText('この操作は取り消せません')).toBeVisible();
    expect(
      await page.locator('.delete-all-warning').evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe('14px');
    await page.getByLabel('確認のため「削除」と入力してください').fill('削除ではない');
    await page.getByRole('button', { name: 'すべてのデータを削除する' }).click();
    await expect(page).toHaveURL(/\/settings\/delete$/);
    await expect(
      page.getByRole('alert').filter({ hasText: '「削除」と入力してください' }),
    ).toBeVisible();
    const input = page.getByLabel('確認のため「削除」と入力してください');
    await expect(input).toHaveValue('削除ではない');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveAttribute('aria-describedby', /delete-confirmation-error/);
    const errorBox = await page.locator('#delete-confirmation-error').boundingBox();
    const inputBox = await input.boundingBox();
    expect((errorBox?.y ?? 0) - ((inputBox?.y ?? 0) + (inputBox?.height ?? 0))).toBeLessThan(12);
    expect(
      await page
        .locator('#delete-confirmation-error')
        .evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe('14px');
  });

  test('正しい確認文字列で初期化し固定のお知らせへ遷移する', async ({ page }) => {
    await page.goto('/settings/delete');
    await page.getByLabel('確認のため「削除」と入力してください').fill('削除');
    await page.getByRole('button', { name: 'すべてのデータを削除する' }).click();
    await expect(page).toHaveURL(/\/settings\?reset=done$/);
    await expect(page.getByRole('heading', { name: '設定' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText(
      '家計のデータを削除し、初期カテゴリを再作成しました。',
    );
    await expect(page.getByRole('button', { name: 'すべてのデータを削除する' })).toHaveCount(0);
  });

  test('資産カテゴリは重複する見出しなしで固定分類を説明する', async ({ page }) => {
    await page.goto('/settings/categories/asset');
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
    await expect(
      page.getByText('固定の分類です。追加・削除・名前変更はできません。'),
    ).toBeVisible();
    await expect(
      page.getByRole('list', { name: '資産カテゴリの一覧' }).getByRole('listitem'),
    ).toHaveCount(6);
  });

  test('支出カテゴリは見出しを重複させず、名前を文字として表示する', async ({ page }) => {
    await page.goto('/settings/categories/expense');
    await expect(page.getByRole('heading', { level: 1, name: '支出カテゴリ' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
    await expect(page.locator('.heading-count')).toHaveText(/^\d+件$/);
    await expect(page.getByRole('textbox')).toHaveCount(1);
    const row = categoryRow(page, '食費');
    for (const name of ['名前を変更', '上へ', '下へ', '削除']) {
      await expect(row.getByRole('button', { name })).toBeVisible();
    }
    await expect(row.getByRole('button', { name: '上へ' })).toBeDisabled();
  });

  test('名前の変更はインラインで行い、キャンセルと Escape で元に戻る', async ({ page }) => {
    const name = `E2E変更-${runSuffix}`;
    const renamed = `${name}-新`;
    await page.goto('/settings/categories/expense');
    await addCategory(page, name);
    try {
      const row = categoryRow(page, name);
      const rowIndex = await row.evaluate((element) =>
        [...element.parentElement!.children].indexOf(element),
      );
      const rename = row.getByRole('button', { name: '名前を変更' });
      await rename.click();
      const editRow = page.locator('.settings-category-row').nth(rowIndex);
      const input = editRow.getByRole('textbox');
      await expect(input).toBeFocused();
      await expect(input).toHaveValue(name);
      await input.fill('途中の入力');
      await page.keyboard.press('Escape');
      await expect(editRow.getByRole('textbox')).toHaveCount(0);
      await expect(
        page
          .locator('.settings-category-row')
          .nth(rowIndex)
          .getByRole('button', { name: '名前を変更' }),
      ).toBeFocused();
      await expect(
        page.locator('.settings-category-row').nth(rowIndex).getByText(name, { exact: true }),
      ).toBeVisible();

      await page
        .locator('.settings-category-row')
        .nth(rowIndex)
        .getByRole('button', { name: '名前を変更' })
        .click();
      await expect(
        page.locator('.settings-category-row').nth(rowIndex).getByRole('textbox'),
      ).toHaveValue(name);
      await page
        .locator('.settings-category-row')
        .nth(rowIndex)
        .getByRole('button', { name: 'キャンセル' })
        .click();
      await expect(
        page
          .locator('.settings-category-row')
          .nth(rowIndex)
          .getByRole('button', { name: '名前を変更' }),
      ).toBeFocused();

      await page
        .locator('.settings-category-row')
        .nth(rowIndex)
        .getByRole('button', { name: '名前を変更' })
        .click();
      await page.locator('.settings-category-row').nth(rowIndex).getByRole('textbox').fill(renamed);
      await page
        .locator('.settings-category-row')
        .nth(rowIndex)
        .getByRole('button', { name: '保存' })
        .click();
      await expect(categoryRow(page, renamed)).toHaveCount(1);
      await expect(page.getByRole('textbox')).toHaveCount(1);
    } finally {
      await removeCategory(page, renamed);
      await removeCategory(page, name);
    }
  });

  test('名前の重複はフォームを開いたまま入力値とエラーを保持する', async ({ page }) => {
    const name = `E2E重複-${runSuffix}`;
    await page.goto('/settings/categories/expense');
    await addCategory(page, name);
    try {
      const row = categoryRow(page, name);
      const rowIndex = await row.evaluate((element) =>
        [...element.parentElement!.children].indexOf(element),
      );
      await row.getByRole('button', { name: '名前を変更' }).click();
      const editRow = page.locator('.settings-category-row').nth(rowIndex);
      const input = editRow.getByRole('textbox');
      await input.fill('食費');
      await editRow.getByRole('button', { name: '保存' }).click();
      await expect(editRow.getByRole('alert')).toContainText('同じ名前のカテゴリがあります');
      await expect(input).toHaveValue('食費');
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expect(input).toHaveAttribute('aria-describedby', /category-error-/);
    } finally {
      await page.goto('/settings/categories/expense');
      await removeCategory(page, name);
    }
  });

  test('上へ・下へで並び順を変更し、端では無効にする', async ({ page }) => {
    const first = `E2E順序A-${runSuffix}`;
    const second = `E2E順序B-${runSuffix}`;
    await page.goto('/settings/categories/expense');
    await addCategory(page, first);
    await addCategory(page, second);
    try {
      await categoryRow(page, second).getByRole('button', { name: '上へ' }).click();
      await expect(async () => {
        const names = await page.locator('.settings-category-name').allTextContents();
        expect(names.indexOf(second)).toBeLessThan(names.indexOf(first));
      }).toPass();
      await expect(categoryRow(page, second).getByRole('button', { name: '上へ' })).toBeEnabled();
      await expect(categoryRow(page, first).getByRole('button', { name: '下へ' })).toBeDisabled();
    } finally {
      await page.goto('/settings/categories/expense');
      await removeCategory(page, first);
      await removeCategory(page, second);
    }
  });

  test('モバイル幅でも行が横にあふれず操作が一行に収まる', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings/categories/expense');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const row = categoryRow(page, '食費');
    const box = await row.boundingBox();
    expect(box?.height).toBeLessThanOrEqual(60);
  });
});
