import { expect, test } from '@playwright/test';

import { currentTokyoMonth } from '@kobako/db';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test('compensates and restores classic scrollbar width for an overlay card', async ({
  page,
}, testInfo) => {
  testInfo.skip(testInfo.project.name === 'mobile', 'Mobile emulation uses overlay scrollbars');
  const month = currentTokyoMonth();
  await page.goto(`/transactions?month=${month}`);
  await page.evaluate(() => {
    document.body.style.minHeight = '200vh';
    void document.body.offsetHeight;
    window.scrollTo(0, 0);
  });
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
      scrollbarWidth: window.innerWidth - document.documentElement.clientWidth,
      htmlOverflow: document.documentElement.style.overflow,
      bodyPaddingRight: document.body.style.paddingRight,
      computedBodyPaddingRight:
        Number.parseFloat(getComputedStyle(document.body).paddingRight) || 0,
    };
  });
  expect(before.scrollbarWidth).toBeGreaterThan(0);
  testInfo.annotations.push({
    type: 'scrollbar-width',
    description: `measured ${before.scrollbarWidth}px`,
  });
  const entry = page.getByRole('link', { name: '取引を登録', exact: true }).first();
  await entry.click();
  await expect(page.locator('#entry-dialog[data-card-kind="transaction"]')).toBeVisible();
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
  for (const name of Object.keys(before.geometry)) {
    const beforeGeometry = before.geometry[name];
    const openGeometry = open.geometry[name];
    if (!beforeGeometry || !openGeometry) throw new Error(`missing geometry for ${name}`);
    expect(Math.abs(openGeometry.x - beforeGeometry.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(openGeometry.width - beforeGeometry.width)).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await expect(page.locator('#entry-dialog')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        htmlOverflow: document.documentElement.style.overflow,
        bodyPaddingRight: document.body.style.paddingRight,
      })),
    )
    .toEqual({
      htmlOverflow: before.htmlOverflow,
      bodyPaddingRight: before.bodyPaddingRight,
    });
});
