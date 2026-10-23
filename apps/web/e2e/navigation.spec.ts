import { expect, test, type Locator, type Page } from '@playwright/test';

const month = '2024-06';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

async function expectNavigationLayout(page: Page, width: number): Promise<void> {
  const nav = page.locator('[data-slot="site-nav"]');
  await expect(nav).toHaveCount(1);
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link')).toHaveCount(3);
  await expect(nav.locator('[data-variant="primary"]')).toHaveCount(0);
  expect((await nav.textContent()) ?? '').not.toContain('＋');

  const geometry = await page.evaluate(() => {
    const navElement = document.querySelector<HTMLElement>('[data-slot="site-nav"]');
    const headerElement = document.querySelector<HTMLElement>('[data-slot="site-header"]');
    if (!navElement || !headerElement) throw new Error('navigation geometry is missing');
    const nav = navElement.getBoundingClientRect();
    const header = headerElement.getBoundingClientRect();
    return {
      nav: {
        left: nav.left,
        right: nav.right,
        top: nav.top,
        bottom: nav.bottom,
        height: nav.height,
      },
      header: { top: header.top, bottom: header.bottom },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      position: getComputedStyle(navElement).position,
      links: Array.from(navElement.querySelectorAll('a')).map((link) => {
        const box = link.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }),
    };
  });

  if (width <= 480) {
    expect(geometry.position).toBe('fixed');
    expect(geometry.nav.left).toBeLessThanOrEqual(0.5);
    expect(geometry.nav.right).toBeGreaterThanOrEqual(geometry.viewport.width - 0.5);
    expect(geometry.nav.bottom).toBeGreaterThanOrEqual(geometry.viewport.height - 0.5);
    expect(geometry.nav.height).toBeGreaterThanOrEqual(44);
    const firstLink = geometry.links[0];
    if (!firstLink) throw new Error('navigation link geometry is missing');
    for (const link of geometry.links) {
      expect(link.width).toBeGreaterThanOrEqual(44);
      expect(link.height).toBeGreaterThanOrEqual(44);
      expect(Math.abs(link.width - firstLink.width)).toBeLessThanOrEqual(1);
    }
    expect(geometry.nav.top).toBeGreaterThanOrEqual(geometry.header.bottom);
  } else {
    expect(geometry.position).not.toBe('fixed');
    expect(geometry.nav.top).toBeGreaterThanOrEqual(geometry.header.top);
    expect(geometry.nav.bottom).toBeLessThanOrEqual(geometry.header.bottom);
  }
}

async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Math.ceil(window.scrollY + window.innerHeight) >=
          document.documentElement.scrollHeight - 1,
      ),
    )
    .toBe(true);
}

async function expectNotCoveredByNavigation(page: Page, target: Locator): Promise<void> {
  const targetBox = await target.boundingBox();
  const navBox = await page.locator('[data-slot="site-nav"]').boundingBox();
  if (!targetBox || !navBox) throw new Error('navigation overlap geometry is missing');
  expect(targetBox.y + targetBox.height).toBeLessThanOrEqual(navBox.y);
}

