import { expect, test, type Locator, type Page } from '@playwright/test';

const month = '2024-06';
const sectionLabels = ['概要', '取引', '残高'] as const;

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

async function expectNavigationLayout(page: Page, width: number): Promise<void> {
  const nav = page.locator('.site-nav');
  await expect(nav).toHaveCount(1);
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link')).toHaveCount(3);
  await expect(page.locator('.site-nav .nav-add')).toHaveCount(0);
  expect((await nav.textContent()) ?? '').not.toContain('＋');

  const geometry = await page.evaluate(() => {
    const navElement = document.querySelector<HTMLElement>('.site-nav');
    const headerElement = document.querySelector<HTMLElement>('.site-header');
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
  const navBox = await page.locator('.site-nav').boundingBox();
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
      await expect(page.locator('.brand')).toBeVisible();
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
          '.site-header .header-inner > .brand, .site-header .header-inner > .site-settings',
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

  test('maps child and account routes to their parent section', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const cases = [
      { path: `/transactions/new?month=${month}`, section: '取引' },
      { path: `/transactions/2147483648/edit?month=${month}`, section: '取引' },
      { path: `/accounts/new?month=${month}`, section: '残高' },
      { path: '/accounts/2147483648/edit', section: '取引' },
      {
        path: `/accounts/2147483648/edit?return=${encodeURIComponent('/transactions?month=2024-06')}`,
        section: '取引',
      },
    ] as const;

    for (const target of cases) {
      await page.goto(target.path);
      await expect(page.locator('.site-nav a[aria-current="page"]')).toHaveCount(1);
      await expect(page.getByRole('link', { name: target.section, exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      for (const label of sectionLabels) {
        if (label === target.section) continue;
        await expect(page.getByRole('link', { name: label, exact: true })).not.toHaveAttribute(
          'aria-current',
          'page',
        );
      }
    }

    for (const path of ['/settings', '/settings/categories/expense']) {
      await page.goto(path);
      await expect(page.locator('.site-settings[aria-current="page"]')).toHaveCount(1);
      await expect(page.locator('.site-nav a[aria-current="page"]')).toHaveCount(0);
      for (const label of sectionLabels) {
        await expect(page.getByRole('link', { name: label, exact: true })).not.toHaveAttribute(
          'aria-current',
          'page',
        );
      }
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
    const lastSettingRow = page.locator('.settings-list-rows .action-link').last();
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
    const nav = page.locator('.site-nav');
    await expect(nav).toBeVisible();
    await page.getByLabel('金額').focus();
    await expect(nav).toBeHidden();
    await expect(page.getByRole('button', { name: '登録する', exact: true })).toBeVisible();
  });
});
