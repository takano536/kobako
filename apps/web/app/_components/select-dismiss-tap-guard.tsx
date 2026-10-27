'use client';

import { useEffect } from 'react';

import {
  createSelectDismissTapGuard,
  isAndroidTouchDevice,
} from '../../src/lib/select-dismiss-tap';

/**
 * Android のタッチ端末でだけ、ネイティブの選択ダイアログを閉じるタップが下の月の切り替え・
 * 日付欄・月グリッドへ届くのを止めます。iOS とデスクトップでは何も取り付けません。
 */
export function SelectDismissTapGuard() {
  useEffect(() => {
    if (!isAndroidTouchDevice(navigator.userAgent, navigator.maxTouchPoints)) return;
    const guard = createSelectDismissTapGuard();
    const handleFocusIn = (event: FocusEvent) => guard.focusIn(event.target);
    const handleChange = (event: Event) => guard.change(event.target);
    const handlePointerDown = (event: PointerEvent) => {
      // 閉じるタップのフォーカス移動・既定動作を、`click` を待たずに止めます。
      if (guard.pointerDown(event.target)) event.preventDefault();
    };
    // ラベルからの date/month input の起動を `click` より前（`pointerup`／`touchend`）で行う
    // ブラウザがあるため、捨てるジェスチャーの終わりも止めます。
    const handleGestureEnd = (event: PointerEvent | TouchEvent) => {
      if (guard.pointerUp(event.target)) event.preventDefault();
    };
    const handleClick = (event: MouseEvent) => {
      if (!guard.click(event.target)) return;
      // ラベル経由のピッカー起動・送信・リンク遷移と、React のハンドラーの両方を止めます。
      event.preventDefault();
      event.stopPropagation();
    };
    const handleDisarm = guard.disarm;
    const capture = { capture: true } as const;
    const activeCapture = { capture: true, passive: false } as const;
    window.addEventListener('focusin', handleFocusIn, capture);
    window.addEventListener('change', handleChange, capture);
    window.addEventListener('pointerdown', handlePointerDown, capture);
    window.addEventListener('pointerup', handleGestureEnd, capture);
    window.addEventListener('touchend', handleGestureEnd, activeCapture);
    window.addEventListener('pointercancel', handleDisarm, capture);
    window.addEventListener('keydown', handleDisarm, capture);
    window.addEventListener('click', handleClick, capture);
    return () => {
      window.removeEventListener('focusin', handleFocusIn, capture);
      window.removeEventListener('change', handleChange, capture);
      window.removeEventListener('pointerdown', handlePointerDown, capture);
      window.removeEventListener('pointerup', handleGestureEnd, capture);
      window.removeEventListener('touchend', handleGestureEnd, activeCapture);
      window.removeEventListener('pointercancel', handleDisarm, capture);
      window.removeEventListener('keydown', handleDisarm, capture);
      window.removeEventListener('click', handleClick, capture);
    };
  }, []);
  return null;
}
