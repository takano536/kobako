'use client';

import { useEffect } from 'react';

import {
  createSelectDismissTapGuard,
  isAndroidTouchDevice,
} from '../../src/lib/select-dismiss-tap';

/**
 * Android のタッチ端末でだけ、ネイティブの選択ダイアログを閉じるタップが下の月欄・日付欄・
 * フィルタの適用ボタンへ届くのを止めます。iOS とデスクトップでは何も取り付けません。
 */
export function SelectDismissTapGuard() {
  useEffect(() => {
    if (!isAndroidTouchDevice(navigator.userAgent, navigator.maxTouchPoints)) return;
    const guard = createSelectDismissTapGuard();
    const handleFocusIn = (event: FocusEvent) => guard.focusIn(event.target);
    const handleChange = (event: Event) => guard.change(event.target);
    const handlePointerDown = (event: PointerEvent) =>
      guard.pointerDown(event.target, document.activeElement);
    const handlePointerCancel = () => guard.pointerCancel();
    const handleClick = (event: MouseEvent) => {
      if (!guard.shouldDiscardClick()) return;
      // ラベル経由のピッカー起動・送信・リンク遷移と、React のハンドラーの両方を止めます。
      event.preventDefault();
      event.stopPropagation();
    };
    const options = { capture: true } as const;
    window.addEventListener('focusin', handleFocusIn, options);
    window.addEventListener('change', handleChange, options);
    window.addEventListener('pointerdown', handlePointerDown, options);
    window.addEventListener('pointercancel', handlePointerCancel, options);
    window.addEventListener('click', handleClick, options);
    return () => {
      window.removeEventListener('focusin', handleFocusIn, options);
      window.removeEventListener('change', handleChange, options);
      window.removeEventListener('pointerdown', handlePointerDown, options);
      window.removeEventListener('pointercancel', handlePointerCancel, options);
      window.removeEventListener('click', handleClick, options);
    };
  }, []);
  return null;
}
