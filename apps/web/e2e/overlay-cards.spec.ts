import { expect, test, type Page } from '@playwright/test';

import { currentTokyoMonth } from '@kobako/db';

import { waitForMotion } from './motion';

test.describe('overlay cards', () => {
  const stableMainHtml = async (page: Page) =>
    page.locator('main').evaluate((node) => {
      const clone = node.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[style=""]').forEach((element) => element.removeAttribute('style'));
      return clone.innerHTML;
    });

  test('keeps the transaction list behind the new-transaction card and restores focus', async ({
    page,
  }) => {
    const month = currentTokyoMonth();
    await page.goto('/settings');
    const sectionHeadingStyles = await page
      .locator('main section h2')
      .first()
      .evaluate((heading) => {
        const style = getComputedStyle(heading);
        return {
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
        };
      });
    await page.goto(`/transactions?month=${month}`);
    await page.evaluate(() => {
      document.body.style.minHeight = '200vh';
      void document.body.offsetHeight;
      window.scrollTo(0, 0);
    });
    const mainBox = await page.locator('main').boundingBox();
    if (!mainBox) throw new Error('main box is missing');
    await page.mouse.move(mainBox.x + 10, mainBox.y + 10);
    await page.mouse.wheel(0, 600);
    await expect
      .poll(() => page.evaluate(() => window.scrollY), { timeout: 1_000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.keyboard.press('PageDown');
    await expect
      .poll(() => page.evaluate(() => window.scrollY), { timeout: 1_000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    const before = await page.locator('main').evaluate((main) => {
      const elements = [
        ['main', main],
        ['page-shell', main.querySelector('[data-slot="page-shell"]')],
        ['page-header', main.querySelector('[data-slot="page-header"]')],
        ['h1', main.querySelector('h1')],
      ] as const;
      if (elements.some(([, element]) => !element)) {
        throw new Error('main geometry elements are missing');
      }
      return {
        geometry: Object.fromEntries(
          elements.map(([name, element]) => {
            const rect = element!.getBoundingClientRect();
            return [name, { x: rect.x, width: rect.width }];
          }),
        ) as Record<string, { x: number; width: number }>,
        scrollY: window.scrollY,
        scrollbarWidth: window.innerWidth - document.documentElement.clientWidth,
        htmlOverflow: document.documentElement.style.overflow,
        bodyPaddingRight: document.body.style.paddingRight,
        computedBodyPaddingRight:
          Number.parseFloat(getComputedStyle(document.body).paddingRight) || 0,
      };
    });
    test.info().annotations.push({
      type: 'scrollbar-width',
      description: `measured ${before.scrollbarWidth}px`,
    });
    const beforeHtml = await stableMainHtml(page);
    const entry = page.getByRole('link', { name: '取引を登録', exact: true }).first();
    await expect(entry).toHaveAttribute('data-variant', 'primary');
    const entryMetrics = await entry.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        fontSize: style.fontSize,
        padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
      };
    });
    if ((page.viewportSize()?.width ?? 1280) <= 480) {
      expect(entryMetrics.height).toBe(36);
      expect(entryMetrics.fontSize).toBe('12px');
      expect(entryMetrics.padding).toBe('8px 12.8px 8px 12.8px');
    }
    await entry.focus();
    await entry.click();
    await expect(page).toHaveURL(new RegExp(`/transactions/new\\?month=${month}$`));
    await expect(
      page.locator('#entry-dialog[data-card-pattern="overlay-card"][data-card-kind="transaction"]'),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: '取引を登録', exact: true })).toBeVisible();
    await expect(page.locator('#transaction-amount')).toBeFocused();
    expect(await stableMainHtml(page)).toBe(beforeHtml);
    const open = await page.locator('main').evaluate((main) => {
      const elements = [
        ['main', main],
        ['page-shell', main.querySelector('[data-slot="page-shell"]')],
        ['page-header', main.querySelector('[data-slot="page-header"]')],
        ['h1', main.querySelector('h1')],
      ] as const;
      if (elements.some(([, element]) => !element)) {
        throw new Error('main geometry elements are missing');
      }
      return {
        geometry: Object.fromEntries(
          elements.map(([name, element]) => {
            const rect = element!.getBoundingClientRect();
            return [name, { x: rect.x, width: rect.width }];
          }),
        ) as Record<string, { x: number; width: number }>,
        scrollY: window.scrollY,
        htmlOverflow: document.documentElement.style.overflow,
        computedBodyPaddingRight:
          Number.parseFloat(getComputedStyle(document.body).paddingRight) || 0,
      };
    });
    expect(open.htmlOverflow).toBe('hidden');
    expect(open.computedBodyPaddingRight).toBeCloseTo(
      before.computedBodyPaddingRight + before.scrollbarWidth,
      3,
    );
    expect(open.scrollY).toBe(before.scrollY);
    for (const name of Object.keys(before.geometry)) {
      const beforeGeometry = before.geometry[name];
      const openGeometry = open.geometry[name];
      if (!beforeGeometry || !openGeometry) throw new Error(`missing geometry for ${name}`);
      expect(Math.abs(openGeometry.x - beforeGeometry.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(openGeometry.width - beforeGeometry.width)).toBeLessThanOrEqual(1);
    }

    const backdropPoint = { x: 4, y: 4 };
    await page.mouse.move(backdropPoint.x, backdropPoint.y);
    await page.mouse.wheel(0, 600);
    await expect
      .poll(() => page.evaluate(() => window.scrollY), { timeout: 1_000 })
      .toBe(before.scrollY);
    await page.mouse.move(mainBox.x + 10, mainBox.y + 10);
    await page.mouse.wheel(0, 600);
    await expect
      .poll(() => page.evaluate(() => window.scrollY), { timeout: 1_000 })
      .toBe(before.scrollY);
    await page.keyboard.press('PageDown');
    await expect
      .poll(() => page.evaluate(() => window.scrollY), { timeout: 1_000 })
      .toBe(before.scrollY);

    await waitForMotion(page);
    const cardStyles = await page.locator('#entry-dialog').evaluate((card) => {
      const field = card.querySelector<HTMLElement>('[data-slot="amount-field"]');
      const label = field?.querySelector<HTMLElement>('label');
      const save = card.querySelector<HTMLElement>(
        "button[data-slot='button'][data-variant='primary']",
      );
      const title = card.querySelector<HTMLElement>('h1');
      if (!field || !label || !save || !title) {
        throw new Error('overlay heading styles are missing');
      }
      const fieldStyle = getComputedStyle(field);
      const labelStyle = getComputedStyle(label);
      const saveStyle = getComputedStyle(save);
      const titleStyle = getComputedStyle(title);
      const saveRect = save.getBoundingClientRect();
      return {
        columns: fieldStyle.gridTemplateColumns,
        minHeight: fieldStyle.minHeight,
        borderBottomWidth: fieldStyle.borderBottomWidth,
        labelFontSize: labelStyle.fontSize,
        buttonColor: saveStyle.backgroundColor,
        titleFontSize: titleStyle.fontSize,
        titleFontWeight: titleStyle.fontWeight,
        titleLineHeight: titleStyle.lineHeight,
        titleLetterSpacing: titleStyle.letterSpacing,
        saveWidth: saveRect.width,
        saveHeight: saveRect.height,
        saveFontSize: saveStyle.fontSize,
      };
    });
    expect(sectionHeadingStyles.fontSize).toBe('15px');
    expect(cardStyles.titleFontSize).toBe('15px');
    expect({
      fontSize: cardStyles.titleFontSize,
      fontWeight: cardStyles.titleFontWeight,
      lineHeight: cardStyles.titleLineHeight,
      letterSpacing: cardStyles.titleLetterSpacing,
    }).toEqual(sectionHeadingStyles);
    expect(cardStyles.columns).toContain('90px');
    expect(cardStyles.minHeight).toBe('52px');
    expect(cardStyles.borderBottomWidth).toBe('1px');
    expect(cardStyles.labelFontSize).toBe('12px');
    expect(cardStyles.saveWidth).toBeCloseTo(page.viewportSize()!.width <= 480 ? 75.59 : 86.78, 1);
    expect(cardStyles.saveHeight).toBe(page.viewportSize()!.width <= 480 ? 36 : 44);
    expect(cardStyles.saveFontSize).toBe(page.viewportSize()!.width <= 480 ? '12px' : '14px');
    const last = page.locator('#entry-dialog button:not([disabled]):visible').last();
    await last.focus();
    await page.keyboard.press('Tab');
    await expect(
      page.locator('#entry-dialog button:not([disabled]):visible').first(),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#entry-dialog')).toHaveCount(0);
    const restored = await page.evaluate(() => ({
      scrollY: window.scrollY,
      htmlOverflow: document.documentElement.style.overflow,
      bodyPaddingRight: document.body.style.paddingRight,
    }));
    expect(restored.scrollY).toBe(before.scrollY);
    expect(restored.htmlOverflow).toBe(before.htmlOverflow);
    expect(restored.bodyPaddingRight).toBe(before.bodyPaddingRight);
    await page.waitForTimeout(300);
    await entry.focus();
    const afterMainBox = await page.locator('main').boundingBox();
    if (!afterMainBox) throw new Error('main box is missing');
    await page.mouse.move(afterMainBox.x + 10, afterMainBox.y + 10);
    await page.mouse.wheel(0, 600);
    await expect
      .poll(() => page.evaluate(() => window.scrollY), { timeout: 1_000 })
      .toBeGreaterThan(before.scrollY);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.keyboard.press('PageDown');
    await expect
      .poll(() => page.evaluate(() => window.scrollY), { timeout: 1_000 })
      .toBeGreaterThan(before.scrollY);

    await expect(entry).toBeFocused();
  });

  test('supports heading close, backdrop close, browser back, and direct page fallback', async ({
    page,
  }) => {
    const month = currentTokyoMonth();
    await page.goto(`/transactions?month=${month}`);
    const entry = page.getByRole('link', { name: '取引を登録', exact: true }).first();

    await entry.click();
    await page.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(page.locator('#entry-dialog')).toHaveCount(0);
    await entry.click();
    await page
      .locator('[data-card-pattern="overlay-card"]')
      .locator('..')
      .click({ position: { x: 2, y: 2 } });
    await expect(page.locator('#entry-dialog')).toHaveCount(0);

    await entry.click();
    await page.goBack();
    await expect(page.locator('#entry-dialog')).toHaveCount(0);

    await page.goto('/transactions/new');
    await expect(page.getByRole('heading', { name: '取引を登録', exact: true })).toBeVisible();
    await expect(page.locator('#entry-dialog')).toHaveCount(0);
  });

  test('opens an asset card over balances and keeps direct asset navigation a page', async ({
    page,
  }) => {
    await page.goto('/balances');
    const beforeHtml = await stableMainHtml(page);
    const entry = page.getByRole('link', { name: '資産を登録', exact: true }).first();
    await entry.click();
    await expect(page).toHaveURL(/\/accounts\/new(?:\?.*)?$/);
    await expect(page.locator('#entry-dialog[data-card-kind="asset"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: '資産を登録', exact: true })).toBeVisible();
    expect(await stableMainHtml(page)).toBe(beforeHtml);
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await expect(page.locator('#entry-dialog')).toHaveCount(0);

    await page.goto('/accounts/new');
    await expect(page.getByRole('heading', { name: '資産を登録', exact: true })).toBeVisible();
    await expect(page.locator('#entry-dialog')).toHaveCount(0);
  });
  test('opens edit cards from transaction, transfer, overview, and asset rows', async ({
    page,
  }) => {
    const month = currentTokyoMonth();
    const marker = `overlay-edit-${Date.now()}`;
    await page.goto('/accounts/new');
    await page.getByLabel('名前', { exact: true }).fill(`Overlay ${marker}`);
    await page.getByLabel('資産カテゴリ', { exact: true }).selectOption({ index: 1 });
    await page.getByRole('button', { name: '登録する', exact: true }).click();
    await page.goto('/accounts/new');
    await page.getByLabel('名前', { exact: true }).fill(`Overlay second ${marker}`);
    await page.getByLabel('資産カテゴリ', { exact: true }).selectOption({ index: 1 });
    await page.getByRole('button', { name: '登録する', exact: true }).click();
    await expect(page).toHaveURL(/\/transactions\?account=\d+&month=all$/);
    await page.goto(`/transactions/new?month=${month}`);
    await page.getByLabel('金額').fill('1234');
    await page.locator('input[name="occurredOn"]').fill(`${month}-15`);
    await page.locator('[data-slot="category-field-expense"] select').selectOption({ index: 1 });
    await page.getByLabel('資産').selectOption({ index: 1 });
    await page.getByLabel('メモ（任意）').fill(marker);
    await page.getByRole('button', { name: '登録する', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}$`));
    await page.reload();
    const row = page.locator('[data-slot="transaction-link"]').first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.locator('#entry-dialog[data-card-kind="transaction"]')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#entry-dialog')).toHaveCount(0);
    await expect(row).toBeFocused();
    await row.click();
    await expect(page.locator('#entry-dialog[data-card-kind="transaction"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(row).toBeFocused();

    await page.goto(`/transactions/new?type=transfer&month=${month}`);
    await page.getByLabel('金額').fill('123');
    await page.locator('input[name="occurredOn"]').fill(`${month}-16`);
    await page.getByLabel('振替元').selectOption({ index: 1 });
    await page.getByLabel('振替先').selectOption({ index: 2 });
    await page.getByLabel('メモ（任意）').fill(`${marker}-transfer`);
    await page.getByRole('button', { name: '登録する', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}$`));
    await page.reload();
    const transfer = page.locator('[data-slot="transaction-link"][href*="/transfers/"]').first();
    await expect(transfer).toBeVisible();
    await transfer.click();
    await expect(page.locator('#entry-dialog[data-card-kind="transaction"]')).toBeVisible();
    await page.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(page.locator('#entry-dialog')).toHaveCount(0);

    await page.goto(`/?month=${currentTokyoMonth()}`);
    const overviewRow = page.locator('[data-slot="transaction-link"]').first();
    await expect(overviewRow).toBeVisible();
    await overviewRow.click();
    await expect(page.locator('#entry-dialog[data-card-kind="transaction"]')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#entry-dialog')).toHaveCount(0);

    await page.goto('/transactions/new');
    const accountId = await page
      .locator('#transaction-account option:not([value=""])')
      .first()
      .getAttribute('value');
    if (!accountId) throw new Error('test account is missing');
    const initialLockStyles = await page.evaluate(() => ({
      htmlOverflow: document.documentElement.style.overflow,
      bodyPaddingRight: document.body.style.paddingRight,
    }));
    await page.goto(`/transactions?account=${accountId}&month=all`);
    const assetEdit = page.getByRole('link', { name: '資産を編集', exact: true });
    await expect(assetEdit).toBeVisible();
    await assetEdit.click();
    await expect(page.locator('#entry-dialog[data-card-kind="asset"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');
    await page.locator('[data-slot="delete-confirm"] > summary').click();
    const assetDelete = page.locator('[data-slot="delete-confirmation"]');
    await expect(assetDelete).toHaveAttribute('data-card-kind', 'asset');
    await expect(
      assetDelete.getByRole('heading', { name: 'この資産を削除しますか？' }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');
    await assetDelete.getByRole('link', { name: 'キャンセル' }).click();
    await expect(assetDelete).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');
    await page.locator('#entry-dialog').getByRole('button', { name: '戻る' }).click();
    await expect(page.locator('#entry-dialog')).toHaveCount(0);
    expect(
      await page.evaluate(() => ({
        htmlOverflow: document.documentElement.style.overflow,
        bodyPaddingRight: document.body.style.paddingRight,
      })),
    ).toEqual(initialLockStyles);
  });

  test('keeps cards and transaction lists within a 320px viewport at large root sizes', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/transactions');
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '20px';
      document.body.style.fontSize = '32px';
    });
    await page.getByRole('link', { name: '取引を登録', exact: true }).first().click();
    const card = page.locator('#entry-dialog[data-card-pattern="overlay-card"]');
    await expect(card).toBeVisible();
    const widths = await page.evaluate(() => ({
      body: document.body.scrollWidth <= document.documentElement.clientWidth,
      card: (() => {
        const node = document.querySelector<HTMLElement>('#entry-dialog');
        return Boolean(
          node &&
          (node.scrollWidth <= node.clientWidth || getComputedStyle(node).overflowX === 'hidden'),
        );
      })(),
    }));
    expect(widths.body).toBe(true);
    expect(widths.card).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#entry-dialog')).toHaveCount(0);
  });
});
