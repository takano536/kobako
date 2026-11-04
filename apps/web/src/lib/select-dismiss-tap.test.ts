import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ARMED_TIMEOUT_MS,
  createSelectDismissTapGuard,
  isAndroidTouchDevice,
  isGuardedTapTarget,
  type GuardElement,
  type TapGuard,
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

const transactionForm = element('FORM');
const typeSelect = element('SELECT', { parent: transactionForm });
const dateLabel = element('LABEL', {
  parent: transactionForm,
  control: { tagName: 'INPUT', type: 'date' },
});
const dateLabelText = element('SPAN', { parent: dateLabel });
const datePickerDisplay = element('BUTTON', {
  parent: transactionForm,
  matches: ['[data-slot="date-picker-display"]'],
});
const switcher = element('NAV', { matches: ['[data-slot="month-switcher"]'] });
const switcherLabel = element('BUTTON', { parent: switcher });
const amountLabel = element('LABEL', { control: { tagName: 'INPUT', type: 'text' } });
const transactionButton = element('BUTTON', { parent: transactionForm });
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
  it('covers the month switcher, date labels, and date picker display', () => {
    expect(isGuardedTapTarget(dateLabelText)).toBe(true);
    expect(isGuardedTapTarget(datePickerDisplay)).toBe(true);
    expect(isGuardedTapTarget(switcherLabel)).toBe(true);
    expect(isGuardedTapTarget(dateLabel)).toBe(true);
  });

  it('covers month buttons in the month grid popover rendered under the body', () => {
    const popover = element('DIV', { matches: ['[data-slot="month-picker-popover"]'] });
    expect(isGuardedTapTarget(element('BUTTON', { parent: popover }))).toBe(true);
  });

  it('leaves other controls and non-elements alone', () => {
    expect(isGuardedTapTarget(amountLabel)).toBe(false);
    expect(isGuardedTapTarget(transactionButton)).toBe(false);
    expect(isGuardedTapTarget(listLink)).toBe(false);
    expect(isGuardedTapTarget(null)).toBe(false);
    expect(isGuardedTapTarget({})).toBe(false);
  });
});

describe('createSelectDismissTapGuard', () => {
  /** 1回のタップ（`pointerdown` → `click`）。それぞれで捨てたかを返します。 */
  const tap = (guard: TapGuard, target: unknown) => ({
    pointerDown: guard.pointerDown(target),
    click: guard.click(target),
  });
  const discarded = { pointerDown: true, click: true };
  const passed = { pointerDown: false, click: false };

  it('discards the dismiss tap after a select pointerdown without focusin (Firefox order)', () => {
    for (const target of [dateLabelText, datePickerDisplay, switcherLabel]) {
      const guard = createSelectDismissTapGuard();
      // `focusin` は来ず、フォーカスも select に移らない順序。ガードは activeElement を見ません。
      expect(guard.pointerDown(typeSelect)).toBe(false);
      expect(tap(guard, target)).toEqual(discarded);
      expect(tap(guard, target)).toEqual(passed);
    }
  });

  it('discards the dismiss tap after a select focusin (Chromium order), then lets the next tap through', () => {
    const guard = createSelectDismissTapGuard();
    guard.focusIn(typeSelect);
    expect(tap(guard, dateLabelText)).toEqual(discarded);
    expect(tap(guard, dateLabelText)).toEqual(passed);
  });

  it('arms on a select click and discards a ghost click that has no pointerdown', () => {
    const guard = createSelectDismissTapGuard();
    expect(guard.click(typeSelect)).toBe(false);
    expect(guard.click(dateLabelText)).toBe(true);
    expect(guard.click(dateLabelText)).toBe(false);
  });

  it('lets the next tap through after change, scroll, pointercancel, or visibilitychange', () => {
    const change = createSelectDismissTapGuard();
    change.pointerDown(typeSelect);
    change.change(typeSelect);
    expect(tap(change, dateLabelText)).toEqual(passed);

    // scroll・pointercancel・visibilitychange はどれも `disarm()` を呼びます。
    for (const reason of ['scroll', 'pointercancel', 'visibilitychange']) {
      const guard = createSelectDismissTapGuard();
      guard.pointerDown(typeSelect);
      guard.disarm();
      expect(tap(guard, dateLabelText), reason).toEqual(passed);
    }
  });

  it('forgets the pending click when the discarded pointerdown is cancelled', () => {
    const guard = createSelectDismissTapGuard();
    guard.pointerDown(typeSelect);
    expect(guard.pointerDown(dateLabelText)).toBe(true);
    guard.disarm();
    expect(guard.click(dateLabelText)).toBe(false);
  });

  it('passes taps outside the guarded scope and disarms on them', () => {
    const guard = createSelectDismissTapGuard();
    guard.pointerDown(typeSelect);
    expect(tap(guard, listLink)).toEqual(passed);
    expect(tap(guard, dateLabelText)).toEqual(passed);
  });

  it('does nothing before any select interaction', () => {
    const guard = createSelectDismissTapGuard();
    expect(tap(guard, dateLabelText)).toEqual(passed);
    expect(tap(guard, datePickerDisplay)).toEqual(passed);
  });

  it('re-arms when the select itself is tapped to open its dialog again', () => {
    const guard = createSelectDismissTapGuard();
    expect(tap(guard, typeSelect)).toEqual(passed);
    expect(tap(guard, dateLabelText)).toEqual(discarded);
    expect(tap(guard, typeSelect)).toEqual(passed);
    expect(tap(guard, dateLabelText)).toEqual(discarded);
  });
});

