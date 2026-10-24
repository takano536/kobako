/**
 * Android のブラウザは、ネイティブの選択ダイアログ（`<select>`）を外側のタップで閉じたとき、
 * そのタップをページ側の要素にも届けます。閉じるタップが月欄や日付欄、適用ボタンの上に落ちると、
 * 利用者が意図していないピッカーの起動や送信が起きるため、そのタップを `pointerdown` と `click`
 * の両方で捨てます。ブラウザごとに `focusin` の有無やフォーカスの移る時点が違うため、
 * 判定は `document.activeElement` に頼らず、`<select>` への操作を見たかどうかだけで決めます。
 */

/** 判定に使う DOM 要素の最小限の形。テストでは同じ形の偽物を渡します。 */
export interface GuardElement {
  readonly tagName: string;
  closest(selector: string): GuardElement | null;
  readonly control?: { readonly tagName: string; readonly type?: string } | null;
}

/** 選択ダイアログを閉じるタップが落ちたときに捨てる対象。 */
const GUARDED_SCOPE_SELECTOR = [
  '[data-slot="filter-form"]',
  '[data-slot="month-switcher"]',
  '[data-slot="date-picker-display"]',
  '[data-slot="month-picker-display"]',
].join(', ');

export function isAndroidTouchDevice(userAgent: string, maxTouchPoints: number): boolean {
  return /android/i.test(userAgent) && maxTouchPoints > 0;
}

function asElement(value: unknown): GuardElement | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<GuardElement>;
  return typeof candidate.tagName === 'string' && typeof candidate.closest === 'function'
    ? (candidate as GuardElement)
    : null;
}

function isSelect(element: GuardElement | null): boolean {
  return element?.tagName.toUpperCase() === 'SELECT';
}

function isInsideSelect(target: unknown): boolean {
  return Boolean(asElement(target)?.closest('select'));
}

/** フィルタのフォーム・月スイッチャー・日付/月ピッカー（ラベル経由の起動を含む）なら真。 */
export function isGuardedTapTarget(value: unknown): boolean {
  const element = asElement(value);
  if (!element) return false;
  if (element.closest(GUARDED_SCOPE_SELECTOR)) return true;
  const control = element.closest('label')?.control;
  return (
    control?.tagName.toUpperCase() === 'INPUT' &&
    (control.type === 'date' || control.type === 'month')
  );
}

/** `<select>` への操作から、閉じるタップを待つ最長の時間。 */
export const ARMED_TIMEOUT_MS = 10_000;

/** 選択ダイアログを閉じるタップを捨てるガード。各メソッドはキャプチャ段階のイベントから呼びます。 */
export interface TapGuard {
  focusIn(target: unknown): void;
  change(target: unknown): void;
  /** `pointercancel`・`keydown` で、待機と捨てる予定を取り消します。 */
  disarm(): void;
  /** 真なら、この `pointerdown` を `preventDefault()` します。 */
  pointerDown(target: unknown): boolean;
  /**
   * 真なら、この `pointerup`（と `touchend`）を `preventDefault()` します。
   * `pointerdown` を捨てたジェスチャーの終わりだけが真です。
   */
  pointerUp(target: unknown): boolean;
  /** 真なら、この `click` を `preventDefault()` と `stopPropagation()` で捨てます。 */
  click(target: unknown): boolean;
}

/**
 * タップごとの状態を持つガード。`<select>` への `pointerdown`／`focusin`／`click` のどれかを
 * 見たら「ダイアログが開いた可能性がある」状態（armed）にし、その間に来た最初の対象へのタップを
 * `pointerdown`・`pointerup`・`click` のすべてで捨てます。armed はどのタップでも下ろすので、
 * 続けて2回捨てることはありません。ダイアログの開閉に伴う `scroll`・`visibilitychange` では
 * 下ろしません（閉じるタップの前に待機が消えるため）。代わりに armed から
 * {@link ARMED_TIMEOUT_MS} 経つと失効します。
 */
export function createSelectDismissTapGuard(): TapGuard {
  let armedAt: number | null = null;
  // `pointerdown` を捨てたジェスチャーの、続く `pointerup`／`touchend`／`click` も捨てるための印。
  let discardGesture = false;
  const arm = () => {
    armedAt = Date.now();
    discardGesture = false;
  };
  const disarm = () => {
    armedAt = null;
    discardGesture = false;
  };
  /** 待機中なら真を返し、どちらの場合も待機を下ろします。 */
  const takeArmed = () => {
    const armed = armedAt !== null && Date.now() - armedAt < ARMED_TIMEOUT_MS;
    armedAt = null;
    return armed;
  };

  return {
    /** `<select>` にフォーカスが入った。 */
    focusIn(target: unknown): void {
      if (isSelect(asElement(target))) arm();
    },
    /** 値を選んでダイアログが閉じた。 */
    change(target: unknown): void {
      if (isSelect(asElement(target))) disarm();
    },
    disarm,
    pointerDown(target: unknown): boolean {
      if (isInsideSelect(target)) {
        arm();
        return false;
      }
      discardGesture = takeArmed() && isGuardedTapTarget(target);
      return discardGesture;
    },
    pointerUp(target: unknown): boolean {
      if (isInsideSelect(target)) return false;
      return discardGesture;
    },
    /**
     * `pointerdown` を伴わない合成クリックでも、armed なら対象へのクリックを捨てます。
     */
    click(target: unknown): boolean {
      if (isInsideSelect(target)) {
        arm();
        return false;
      }
      if (discardGesture) {
        discardGesture = false;
        return true;
      }
      return takeArmed() && isGuardedTapTarget(target);
    },
  };
}
