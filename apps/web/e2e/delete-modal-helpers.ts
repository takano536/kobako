import { expect, type Locator, type Page } from '@playwright/test';

export type ModalViewport = { width: number; height: number };

type Rectangle = {
  x: number;
  y: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

async function getRectangle(locator: Locator): Promise<Rectangle> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  });
}

export async function assertDeleteAndSaveAligned(page: Page): Promise<void> {
  const saveButton = page.getByRole('button', { name: '変更を保存' });
  const deleteTrigger = page.locator('.delete-confirm > summary');
  const [saveRect, deleteRect] = await Promise.all([
    getRectangle(saveButton),
    getRectangle(deleteTrigger),
  ]);
  expect(deleteRect.top).toBeCloseTo(saveRect.top, 1);
  expect(deleteRect.bottom).toBeCloseTo(saveRect.bottom, 1);
  expect(deleteRect.height).toBeCloseTo(saveRect.height, 1);
}

export async function assertDeleteModalGeometry(
  page: Page,
  viewport: ModalViewport,
): Promise<void> {
  const panel = page.locator('.delete-confirmation');
  const backdrop = page.locator('.delete-modal-backdrop');
  const [panelRect, backdropRect, panelPosition, backdropPosition, backgroundColor] =
    await Promise.all([
      getRectangle(panel),
      getRectangle(backdrop),
      panel.evaluate((element) => getComputedStyle(element).position),
      backdrop.evaluate((element) => getComputedStyle(element).position),
      backdrop.evaluate((element) => getComputedStyle(element).backgroundColor),
    ]);
  const panelGeometry = { ...panelRect, position: panelPosition };
  const backdropGeometry = { ...backdropRect, position: backdropPosition, backgroundColor };

  expect(panelGeometry.position).toBe('fixed');
  expect(
    Math.abs(panelGeometry.x + panelGeometry.width / 2 - viewport.width / 2),
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(panelGeometry.y + panelGeometry.height / 2 - viewport.height / 2),
  ).toBeLessThanOrEqual(2);

  expect(backdropGeometry.position).toBe('fixed');
  expect(Math.abs(backdropGeometry.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(backdropGeometry.y)).toBeLessThanOrEqual(1);
  expect(backdropGeometry.width).toBeGreaterThanOrEqual(viewport.width);
  expect(backdropGeometry.height).toBeGreaterThanOrEqual(viewport.height);
  const alphaMatch = backdropGeometry.backgroundColor.match(/rgba?\(([^)]+)\)/);
  const colorParts = alphaMatch?.[1]?.split(',').map((part) => Number.parseFloat(part.trim()));
  const alpha = colorParts && colorParts.length >= 4 ? (colorParts[3] ?? 0) : 1;
  expect(alpha).toBeGreaterThan(0);
}

export async function assertDeleteModalInteraction(
  page: Page,
  viewport: ModalViewport,
): Promise<void> {
  const deleteTrigger = page.locator('.delete-confirm > summary');
  const panel = page.locator('.delete-confirmation');
  const confirmButton = panel.getByRole('button', { name: '削除を確定' });
  const cancelLink = panel.getByRole('link', { name: 'キャンセル' });
  const backdrop = page.locator('.delete-modal-backdrop');

  await deleteTrigger.click();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('role', 'dialog');
  await expect(panel).toHaveAttribute('aria-modal', 'true');
  const labelledBy = await panel.getAttribute('aria-labelledby');
  expect(labelledBy).toBeTruthy();
  await expect(page.locator(`#${labelledBy}`)).toHaveText('この取引を削除しますか？');
  await assertDeleteModalGeometry(page, viewport);
  await expect(confirmButton).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(cancelLink).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirmButton).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cancelLink).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(deleteTrigger).toBeFocused();

  await deleteTrigger.click();
  await expect(confirmButton).toBeFocused();
  await cancelLink.click();
  await expect(panel).toBeHidden();
  await expect(deleteTrigger).toBeFocused();

  await deleteTrigger.click();
  await expect(confirmButton).toBeFocused();
  await backdrop.click({ position: { x: 2, y: 2 } });
  await expect(panel).toBeHidden();
  await expect(deleteTrigger).toBeFocused();
}
