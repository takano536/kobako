'use client';

import { useEffect, useState } from 'react';

import styles from './tap-debug-log.module.css';

const LOGGED_EVENTS = [
  'touchstart',
  'pointerdown',
  'pointerup',
  'pointercancel',
  'touchend',
  'mouseup',
  'click',
  'focusin',
  'change',
  'visibilitychange',
] as const;
const MAX_LINES = 60;

function describe(target: EventTarget | null): string {
  if (!(target instanceof Element)) return target === document ? 'document' : String(target);
  const id = target.id ? `#${target.id}` : '';
  const slot = target.getAttribute('data-slot');
  const firstClass = target.classList.item(0);
  return `${target.tagName.toLowerCase()}${id}${slot ? `[${slot}]` : ''}${firstClass ? `.${firstClass}` : ''}`;
}

/**
 * 一時的な診断用。URL に `?tap-debug=1` があるときだけ、タップに関わるイベントと、JS からの
 * `showPicker()` の呼び出しを画面下部に記録します。実機で月ピッカーが勝手に開く問題が再発したときに、
 * イベントの順序・`defaultPrevented`・`showPicker()` の有無を確かめるためのものです。
 * パラメータが無ければ DOM もリスナーも追加せず、`showPicker` も置き換えません。
 */
export function TapDebugLog() {
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tap-debug') !== '1') return;
    setLines([]);
    const append = (line: string) =>
      setLines((previous) => [...(previous ?? []), line].slice(-MAX_LINES));
    const record = (event: Event) => {
      const time = Math.round(event.timeStamp);
      const target = describe(event.target);
      const active = describe(document.activeElement);
      // 他のリスナー（ガードを含む）が処理を終えた後の `defaultPrevented` を読みます。
      window.setTimeout(() => {
        append(`${time} ${event.type} ${target} dp=${event.defaultPrevented} active=${active}`);
      }, 0);
    };
    const options = { capture: true, passive: true } as const;
    for (const type of LOGGED_EVENTS) {
      (type === 'visibilitychange' ? document : window).addEventListener(type, record, options);
    }
    // JS からの `showPicker()` 呼び出しを記録します。呼ばれなければ行は出ません。
    const prototype = HTMLInputElement.prototype;
    const originalShowPicker = prototype.showPicker;
    if (typeof originalShowPicker === 'function') {
      prototype.showPicker = function showPicker(this: HTMLInputElement) {
        append(
          `${Math.round(performance.now())} showPicker target=${describe(this)} active=${describe(document.activeElement)}`,
        );
        return originalShowPicker.call(this);
      };
    }
    return () => {
      for (const type of LOGGED_EVENTS) {
        (type === 'visibilitychange' ? document : window).removeEventListener(
          type,
          record,
          options,
        );
      }
      if (typeof originalShowPicker === 'function') prototype.showPicker = originalShowPicker;
    };
  }, []);

  if (!lines) return null;
  return (
    // 高さを抑えて下端に固定するため、新しい行を上に出します。
    <pre data-slot="tap-debug" className={styles.log} aria-hidden="true">
      {[...lines].reverse().join('\n')}
    </pre>
  );
}
