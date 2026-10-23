import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'kobako-theme';
const LIGHT_PAPER = 'rgb(252, 252, 248)';
const DARK_PAPER = 'rgb(26, 31, 28)';

async function themeState(page: Page) {
  return page.evaluate(() => {
    const metas = Array.from(
      document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
    );
    return {
      theme: document.documentElement.dataset.theme,
      colorScheme: document.documentElement.style.colorScheme,
      background: getComputedStyle(document.body).backgroundColor,
      // The browser uses the first theme-color meta whose media matches.
      themeColor: metas.find((meta) => !meta.media || matchMedia(meta.media).matches)?.content,
    };
  });
}

async function expectTheme(page: Page, theme: 'light' | 'dark') {
  const paper = theme === 'dark' ? DARK_PAPER : LIGHT_PAPER;
  const color = theme === 'dark' ? '#1a1f1c' : '#fcfcf8';
  await expect
    .poll(() => themeState(page))
    .toEqual({
      theme,
      colorScheme: theme,
      background: paper,
      themeColor: color,
    });
}

function storeTheme(page: Page, value: string) {
  return page.addInitScript(([key, stored]) => window.localStorage.setItem(key, stored), [
    STORAGE_KEY,
    value,
  ] as const);
}

function appearanceOption(page: Page, name: string) {
  return page.getByRole('radiogroup', { name: '外観' }).getByRole('radio', { name });
}

