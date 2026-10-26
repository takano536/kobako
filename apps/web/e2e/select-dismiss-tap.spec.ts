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
 * 月グリッド（アプリ内の月選択）が開いているかと、ネイティブのピッカー（`showPicker()`）の呼び出し回数。
 * 月はアプリ内の月グリッドで選ぶため、`showPicker()` はどの端末でも呼ばれません。
 */
const monthPickerState = (page: Page) =>
  page.evaluate(() => ({
    open: document.querySelector('[data-slot="month-picker-popover"]') !== null,
    showPickerCalls: (window.pickerOpens ?? []).length,
  }));

const closeMonthPicker = async (page: Page) => {
  const popover = page.locator('[data-slot="month-picker-popover"]');
  if ((await popover.count()) === 0) return;
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
};

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

    // 「月」の見出し文字: 閉じるタップは捨て、次のタップで開きます。デスクトップは1回目で開きます。
    await typeSelect.focus();
    await tapLabelText();
    expect(await monthPickerState(page)).toEqual({ open: !isMobile, showPickerCalls: 0 });
    if (isMobile) {
      await tapLabelText();
      expect(await monthPickerState(page)).toEqual({ open: true, showPickerCalls: 0 });
    }

    // 「YYYY/MM」の表示部でも同じです。
    await closeMonthPicker(page);
    await typeSelect.focus();
    await tapDisplay();
    expect(await monthPickerState(page)).toEqual({ open: !isMobile, showPickerCalls: 0 });
    if (isMobile) {
      await tapDisplay();
      expect(await monthPickerState(page)).toEqual({ open: true, showPickerCalls: 0 });
    }

    // 値を選んだ（change）後は、1回目のタップで開きます。
    await closeMonthPicker(page);
    await typeSelect.focus();
    await typeSelect.selectOption('income');
    await tapLabelText();
    expect((await monthPickerState(page)).open).toBe(true);
  });

  test('does not apply a filter with the tap that dismisses a select dialog on Android', async ({
    page,
    isMobile,
  }) => {
    const startUrl = page.url();
    const mainHtml = await page.locator('main').innerHTML();
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });
    // 送信ボタンはないので、同じ位置にある実在の操作要素（APIのみのスイッチ）を狙います。
    const toggle = page.locator('[data-slot="filter-form"] [role="switch"]');
    const tapToggle = () => (isMobile ? toggle.tap() : toggle.click());

    await page.locator('select[name="type"]').focus();
    await tapToggle();
    if (isMobile) {
      await page.waitForTimeout(500);
      expect(navigations).toBe(0);
      expect(page.url()).toBe(startUrl);
      expect(await page.locator('main').innerHTML()).toBe(mainHtml);
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      // 直後の本物のタップは通します。
      await tapToggle();
    }
    await expect(page).toHaveURL(/[?&]origin=api/);
  });

  test('discards the dismiss tap even when the select never received focus (Firefox order)', async ({
    page,
    isMobile,
  }) => {
    const typeSelect = page.locator('select[name="type"]');
    // `focus()` を使わず、select に `pointerdown` だけを届けます（`focusin` なし、フォーカスは body）。
    const armWithPointerDown = async (next: Locator) => {
      await next.scrollIntoViewIfNeeded();
      await typeSelect.dispatchEvent('pointerdown', { bubbles: true, pointerType: 'touch' });
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('SELECT');
    };
    const tapOn = (locator: Locator, position?: { x: number; y: number }) =>
      isMobile ? locator.tap({ position }) : locator.click({ position });

    // 「月」の見出し文字。
    const monthLabel = page.locator('#filter-month-label');
    await armWithPointerDown(monthLabel);
    await tapOn(monthLabel, { x: 8, y: 8 });
    expect(await monthPickerState(page)).toEqual({ open: !isMobile, showPickerCalls: 0 });
    if (isMobile) {
      await tapOn(monthLabel, { x: 8, y: 8 });
      expect(await monthPickerState(page)).toEqual({ open: true, showPickerCalls: 0 });
    }

    // ヘッダーの月ラベル（月スイッチャー）。select への pointerdown は外側のタップなので、
    // 開いている月グリッドはここで閉じます。
    const headerMonth = page.locator('[data-slot="month-switcher-label"]').first();
    await armWithPointerDown(headerMonth);
    expect((await monthPickerState(page)).open).toBe(false);
    await tapOn(headerMonth);
    expect(await monthPickerState(page)).toEqual({ open: !isMobile, showPickerCalls: 0 });
    if (isMobile) {
      await tapOn(headerMonth);
      expect(await monthPickerState(page)).toEqual({ open: true, showPickerCalls: 0 });
    }
    await closeMonthPicker(page);

    // APIのみのスイッチ。
    const startUrl = page.url();
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });
    const toggle = page.locator('[data-slot="filter-form"] [role="switch"]');
    await armWithPointerDown(toggle);
    await tapOn(toggle);
    if (isMobile) {
      await page.waitForTimeout(500);
      expect(navigations).toBe(0);
      expect(page.url()).toBe(startUrl);
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await tapOn(toggle);
    }
    await expect(page).toHaveURL(/[?&]origin=api/);
  });

  test('discards pointerup and click of the dismiss gesture, then lets the next tap through', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'The guard is installed only on Android touch devices.');
    const monthLabel = page.locator('#filter-month-label');
    await page.locator('select[name="type"]').dispatchEvent('pointerdown', {
      bubbles: true,
      pointerType: 'touch',
    });
    // 閉じるタップを pointerdown → pointerup → click の順で再現し、それぞれの defaultPrevented を読みます。
    const prevented = await monthLabel.evaluate((label) => {
      const init = { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true };
      const down = new PointerEvent('pointerdown', init);
      const up = new PointerEvent('pointerup', init);
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      label.dispatchEvent(down);
      label.dispatchEvent(up);
      label.dispatchEvent(click);
      return {
        pointerdown: down.defaultPrevented,
        pointerup: up.defaultPrevented,
        click: click.defaultPrevented,
      };
    });
    expect(prevented).toEqual({ pointerdown: true, pointerup: true, click: true });
    expect(await monthPickerState(page)).toEqual({ open: false, showPickerCalls: 0 });

    await monthLabel.tap({ position: { x: 8, y: 8 } });
    expect((await monthPickerState(page)).open).toBe(true);
  });
});

