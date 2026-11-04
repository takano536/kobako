import { expect, type Locator, type Page } from '@playwright/test';

/** 開いているアプリ内の月選択（`month-picker.tsx`）。 */
export function monthPickerPopover(page: Page): Locator {
  return page.getByRole('dialog', { name: '月を選択' });
}

/**
 * 表示部を押して月グリッドを開きます。ハイドレーション前の押下は何も起こさないため、開くまで押し直します。
 */
export async function openMonthPicker(page: Page, display: Locator, useTap: boolean) {
  const popover = monthPickerPopover(page);
  await expect(async () => {
    if ((await popover.count()) === 0) {
      await (useTap ? display.tap() : display.click());
    }
    await expect(popover).toBeVisible({ timeout: 2_000 });
  }).toPass();
}

/** 開いている月グリッドで、年を `target` の年まで送り、その月を選びます。 */
export async function pickMonthInGrid(page: Page, target: string, useTap: boolean) {
  const popover = monthPickerPopover(page);
  await expect(popover).toBeVisible();
  const press = (locator: Locator) => (useTap ? locator.tap() : locator.click());
  const targetYear = Number(target.slice(0, 4));
  const year = popover.locator('[data-slot="month-picker-year"]');
  for (let step = 0; step < 50; step += 1) {
    const shown = Number.parseInt(await year.innerText(), 10);
    if (shown === targetYear) break;
    await press(popover.getByRole('button', { name: shown > targetYear ? '前の年' : '次の年' }));
    await expect(year).not.toHaveText(`${shown}年`);
  }
  await expect(year).toHaveText(`${targetYear}年`);
  await press(popover.locator(`[data-slot="month-picker-month"][data-value="${target}"]`));
  await expect(popover).toHaveCount(0);
}
