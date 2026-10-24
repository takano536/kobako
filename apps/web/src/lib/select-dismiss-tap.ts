/**
 * Android のブラウザは、ネイティブの選択ダイアログ（`<select>`）を外側のタップで閉じたとき、
 * そのタップをページ側の要素にも届けます。閉じるタップが月欄や日付欄、適用ボタンの上に落ちると、
 * 利用者が意図していないピッカーの起動や送信が起きるため、そのタップの `click` だけを捨てます。
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

/**
 * タップごとの状態を持つガード。イベントの順序は Android Chrome のタップと同じく
 * `pointerdown` → （フォーカス移動）→ `click` を想定します。
 */
export function createSelectDismissTapGuard() {
  // 選択ダイアログが開いている可能性がある間だけ真。閉じるタップ1回で必ず偽に戻します。
  let armed = false;
  let discardClick = false;

  return {
    /** `<select>` にフォーカスが入った（ダイアログが開いた）。 */
    focusIn(target: unknown): void {
      if (isSelect(asElement(target))) armed = true;
    },
    /** 値を選んでダイアログが閉じた。次のタップは本物として通します。 */
    change(target: unknown): void {
      if (isSelect(asElement(target))) armed = false;
    },
    /** キャプチャ段階の `pointerdown`。この時点のフォーカスで、閉じるタップかを決めます。 */
    pointerDown(target: unknown, activeElement: unknown): void {
      const element = asElement(target);
      if (element?.closest('select')) {
        // select 自体のタップはダイアログを開くタップ。
        armed = true;
        discardClick = false;
        return;
      }
      discardClick = armed && isSelect(asElement(activeElement)) && isGuardedTapTarget(element);
      armed = false;
    },
    pointerCancel(): void {
      discardClick = false;
    },
    /** キャプチャ段階の `click`。捨てるべきなら真を返し、状態を戻します。 */
    shouldDiscardClick(): boolean {
      const discard = discardClick;
      discardClick = false;
      return discard;
    },
  };
}