test('shows the tap debug log only with ?tap-debug=1', async ({ page, isMobile }) => {
  const summary = page.getByText('条件を変更する', { exact: true });
  const headerMonth = page.locator('[data-slot="month-switcher-label"]');
  await page.goto(`/transactions?month=${month}`);
  await summary.click();
  // ハイドレーション（effect の実行）後でも、パラメータが無ければログは出ません。
  await expect(page.locator('[data-slot="month-picker-display"]')).toBeVisible();
  await expect(page.locator('[data-slot="tap-debug"]')).toHaveCount(0);

  await page.goto(`/transactions?month=${month}&tap-debug=1`);
  const log = page.locator('[data-slot="tap-debug"]');
  await expect(log).toBeVisible();
  if (isMobile) await summary.tap();
  else await summary.click();
  await expect(log).toContainText('pointerdown');
  await expect(log).toContainText(/click .* dp=false active=/);
  // タッチでは touchstart、マウスでは mouseup の行が出ます。
  await expect(log).toContainText(isMobile ? /touchstart .* dp=/ : /mouseup .* dp=/);

  // 月はアプリ内の月グリッドで開くため、ヘッダーの月を押しても showPicker 行は出ません。
  await expect(page.locator('[data-slot="month-picker-display"]')).toBeVisible();
  if (isMobile) await headerMonth.tap();
  else await headerMonth.click();
  await expect(page.locator('[data-slot="month-picker-popover"]')).toBeVisible();
  await expect(log).toContainText(
    isMobile ? /touchstart button\[month-switcher-label\]/ : /click button\[month-switcher-label\]/,
  );
  await expect(log).not.toContainText('showPicker');
});
