'use client';

import { useNavigationShell } from './navigation-shell-context';
import monthStyles from './month-switcher.module.css';
import { monthLabel } from '../../src/lib/format';

const MIN_YEAR = 1900;
const MAX_YEAR = 9998;

/** `YYYY-MM` を月単位で動かします。範囲外になる場合は `null` を返します。 */
function shiftedMonth(month: string, offset: number): string | null {
  const parts = month.split('-');
  const year = Number(parts[0]);
  const monthNumber = Number(parts[1]);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber)) return null;
  const total = year * 12 + (monthNumber - 1) + offset;
  const nextYear = Math.floor(total / 12);
  if (nextYear < MIN_YEAR || nextYear > MAX_YEAR) return null;
  return `${String(nextYear).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

function Chevron({ direction }: { direction: 'previous' | 'next' }) {
  return (
    <svg className={monthStyles.chevron} viewBox="0 0 12 12" focusable="false" aria-hidden="true">
      <path
        d={
          direction === 'previous' ? 'm7.5 2.25-3.25 3.75L7.5 9.75' : 'm4.5 2.25 3.25 3.75L4.5 9.75'
        }
      />
    </svg>
  );
}

/**
 * 遷移先の外枠に置く月の切り替えです。骨組みの本文は隠れているので、ここだけは実際に押せます。
 * 押した月をすぐ表示し、取得は待機中の1件へまとめます（連打しても画面は1回だけ切り替わります）。
 */
export function MonthFrameSwitcher({ month }: { month: string }) {
  const shell = useNavigationShell();
  const shown = shell?.pendingMonth ?? month;

  function step(offset: number): void {
    const target = shiftedMonth(shown, offset);
    if (target === null) return;
    const url = new URL(window.location.href);
    url.searchParams.set('month', target);
    shell?.navigate(`${url.pathname}${url.search}`, { scroll: false });
  }

  return (
    <nav data-slot="month-switcher" className={monthStyles.switcher} aria-label="月を移動">
      <button
        type="button"
        className={monthStyles.control}
        aria-label="前月"
        onClick={() => step(-1)}
      >
        <Chevron direction="previous" />
      </button>
      <span className={monthStyles.label}>{monthLabel(shown)}</span>
      <button
        type="button"
        className={monthStyles.control}
        aria-label="翌月"
        onClick={() => step(1)}
      >
        <Chevron direction="next" />
      </button>
    </nav>
  );
}
