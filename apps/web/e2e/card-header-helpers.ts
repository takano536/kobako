import type { Locator, Page } from '@playwright/test';

import { waitForMotion } from './motion';

type Point = { x: number; y: number };

/** 見出しテキストの実描画範囲（Range の rect）の中心。要素の箱ではなく文字そのものの位置です。 */
async function headingTextCenter(heading: Locator): Promise<Point> {
  return heading.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) throw new Error('heading text is not rendered');
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
}

/** ヘッダー行のうち、見出しより右の空白（右端から 16px 内側、見出しと同じ高さ）。 */
async function headerBlankPoint(heading: Locator): Promise<Point> {
  return heading.evaluate((element) => {
    const header = element.closest('header');
    if (!header) throw new Error('card header is missing');
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const point = { x: header.getBoundingClientRect().right - 16, y: text.y + text.height / 2 };
    if (point.x <= text.right + 16) throw new Error('card header has no blank area to the right');
    return point;
  });
}

/** 端末の入力手段に合わせ、タッチ端末ではタップ、それ以外ではクリックします。 */
async function pressAt(page: Page, isMobile: boolean, point: Point): Promise<void> {
  if (isMobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

export async function pressHeadingText(
  page: Page,
  isMobile: boolean,
  heading: Locator,
): Promise<void> {
  await waitForMotion(page);
  await pressAt(page, isMobile, await headingTextCenter(heading));
}

export async function pressHeaderBlank(
  page: Page,
  isMobile: boolean,
  heading: Locator,
): Promise<void> {
  await waitForMotion(page);
  await pressAt(page, isMobile, await headerBlankPoint(heading));
}

export async function pressCenter(page: Page, isMobile: boolean, target: Locator): Promise<void> {
  await waitForMotion(page);
  const box = await target.boundingBox();
  if (!box) throw new Error('press target is not rendered');
  await pressAt(page, isMobile, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}
