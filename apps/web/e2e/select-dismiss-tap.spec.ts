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
 * 月欄のピッカーが開いたかどうか。ラベル経由（Android では表示部も）ではネイティブの月 input に
 * フォーカスが移り、デスクトップの表示部経由では `showPicker()` が呼ばれます。
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

    // 「YYYY/MM」の表示部でも同じです。Android はラベルの既定動作で input を起動し（showPicker() は
    // 呼ばない）、デスクトップは showPicker() で開きます。
    await blur();
    await typeSelect.focus();
    await tapDisplay();
    expect(await monthPickerState(page)).toEqual(
      isMobile ? { focused: false, showPickerCalls: 0 } : { focused: false, showPickerCalls: 1 },
    );
    if (isMobile) {
      await tapDisplay();
      expect(await monthPickerState(page)).toEqual({ focused: true, showPickerCalls: 0 });
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

    // ヘッダーの月ラベル（月スイッチャー）。Android はラベルの既定動作で隠れた input を起動し
    // （showPicker() は呼ばない）、デスクトップは showPicker() で開きます。
    const headerMonth = page.locator('[data-slot="month-switcher-label"]').first();
    const headerInputFocused = () =>
      page.evaluate(
        () =>
          document.activeElement ===
          document.querySelector('[data-slot="month-switcher"] input[type="month"]'),
      );
    const callsBefore = await pickerCalls();
    await armWithPointerDown(headerMonth);
    await tapOn(headerMonth);
    expect(await pickerCalls()).toBe(callsBefore + (isMobile ? 0 : 1));
    expect(await headerInputFocused()).toBe(false);
    if (isMobile) {
      await tapOn(headerMonth);
      expect(await pickerCalls()).toBe(callsBefore);
      expect(await headerInputFocused()).toBe(true);
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
    expect(await monthPickerState(page)).toEqual({ focused: false, showPickerCalls: 0 });

    await monthLabel.tap({ position: { x: 8, y: 8 } });
    expect((await monthPickerState(page)).focused).toBe(true);
  });
});

test('opens the header month picker through the label on Android without showPicker()', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Desktop keeps opening the picker with showPicker().');
  await page.addInitScript(() => {
    const original = HTMLInputElement.prototype.showPicker;
    HTMLInputElement.prototype.showPicker = function showPicker(this: HTMLInputElement) {
      window.pickerOpens = [...(window.pickerOpens ?? []), this.id];
      return original.call(this);
    };
  });
  await page.goto(`/transactions?month=${month}`);
  await page.getByText('条件を変更する', { exact: true }).click();
  await expect(page.locator('[data-slot="month-picker-display"]')).toBeVisible();

  const headerInput = page.locator('[data-slot="month-switcher"] input[type="month"]');
  await page.locator('[data-slot="month-switcher-label"]').tap();
  await expect(headerInput).toBeFocused();
  expect(await page.evaluate(() => window.pickerOpens ?? [])).toEqual([]);
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

  // JS からの showPicker() 呼び出しは、呼ばれたときだけ行が出ます（Android はラベルの既定動作で開くため出ない）。
  if (isMobile) await headerMonth.tap();
  else await headerMonth.click();
  if (isMobile) {
    await expect(log).toContainText(/touchstart label\[month-switcher-label\]/);
    await expect(log).not.toContainText('showPicker');
  } else {
    await expect(log).toContainText(/showPicker target=input.* active=/);
  }
});
