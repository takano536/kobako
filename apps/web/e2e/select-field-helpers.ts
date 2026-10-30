import { expect, type Locator } from '@playwright/test';

export type SelectFieldChoice =
  | string
  | { label?: string; value?: string; index?: number };

/** Open an in-app select field and choose one of its menu items. */
export async function selectFieldOption(
  trigger: Locator,
  choice: SelectFieldChoice,
): Promise<void> {
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  await trigger.click();
  const menu = trigger.page().locator('[data-slot="select-field-menu"]:visible').last();
  const item =
    typeof choice === 'string'
      ? menu.locator(`[data-value="${choice.replaceAll('"', '\\"')}"]`)
      : choice.value !== undefined
        ? menu.locator(`[data-value="${choice.value.replaceAll('"', '\\"')}"]`)
        : choice.label !== undefined
          ? menu.getByRole('menuitemradio').filter({ hasText: choice.label }).first()
          : menu.getByRole('menuitemradio').nth(choice.index ?? 0);
  await item.click();
}