test.describe('responsive main navigation', () => {
  test('shows exactly one responsive navigation and preserves header controls', async ({
    page,
  }) => {
    for (const width of [320, 390, 479, 481, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/transactions?month=${month}`);
      await expect(page.locator('[data-slot="brand"]')).toBeVisible();
      const settings = page.getByRole('link', { name: '設定', exact: true });
      await expect(settings).toHaveCount(1);
      await expect(settings).toHaveAttribute('href', '/settings');
      await expect(settings).toHaveAttribute('title', '設定');
      const settingsBox = await settings.boundingBox();
      if (!settingsBox) throw new Error('settings link geometry is missing');
      expect(settingsBox.width).toBeGreaterThanOrEqual(44);
      expect(settingsBox.height).toBeGreaterThanOrEqual(44);
      if (width <= 480) {
        const headerControls = page.locator(
          '[data-slot="site-header"] [data-slot="brand"], [data-slot="site-header"] [data-slot="site-settings"]',
        );
        await expect(headerControls).toHaveCount(2);
        await expect(headerControls.nth(0)).toBeVisible();
        await expect(headerControls.nth(1)).toBeVisible();
      }
      await expectNavigationLayout(page, width);
      await expectNoHorizontalOverflow(page);

      const active = page.getByRole('link', { name: '取引', exact: true });
      await expect(active).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('link', { name: '概要', exact: true })).not.toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(page.getByRole('link', { name: '残高', exact: true })).not.toHaveAttribute(
        'aria-current',
        'page',
      );
      await active.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(active).toBeFocused();
      expect(
        await active.evaluate((element) => {
          const style = getComputedStyle(element);
          return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
        }),
      ).toBe(true);
    }
  });

  test('preserves the selected month and keeps navigation out of the way at the bottom', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?month=${month}`);
    const monthLinks = [
      { name: '概要', href: `/?month=${month}` },
      { name: '取引', href: `/transactions?month=${month}` },
      { name: '残高', href: `/balances?month=${month}` },
    ] as const;
    for (const target of monthLinks) {
      await expect(page.getByRole('link', { name: target.name, exact: true })).toHaveAttribute(
        'href',
        target.href,
      );
    }
    await page.getByRole('link', { name: '取引', exact: true }).click();
    await expect(page).toHaveURL(`/transactions?month=${month}`);
    await page.getByRole('link', { name: '残高', exact: true }).click();
    await expect(page).toHaveURL(`/balances?month=${month}`);
    await page.getByRole('link', { name: '概要', exact: true }).click();
    await expect(page).toHaveURL(`/?month=${month}`);

    await page.goto('/settings');
    const lastSettingRow = page
      .getByRole('link')
      .filter({ hasText: /取り込む|すべてのデータを削除/ })
      .last();
    await scrollToBottom(page);
    await expectNotCoveredByNavigation(page, lastSettingRow);

    await page.goto(`/transactions/new?month=${month}`);
    const saveButton = page.getByRole('button', { name: '登録する', exact: true });
    await scrollToBottom(page);
    await expectNotCoveredByNavigation(page, saveButton);
    await expectNoHorizontalOverflow(page);
  });

  test('hides the mobile navigation while a text-entry control is focused', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/transactions/new?month=${month}`);
    const nav = page.locator('[data-slot="site-nav"]');
    await expect(nav).toBeVisible();
    await page.getByLabel('金額').focus();
    await expect(nav).toBeHidden();
    await expect(page.getByRole('button', { name: '登録する', exact: true })).toBeVisible();
  });
});

declare global {
  interface Window {
    __navigationMarker?: boolean;
  }
}

const navigationSkeleton = '[data-slot="page-skeleton"]';

/** Delays every navigation RSC response (not prefetches) so the pending state is observable. */
async function delayNavigationResponses(page: Page, delayMs: number): Promise<void> {
  await page.route(
    (url) => url.searchParams.has('_rsc'),
    async (route) => {
      if (route.request().headers()['next-router-prefetch'] !== '1') {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      await route.continue().catch(() => undefined);
    },
  );
}

async function currentTabs(page: Page): Promise<string[]> {
  return page
    .locator('[data-slot="site-nav"] a[aria-current="page"]')
    .evaluateAll((links) => links.map((link) => link.textContent ?? ''));
}

async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__navigationMarker = true;
  });
}

async function documentWasKept(page: Page): Promise<boolean> {
  return page.evaluate(() => window.__navigationMarker === true);
}

test.describe('navigation feedback', () => {
  test('shows the destination frame immediately and fills it when the page arrives', async ({
    page,
  }) => {
    await page.goto(`/?month=${month}`);
    await markDocument(page);
    await delayNavigationResponses(page, 1500);
    await page.getByRole('link', { name: '取引', exact: true }).click();

    expect(await currentTabs(page)).toEqual(['取引']);
    const frame = page.locator(navigationSkeleton);
    await expect(frame).toHaveCount(1);
    await expect(frame.locator('h1')).toHaveText(/取引/);
    // The body being replaced is hidden, so the frame is the only thing painted.
    await expect(
      page.locator('[data-slot="page-content"] h1').filter({ hasText: '概要' }),
    ).toBeHidden();

    const frameBox = await frame.locator('h1').boundingBox();

    await expect(page).toHaveURL(`/transactions?month=${month}`);
    const heading = page.getByRole('heading', { level: 1, name: /取引/ });
    await expect(heading).toBeVisible();
    await expect(frame).toHaveCount(0);
    // The frame holds the heading where the page puts it, so filling in does not move the layout.
    const headingBox = await heading.boundingBox();
    expect(Math.abs((frameBox?.y ?? 0) - (headingBox?.y ?? 0))).toBeLessThanOrEqual(1);
    expect(await documentWasKept(page)).toBe(true);
    expect(await currentTabs(page)).toEqual(['取引']);
    await expect(page.getByRole('link', { name: '取引', exact: true })).not.toHaveAttribute(
      'aria-busy',
    );
  });

  test('settles on the last tapped tab after rapid taps', async ({ page }) => {
    await page.goto(`/?month=${month}`);
    await markDocument(page);
    await delayNavigationResponses(page, 800);
    for (const name of ['取引', '残高', '概要', '取引', '残高']) {
      await page.getByRole('link', { name, exact: true }).click();
      expect(await currentTabs(page)).toEqual([name]);
    }
    await expect(page).toHaveURL(`/balances?month=${month}`);
    await expect(page.getByRole('heading', { level: 1, name: '残高' })).toBeVisible();
    await expect(page.locator(navigationSkeleton)).toHaveCount(0);
    expect(await currentTabs(page)).toEqual(['残高']);
    expect(await documentWasKept(page)).toBe(true);
  });

  test('returns to the open page when its tab is tapped again before the destination arrives', async ({
    page,
  }) => {
    await page.goto(`/?month=${month}`);
    await delayNavigationResponses(page, 1500);
    await page.getByRole('link', { name: '残高', exact: true }).click();
    expect(await currentTabs(page)).toEqual(['残高']);
    await page.getByRole('link', { name: '概要', exact: true }).click();
    expect(await currentTabs(page)).toEqual(['概要']);
    await expect(page.locator(navigationSkeleton)).toHaveCount(0);
    // The abandoned request to 残高 still resolves; it must not take over the page.
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(`/?month=${month}`);
    await expect(page.getByRole('heading', { level: 1, name: '概要' })).toBeVisible();
    expect(await currentTabs(page)).toEqual(['概要']);
  });

  test('drops the pending state when history moves before the destination arrives', async ({
    page,
  }) => {
    await page.goto(`/?month=${month}`);
    await page.getByRole('link', { name: '取引', exact: true }).click();
    await expect(page).toHaveURL(`/transactions?month=${month}`);
    await delayNavigationResponses(page, 1500);
    await page.getByRole('link', { name: '残高', exact: true }).click();
    expect(await currentTabs(page)).toEqual(['残高']);
    await page.goBack();
    await expect(page).toHaveURL(`/?month=${month}`);
    await expect(page.getByRole('heading', { level: 1, name: '概要' })).toBeVisible();
    await expect(page.locator(navigationSkeleton)).toHaveCount(0);
    expect(await currentTabs(page)).toEqual(['概要']);
  });

  test('retries a temporarily unavailable page instead of reloading the document', async ({
    page,
  }) => {
    await page.goto(`/?month=${month}`);
    await markDocument(page);
    let failures = 0;
    await page.route(
      (url) => url.pathname === '/transactions' && url.searchParams.has('_rsc'),
      async (route) => {
        if (route.request().headers()['next-router-prefetch'] !== '1' && failures < 1) {
          failures += 1;
          await route.fulfill({
            status: 503,
            contentType: 'text/html; charset=UTF-8',
            body: '<!DOCTYPE html><title>Worker exceeded resource limits</title>',
          });
          return;
        }
        await route.continue();
      },
    );
    await page.getByRole('link', { name: '取引', exact: true }).click();
    await expect(page).toHaveURL(`/transactions?month=${month}`);
    await expect(page.getByRole('heading', { level: 1, name: /取引/ })).toBeVisible();
    expect(failures).toBe(1);
    expect(await documentWasKept(page)).toBe(true);
  });

  test('settles on the final tab when tabs, brand, and settings are tapped together', async ({
    page,
    isMobile,
  }) => {
    await page.goto(`/?month=${month}`);
    await markDocument(page);
    await delayNavigationResponses(page, 500);
    for (const name of [
      // The first same-URL tap must be tracked too, rather than racing a Link refresh.
      'kobako 家計ノート ホーム',
      '取引',
      '設定',
      '残高',
      'kobako 家計ノート ホーム',
      '取引',
      '設定',
      '概要',
      'kobako 家計ノート ホーム',
      '取引',
      '残高',
    ]) {
      const link = page.getByRole('link', { name, exact: true });
      if (isMobile) await link.tap();
      else await link.click();
      await page.waitForTimeout(100);
    }
    await expect(page).toHaveURL(/\/balances(?:\?|$)/);
    await expect(page.getByRole('heading', { level: 1, name: '残高' })).toBeVisible();
    await expect(page.locator('[data-slot="site-nav"] a[data-pending]')).toHaveCount(0);
    expect(await currentTabs(page)).toEqual(['残高']);
    expect(await documentWasKept(page)).toBe(true);
  });
});
