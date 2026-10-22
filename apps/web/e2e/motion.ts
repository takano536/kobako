import type { Page } from '@playwright/test';

/**
 * Wait for finite CSS animations to settle.
 *
 * Overlay cards and dialogs animate from a translated/scaled state, so geometry read
 * while the animation is still running is off by a fraction of a pixel. Tests that
 * measure boxes inside those surfaces must call this first.
 */
export async function waitForMotion(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const running = document.getAnimations().filter((animation) => {
      const timing = animation.effect?.getComputedTiming();
      return animation.playState === 'running' && timing?.endTime !== Infinity;
    });
    await Promise.all(running.map((animation) => animation.finished.catch(() => undefined)));
  });
}
