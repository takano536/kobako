import { expect, test, type Locator, type Page } from '@playwright/test';

import { currentTokyoMonth } from '@kobako/db';

declare global {
  interface Window {
    /** テスト用に記録した `showPicker()` の呼び出し先（input の id）。 */
    pickerOpens?: string[];
    /** Android のラベル既定動作による日付 input のクリック。 */
    dateActivations?: string[];
  }
}

const month = currentTokyoMonth();

const openedPickers = (page: Page) =>
  page.evaluate(() => (window.pickerOpens ?? []).length + (window.dateActivations ?? []).length);

const tap = (isMobile: boolean, locator: Locator, position?: { x: number; y: number }) =>
  isMobile ? locator.tap({ position }) : locator.click({ position });

test.describe('select dismiss taps', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // ヘッドレスでは実際のピッカーを観測できないため、呼び出しと input 起動だけを記録します。
      HTMLInputElement.prototype.showPicker = function showPicker(this: HTMLInputElement) {
        window.pickerOpens = [...(window.pickerOpens ?? []), this.id];
      };
      document.addEventListener(
        'click',
        (event) => {
          const target = event.target;
          if (target instanceof HTMLInputElement && target.id === 'transaction-date') {
            window.dateActivations = [...(window.dateActivations ?? []), target.id];
          }
        },
        true,
      );
    });
    await page.goto(`/transactions/new?month=${month}`);
    await expect(page.locator('#transaction-account')).toBeVisible();
    await expect(page.locator('[data-slot="date-picker-display"]')).toBeVisible();
  });

  test('discards only the tap that dismisses a select dialog on Android', async ({
    page,
    isMobile,
  }) => {
    const accountSelect = page.locator('#transaction-account');
    const dateLabel = page.locator('#transaction-date-label');
    const dateDisplay = page.locator('[data-slot="date-picker-display"]');

    await accountSelect.focus();
    const beforeDisplay = await openedPickers(page);
    await tap(isMobile, dateDisplay);
    expect(await openedPickers(page)).toBe(beforeDisplay + (isMobile ? 0 : 1));
    if (isMobile) {
      await tap(isMobile, dateDisplay);
      expect(await openedPickers(page)).toBe(beforeDisplay + 1);
    }

    await accountSelect.focus();
    const beforeLabel = await openedPickers(page);
    await tap(isMobile, dateLabel, { x: 8, y: 8 });
    expect(await openedPickers(page)).toBe(beforeLabel + (isMobile ? 0 : 1));
    if (isMobile) {
      await tap(isMobile, dateLabel, { x: 8, y: 8 });
      expect(await openedPickers(page)).toBe(beforeLabel + 1);
    }
  });

  test('does not change the page with the tap that dismisses a select dialog', async ({
    page,
    isMobile,
  }) => {
    const startUrl = page.url();
    const mainHtml = await page.locator('main').innerHTML();
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });
    const dateDisplay = page.locator('[data-slot="date-picker-display"]');
    await page.locator('#transaction-account').focus();
    await tap(isMobile, dateDisplay);
    expect(navigations).toBe(0);
    expect(page.url()).toBe(startUrl);
    expect(await page.locator('main').innerHTML()).toBe(mainHtml);
    if (isMobile) {
      expect(await openedPickers(page)).toBe(0);
      await tap(isMobile, dateDisplay);
      expect(await openedPickers(page)).toBe(1);
    }
  });

  test('discards the dismiss tap after a select change, then lets the next tap through', async ({
    page,
    isMobile,
  }) => {
    const categorySelect = page.locator('#transaction-category-expense');
    const dateDisplay = page.locator('[data-slot="date-picker-display"]');
    await categorySelect.selectOption({ index: 1 });
    const before = await openedPickers(page);
    await tap(isMobile, dateDisplay);
    expect(await openedPickers(page)).toBe(before + 1);
  });

  test('discards the dismiss tap even when the select never received focus (Firefox order)', async ({
    page,
    isMobile,
  }) => {
    const accountSelect = page.locator('#transaction-account');
    const dateLabel = page.locator('#transaction-date-label');
    const dateDisplay = page.locator('[data-slot="date-picker-display"]');
    // 月スイッチャーのスコープは単体テストで確認するため、ここでは取引登録画面だけを扱います。
    const armWithPointerDown = async () => {
      await accountSelect.dispatchEvent('pointerdown', { bubbles: true, pointerType: 'touch' });
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('SELECT');
    };
    for (const target of [dateLabel, dateDisplay]) {
      await armWithPointerDown();
      const before = await openedPickers(page);
      await tap(isMobile, target, { x: 8, y: 8 });
      expect(await openedPickers(page)).toBe(before + (isMobile ? 0 : 1));
      if (isMobile) {
        await tap(isMobile, target, { x: 8, y: 8 });
        expect(await openedPickers(page)).toBe(before + 1);
      }
    }
  });

  test('discards pointerup and click of the dismiss gesture, then lets the next tap through', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'The guard is installed only on Android touch devices.');
    const dateDisplay = page.locator('[data-slot="date-picker-display"]');
    await page.locator('#transaction-account').dispatchEvent('pointerdown', {
      bubbles: true,
      pointerType: 'touch',
    });
    const prevented = await dateDisplay.evaluate((display) => {
      const init = { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true };
      const down = new PointerEvent('pointerdown', init);
      const up = new PointerEvent('pointerup', init);
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      display.dispatchEvent(down);
      display.dispatchEvent(up);
      display.dispatchEvent(click);
      return {
        pointerdown: down.defaultPrevented,
        pointerup: up.defaultPrevented,
        click: click.defaultPrevented,
      };
    });
    expect(prevented).toEqual({ pointerdown: true, pointerup: true, click: true });
    await dateDisplay.tap();
    expect(await openedPickers(page)).toBe(1);
  });
});

test('shows the tap debug log only with ?tap-debug=1', async ({ page, isMobile }) => {
  const typeTrigger = page
    .locator('[data-slot="filter-chip"][data-filter="type"]')
    .getByRole('button', { name: '種別', exact: true });
  const headerMonth = page.locator('[data-slot="month-switcher-label"]');
  await page.goto(`/transactions?month=${month}`);
  await expect(typeTrigger).toBeVisible();
  await expect(page.locator('[data-slot="tap-debug"]')).toHaveCount(0);

  await page.goto(`/transactions?month=${month}&tap-debug=1`);
  const log = page.locator('[data-slot="tap-debug"]');
  await expect(log).toBeVisible();
  if (isMobile) await typeTrigger.tap();
  else await typeTrigger.click();
  await expect(log).toContainText('pointerdown');
  await expect(log).toContainText(/click .* dp=false active=/);
  // タッチでは touchstart、マウスでは mouseup の行が出ます。
  await expect(log).toContainText(isMobile ? /touchstart .* dp=/ : /mouseup .* dp=/);

  if (isMobile) await headerMonth.tap();
  else await headerMonth.click();
  await expect(page.locator('[data-slot="month-picker-popover"]')).toBeVisible();
  await expect(log).toContainText(
    isMobile ? /touchstart button\[month-switcher-label\]/ : /click button\[month-switcher-label\]/,
  );
  await expect(log).not.toContainText('showPicker');
});
