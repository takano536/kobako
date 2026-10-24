import { describe, expect, it } from 'vitest';

import {
  createSelectDismissTapGuard,
  isAndroidTouchDevice,
  isGuardedTapTarget,
  type GuardElement,
} from './select-dismiss-tap';

const PIXEL_7_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/** `closest()` を、自分と祖先が持つセレクターの集合で再現する偽の要素。 */
function element(
  tagName: string,
  options: {
    matches?: string[];
    parent?: GuardElement;
    control?: GuardElement['control'];
  } = {},
): GuardElement {
  const self: GuardElement = {
    tagName,
    control: options.control,
    closest(selector) {
      const wanted = selector.split(',').map((part) => part.trim());
      const own = [tagName.toLowerCase(), ...(options.matches ?? [])];
      if (wanted.some((part) => own.includes(part))) return self;
      return options.parent ? options.parent.closest(selector) : null;
    },
  };
  return self;
}

const filterForm = element('FORM', { matches: ['[data-slot="filter-form"]'] });
const typeSelect = element('SELECT', { parent: filterForm });
const monthLabel = element('LABEL', {
  parent: filterForm,
  control: { tagName: 'INPUT', type: 'month' },
});
const monthLabelText = element('SPAN', { parent: monthLabel });
const applyButton = element('BUTTON', { parent: filterForm });
const switcher = element('NAV', { matches: ['[data-slot="month-switcher"]'] });
const switcherLabel = element('BUTTON', { parent: switcher });
const dateLabel = element('LABEL', { control: { tagName: 'INPUT', type: 'date' } });
const amountLabel = element('LABEL', { control: { tagName: 'INPUT', type: 'text' } });
const listLink = element('A');

describe('isAndroidTouchDevice', () => {
  it('is true only for Android user agents with touch points', () => {
    expect(isAndroidTouchDevice(PIXEL_7_UA, 5)).toBe(true);
    expect(isAndroidTouchDevice(PIXEL_7_UA, 0)).toBe(false);
    expect(isAndroidTouchDevice(IPHONE_UA, 5)).toBe(false);
    expect(isAndroidTouchDevice(DESKTOP_UA, 0)).toBe(false);
  });
});

describe('isGuardedTapTarget', () => {
  it('covers the filter form, the month switcher, and labels of date or month inputs', () => {
    expect(isGuardedTapTarget(monthLabelText)).toBe(true);
    expect(isGuardedTapTarget(applyButton)).toBe(true);
    expect(isGuardedTapTarget(switcherLabel)).toBe(true);
    expect(isGuardedTapTarget(dateLabel)).toBe(true);
    expect(
      isGuardedTapTarget(element('BUTTON', { matches: ['[data-slot="date-picker-display"]'] })),
    ).toBe(true);
  });

  it('leaves other controls and non-elements alone', () => {
    expect(isGuardedTapTarget(amountLabel)).toBe(false);
    expect(isGuardedTapTarget(listLink)).toBe(false);
    expect(isGuardedTapTarget(null)).toBe(false);
    expect(isGuardedTapTarget({})).toBe(false);
  });
});

describe('createSelectDismissTapGuard', () => {
  it('discards the tap that replaces focus on an open select, then lets the next tap through', () => {
    const guard = createSelectDismissTapGuard();
    guard.focusIn(typeSelect);

    guard.pointerDown(monthLabelText, typeSelect);
    expect(guard.shouldDiscardClick()).toBe(true);

    // 閉じるタップの後もフォーカスが select に残っていても、2回目は本物のタップとして通します。
    guard.pointerDown(monthLabelText, typeSelect);
    expect(guard.shouldDiscardClick()).toBe(false);
  });

  it('discards a dismiss tap that lands on the apply button or the month switcher', () => {
    const guard = createSelectDismissTapGuard();
    guard.focusIn(typeSelect);
    guard.pointerDown(applyButton, typeSelect);
    expect(guard.shouldDiscardClick()).toBe(true);

    guard.focusIn(typeSelect);
    guard.pointerDown(switcherLabel, typeSelect);
    expect(guard.shouldDiscardClick()).toBe(true);
  });

  it('lets the first tap through after a value was chosen', () => {
    const guard = createSelectDismissTapGuard();
    guard.focusIn(typeSelect);
    guard.change(typeSelect);
    guard.pointerDown(monthLabelText, typeSelect);
    expect(guard.shouldDiscardClick()).toBe(false);
  });

  it('does not discard when focus is not on a select or the target is not guarded', () => {
    const guard = createSelectDismissTapGuard();
    guard.focusIn(typeSelect);
    guard.pointerDown(monthLabelText, applyButton);
    expect(guard.shouldDiscardClick()).toBe(false);

    guard.focusIn(typeSelect);
    guard.pointerDown(listLink, typeSelect);
    expect(guard.shouldDiscardClick()).toBe(false);

    guard.pointerDown(monthLabelText, typeSelect);
    expect(guard.shouldDiscardClick()).toBe(false);
  });

  it('re-arms when the focused select itself is tapped to open its dialog again', () => {
    const guard = createSelectDismissTapGuard();
    guard.focusIn(typeSelect);
    guard.pointerDown(monthLabelText, typeSelect);
    expect(guard.shouldDiscardClick()).toBe(true);

    guard.pointerDown(typeSelect, typeSelect);
    expect(guard.shouldDiscardClick()).toBe(false);
    guard.pointerDown(monthLabelText, typeSelect);
    expect(guard.shouldDiscardClick()).toBe(true);
  });

  it('forgets a pending discard when the pointer is cancelled', () => {
    const guard = createSelectDismissTapGuard();
    guard.focusIn(typeSelect);
    guard.pointerDown(monthLabelText, typeSelect);
    guard.pointerCancel();
    expect(guard.shouldDiscardClick()).toBe(false);
  });
});
