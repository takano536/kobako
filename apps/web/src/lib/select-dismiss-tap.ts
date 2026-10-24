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

/** 選択ダイアログを閉じるタップを捨てるガード。各メソッドはキャプチャ段階のイベントから呼びます。 */
export interface TapGuard {
  focusIn(target: unknown): void;
  change(target: unknown): void;
  disarm(): void;
  /** 真なら、この `pointerdown` を `preventDefault()` します。 */
  pointerDown(target: unknown): boolean;
  /** 真なら、この `click` を `preventDefault()` と `stopPropagation()` で捨てます。 */
  click(target: unknown): boolean;
}

/**
 * タップごとの状態を持つガード。`<select>` への `pointerdown`／`focusin`／`click` のどれかを
 * 見たら「ダイアログが開いた可能性がある」状態（armed）にし、その間に来た最初の対象へのタップを
 * 捨てます。armed はどのタップでも下ろすので、続けて2回捨てることはありません。
 */
export function createSelectDismissTapGuard(): TapGuard {
  let armed = false;
  // `pointerdown` を捨てたタップの、続く `click` も捨てるための印。
  let discardClick = false;
  const disarm = () => {
    armed = false;
    discardClick = false;
  };

  return {
    /** `<select>` にフォーカスが入った。 */
    focusIn(target: unknown): void {
      if (isSelect(asElement(target))) armed = true;
    },
    /** 値を選んでダイアログが閉じた。 */
    change(target: unknown): void {
      if (isSelect(asElement(target))) disarm();
    },
    /** `pointercancel`・ページのスクロール・タブの切り替えで、待機と捨てる予定を取り消します。 */
    disarm,
    /** キャプチャ段階の `pointerdown`。真なら、この `pointerdown` を `preventDefault()` します。 */
    pointerDown(target: unknown): boolean {
      if (isInsideSelect(target)) {
        armed = true;
        discardClick = false;
        return false;
      }
      const discard = armed && isGuardedTapTarget(target);
      armed = false;
      discardClick = discard;
      return discard;
    },
    /**
     * キャプチャ段階の `click`。真なら `preventDefault()` と `stopPropagation()` で捨てます。
     * `pointerdown` を伴わない合成クリックでも、armed なら対象へのクリックを捨てます。
     */
    click(target: unknown): boolean {
      if (isInsideSelect(target)) {
        armed = true;
        discardClick = false;
        return false;
      }
      if (discardClick) {
        discardClick = false;
        return true;
      }
      const discard = armed && isGuardedTapTarget(target);
      armed = false;
      return discard;
    },
  };
}
