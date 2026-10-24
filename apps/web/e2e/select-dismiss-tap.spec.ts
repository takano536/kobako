import { expect, test, type Locator, type Page } from '@playwright/test';

import { currentTokyoMonth } from '@kobako/db';

declare global {
  interface Window {
    /** テスト用に記録した `showPicker()` の呼び出し先（input の id）。 */
    pickerOpens?: string[];
  }
}

const month = currentTokyoMonth();

/**
 * 月欄のピッカーが開いたかどうか。ラベル経由ではネイティブの月 input にフォーカスが移り、
 * 表示ボタン経由では `showPicker()` が呼ばれます。
 */
const monthPickerState = (page: Page) =>
  page.evaluate(() => ({
    focused: document.activeElement?.id === 'filter-month',
    showPickerCalls: (window.pickerOpens ?? []).filter((id) => id === 'filter-month').length,
  }));

test.describe('select dismiss taps', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // ヘッドレスでは実際のピッカーを観測できないため、呼び出しだけを記録します。
      HTMLInputElement.prototype.showPicker = function showPicker(this: HTMLInputElement) {
        window.pickerOpens = [...(window.pickerOpens ?? []), this.id];
      };
    });
    await page.goto(`/transactions?month=${month}`);
    await page.getByText('条件を変更する', { exact: true }).click();
    // 月欄の表示ボタンはハイドレーション後の effect で現れます。ルートレイアウトのガードは
    // それまでに取り付けられているため、これを待ってから操作します。
    await expect(page.locator('[data-slot="month-picker-display"]')).toBeVisible();
  });

  test('discards only the tap that dismisses a select dialog on Android', async ({
    page,
    isMobile,
  }) => {
    const typeSelect = page.locator('select[name="type"]');
    const monthLabel = page.locator('#filter-month-label');
    const monthDisplay = page.locator('[data-slot="month-picker-display"]');
    await expect(monthDisplay).toHaveText(`${month.slice(0, 4)}/${month.slice(5)}`);
    const tapLabelText = () =>
      isMobile
        ? monthLabel.tap({ position: { x: 8, y: 8 } })
        : monthLabel.click({ position: { x: 8, y: 8 } });
    const tapDisplay = () => (isMobile ? monthDisplay.tap() : monthDisplay.click());
    const blur = () =>
      page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });

    // 「月」の見出し文字: 閉じるタップは捨て、次のタップで開きます。デスクトップは1回目で開きます。
    await typeSelect.focus();
    await tapLabelText();
    expect(await monthPickerState(page)).toEqual({ focused: !isMobile, showPickerCalls: 0 });
    if (isMobile) {
      await tapLabelText();
      expect(await monthPickerState(page)).toEqual({ focused: true, showPickerCalls: 0 });
    }

    // 「YYYY/MM」の表示ボタンでも同じです。
    await blur();
    await typeSelect.focus();
    await tapDisplay();
    expect((await monthPickerState(page)).showPickerCalls).toBe(isMobile ? 0 : 1);
    if (isMobile) {
      await tapDisplay();
      expect((await monthPickerState(page)).showPickerCalls).toBe(1);
    }

    // 値を選んだ（change）後は、1回目のタップで開きます。
    await blur();
    await typeSelect.focus();
    await typeSelect.selectOption('income');
    await tapLabelText();
    expect((await monthPickerState(page)).focused).toBe(true);
  });

  test('does not submit the filter with the tap that dismisses a select dialog on Android', async ({
    page,
    isMobile,
  }) => {
    const startUrl = page.url();
    const mainHtml = await page.locator('main').innerHTML();
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });
    const apply = page.getByRole('button', { name: '適用', exact: true });
    const tapApply = () => (isMobile ? apply.tap() : apply.click());

    await page.locator('select[name="type"]').focus();
    await tapApply();
    if (isMobile) {
      await page.waitForTimeout(500);
      expect(navigations).toBe(0);
      expect(page.url()).toBe(startUrl);
      expect(await page.locator('main').innerHTML()).toBe(mainHtml);
      // 直後の本物のタップは通します。
      await tapApply();
    }
    await expect(page).toHaveURL(/[?&]type=(&|$)/);
  });

  test('discards the dismiss tap even when the select never received focus (Firefox order)', async ({
    page,
    isMobile,
  }) => {
    const typeSelect = page.locator('select[name="type"]');
    // `focus()` を使わず、select に `pointerdown` だけを届けます（`focusin` なし、フォーカスは body）。
    const armWithPointerDown = async (next: Locator) => {
      // 先に表示位置へ動かしておきます（ページのスクロールは待機を解除するため）。
      await next.scrollIntoViewIfNeeded();
      await typeSelect.dispatchEvent('pointerdown', { bubbles: true, pointerType: 'touch' });
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('SELECT');
    };
    const tapOn = (locator: Locator, position?: { x: number; y: number }) =>
      isMobile ? locator.tap({ position }) : locator.click({ position });
    const pickerCalls = () => page.evaluate(() => (window.pickerOpens ?? []).length);

    // 「月」の見出し文字。
    const monthLabel = page.locator('#filter-month-label');
    await armWithPointerDown(monthLabel);
    await tapOn(monthLabel, { x: 8, y: 8 });
    expect(await monthPickerState(page)).toEqual({ focused: !isMobile, showPickerCalls: 0 });
    if (isMobile) {
      await tapOn(monthLabel, { x: 8, y: 8 });
      expect((await monthPickerState(page)).focused).toBe(true);
    }

    // ヘッダーの月ラベル（月スイッチャー）。
    const headerMonth = page.locator('[data-slot="month-switcher-label"]').first();
    const callsBefore = await pickerCalls();
    await armWithPointerDown(headerMonth);
    await tapOn(headerMonth);
    expect(await pickerCalls()).toBe(callsBefore + (isMobile ? 0 : 1));
    if (isMobile) {
      await tapOn(headerMonth);
      expect(await pickerCalls()).toBe(callsBefore + 1);
    }

    // 「適用」。
    const startUrl = page.url();
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });
    const apply = page.getByRole('button', { name: '適用', exact: true });
    await armWithPointerDown(apply);
    await tapOn(apply);
    if (isMobile) {
      await page.waitForTimeout(500);
      expect(navigations).toBe(0);
      expect(page.url()).toBe(startUrl);
      await tapOn(apply);
    }
    await expect(page).toHaveURL(/[?&]type=(&|$)/);
  });
});