test.describe('テーマ', () => {
  test('未選択では OS の設定に従い、OS の切り替えに即時追従する', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/settings');
    await expectTheme(page, 'dark');
    await expect(appearanceOption(page, 'システムに合わせる')).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await page.emulateMedia({ colorScheme: 'light' });
    await expectTheme(page, 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(page, 'dark');
  });

  test('明示した選択は OS より優先され、再読み込み後も残り、システムで OS 追従に戻る', async ({
    page,
  }) => {
    const hydrationErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /hydrat|#418|#423|#425/i.test(message.text())) {
        hydrationErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => hydrationErrors.push(error.message));
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/settings');
    await appearanceOption(page, 'ライト').click();
    await expectTheme(page, 'light');
    await expect(appearanceOption(page, 'ライト')).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe('light');

    await page.reload();
    await expectTheme(page, 'light');
    await expect(appearanceOption(page, 'ライト')).toHaveAttribute('aria-checked', 'true');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(page, 'light');

    await page.getByRole('link', { name: '概要' }).first().click();
    await expect(page).toHaveURL(/\/(\?|$)/);
    await expectTheme(page, 'light');
    await page.goBack();

    await appearanceOption(page, 'システムに合わせる').click();
    await expectTheme(page, 'dark');
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
    await page.emulateMedia({ colorScheme: 'light' });
    await expectTheme(page, 'light');
    expect(hydrationErrors).toEqual([]);
  });

  test('ダークを保存していると最初の描画から暗い背景になる', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await storeTheme(page, 'dark');
    await page.addInitScript(() => {
      requestAnimationFrame(() => {
        const root = document.documentElement;
        Reflect.set(window, 'firstFrame', {
          theme: root.dataset.theme,
          background: getComputedStyle(document.body ?? root).backgroundColor,
        });
      });
    });
    // Without any external JavaScript, only the inline head script can set the theme.
    await page.route('**/_next/static/**/*.js', (route) => route.abort());
    await page.goto('/');
    expect(await page.evaluate(() => Reflect.get(window, 'firstFrame'))).toEqual({
      theme: 'dark',
      background: DARK_PAPER,
    });
    await expectTheme(page, 'dark');
  });

  test('壊れた保存値と使えない localStorage はシステム追従にフォールバックする', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await storeTheme(page, 'sepia');
    await page.goto('/settings');
    await expectTheme(page, 'dark');
    await expect(appearanceOption(page, 'システムに合わせる')).toHaveAttribute(
      'aria-checked',
      'true',
    );

    const blocked = await page.context().newPage();
    const errors: string[] = [];
    blocked.on('pageerror', (error) => errors.push(error.message));
    await blocked.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    });
    await blocked.emulateMedia({ colorScheme: 'light' });
    await blocked.goto('/settings');
    await expectTheme(blocked, 'light');
    await blocked.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(blocked, 'dark');
    await appearanceOption(blocked, 'ライト').click();
    await expectTheme(blocked, 'light');
    await expect(appearanceOption(blocked, 'ライト')).toHaveAttribute('aria-checked', 'true');
    await blocked.emulateMedia({ colorScheme: 'light' });
    await blocked.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(blocked, 'light');
    expect(errors).toEqual([]);
  });

  test('外観はキーボードだけで選べるラジオグループになっている', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/settings');
    const group = page.getByRole('radiogroup', { name: '外観' });
    await expect(group.getByRole('radio')).toHaveCount(3);
    const system = appearanceOption(page, 'システムに合わせる');
    const dark = appearanceOption(page, 'ダーク');
    await expect(system).toHaveAttribute('aria-checked', 'true');
    await expect(system).toHaveAccessibleDescription('端末の設定に従います');
    await expect(system).toHaveAttribute('tabindex', '0');
    await expect(dark).toHaveAttribute('tabindex', '-1');

    await system.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(dark).toBeFocused();
    await expect(dark).toHaveAttribute('aria-checked', 'false');
    await expectTheme(page, 'light');
    expect(
      await dark.evaluate((element) => {
        const style = getComputedStyle(element);
        return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2;
      }),
    ).toBe(true);

    await page.keyboard.press('Enter');
    await expect(dark).toHaveAttribute('aria-checked', 'true');
    await expect(system).toHaveAttribute('aria-checked', 'false');
    await expectTheme(page, 'dark');

    await page.keyboard.press('ArrowRight');
    await expect(system).toBeFocused();
    await page.keyboard.press('Space');
    await expect(system).toHaveAttribute('aria-checked', 'true');
    await expectTheme(page, 'light');

    await page.keyboard.press('Home');
    await expect(appearanceOption(page, 'ライト')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(system).toBeFocused();

    for (const radio of await group.getByRole('radio').all()) {
      const box = await radio.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
  });

  for (const width of [390, 320]) {
    test(`外観セクションは ${width}px 幅で横スクロールを出さない`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await storeTheme(page, 'dark');
      await page.goto('/settings');
      await expect(appearanceOption(page, 'ダーク')).toHaveAttribute('aria-checked', 'true');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
    });
  }

  test('ダークでは主要画面に明るい背景が残らない', async ({ page }) => {
    await storeTheme(page, 'dark');
    for (const path of [
      '/',
      '/transactions',
      '/balances',
      '/settings',
      '/transactions/new',
      '/settings/import',
      '/settings/categories/expense',
      '/settings/delete',
      '/not-found-theme-check',
    ]) {
      await page.goto(path);
      await expectTheme(page, 'dark');
      const brightSurfaces = await page.evaluate(() => {
        function luminance(color: string): number | null {
          const match = color.match(/^rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)$/);
          if (!match || Number(match[4] ?? 1) < 0.5) return null;
          const [r, g, b] = match.slice(1, 4).map((channel) => {
            const value = Number(channel) / 255;
            return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        }
        return Array.from(document.querySelectorAll<HTMLElement>('body *'))
          .filter((element) => !element.closest('[aria-hidden="true"]'))
          .filter((element) => element.getClientRects().length > 0)
          .filter((element) => {
            const style = getComputedStyle(element);
            const background = luminance(style.backgroundColor);
            // Filled buttons use light fills with dark ink text in the dark theme.
            const text = luminance(style.color);
            const filledControl = text !== null && text < 0.05;
            return background !== null && background > 0.25 && !filledControl;
          })
          .map((element) => `${element.tagName.toLowerCase()}.${element.className}`);
      });
      expect(brightSurfaces, path).toEqual([]);
    }
  });
});