describe('createSelectDismissTapGuard pointerup and expiry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('discards the pointerup of a gesture whose pointerdown was discarded', () => {
    const guard = createSelectDismissTapGuard();
    guard.pointerDown(typeSelect);
    expect(guard.pointerDown(dateLabelText)).toBe(true);
    expect(guard.pointerUp(dateLabelText)).toBe(true);
    expect(guard.click(dateLabelText)).toBe(true);

    // 次のジェスチャーは down・up・click のどれも通します。
    expect(guard.pointerDown(dateLabelText)).toBe(false);
    expect(guard.pointerUp(dateLabelText)).toBe(false);
    expect(guard.click(dateLabelText)).toBe(false);
  });

  it('lets the pointerup through when the gesture was not discarded', () => {
    const guard = createSelectDismissTapGuard();
    expect(guard.pointerDown(dateLabelText)).toBe(false);
    expect(guard.pointerUp(dateLabelText)).toBe(false);

    guard.pointerDown(typeSelect);
    expect(guard.pointerUp(typeSelect)).toBe(false);
    expect(guard.pointerDown(listLink)).toBe(false);
    expect(guard.pointerUp(listLink)).toBe(false);
  });

  it('expires the armed state after the timeout', () => {
    vi.useFakeTimers();
    const guard = createSelectDismissTapGuard();
    guard.pointerDown(typeSelect);
    vi.advanceTimersByTime(ARMED_TIMEOUT_MS - 1);
    expect(guard.pointerDown(dateLabelText)).toBe(true);

    guard.pointerDown(typeSelect);
    vi.advanceTimersByTime(ARMED_TIMEOUT_MS);
    expect(guard.pointerDown(dateLabelText)).toBe(false);
    expect(guard.pointerUp(dateLabelText)).toBe(false);
    expect(guard.click(dateLabelText)).toBe(false);
  });

  it('disarms on change so the whole next gesture passes', () => {
    const guard = createSelectDismissTapGuard();
    guard.focusIn(typeSelect);
    guard.change(typeSelect);
    expect(guard.pointerDown(datePickerDisplay)).toBe(false);
    expect(guard.pointerUp(datePickerDisplay)).toBe(false);
    expect(guard.click(datePickerDisplay)).toBe(false);
  });
});
