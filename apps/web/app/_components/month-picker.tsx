'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { monthGrid, shiftGridYear, yearOfMonth } from '../../src/lib/month-grid';
import styles from './month-picker.module.css';

/** 表示部とポップオーバーの間、および画面端との余白（px）。 */
const GAP = 4;
const VIEWPORT_MARGIN = 8;

function YearChevron({ direction }: { direction: 'previous' | 'next' }) {
  return (
    <svg className={styles.chevron} viewBox="0 0 12 12" focusable="false" aria-hidden="true">
      <path
        d={
          direction === 'previous' ? 'm7.5 2.25-3.25 3.75L7.5 9.75' : 'm4.5 2.25 3.25 3.75L4.5 9.75'
        }
      />
    </svg>
  );
}

/**
 * アプリ内の月選択。表示部のタップで、直下に年の切り替えと 1〜12 月のグリッドを開きます。
 *
 * Android Firefox は、一度開いて閉じたネイティブの月ピッカーを、別のネイティブダイアログ
 * （`<select>`）を閉じたときに再表示します。ページからは制御できないため、月の選択には
 * OS のダイアログを使いません。ポップオーバーは `<body>` 直下に `position: fixed` で出し、
 * 親要素の `overflow` で切れないようにします。
 */
export function MonthPicker({
  value,
  onSelect,
  allowAll = false,
  children,
  displaySlot,
  displayClassName,
  ariaLabel,
}: {
  /** 選択中の月（`YYYY-MM`、全期間なら `all`）。 */
  value: string;
  onSelect: (value: string) => void;
  /** グリッドの先頭に「全期間」（`all`）を出します。 */
  allowAll?: boolean;
  /** 表示部の中身。 */
  children: ReactNode;
  displaySlot: string;
  displayClassName?: string;
  ariaLabel?: string;
}) {
  // 開いている間だけ、表示している年を持ちます。
  const [viewYear, setViewYear] = useState<number | null>(null);
  const displayRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const open = viewYear !== null;

  const close = (returnFocus: boolean) => {
    setViewYear(null);
    if (returnFocus) displayRef.current?.focus();
  };

  // 表示部の直下（入らなければ直上）に置き、スクロールやリサイズでは閉じずに付いていきます。
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const display = displayRef.current;
      const popover = popoverRef.current;
      if (!display || !popover) return;
      const rect = display.getBoundingClientRect();
      const width = popover.offsetWidth;
      const height = popover.offsetHeight;
      const left = Math.min(
        Math.max(rect.left + rect.width / 2 - width / 2, VIEWPORT_MARGIN),
        window.innerWidth - width - VIEWPORT_MARGIN,
      );
      const below = rect.bottom + GAP;
      const above = rect.top - GAP - height;
      const top =
        below + height > window.innerHeight - VIEWPORT_MARGIN && above >= VIEWPORT_MARGIN
          ? above
          : below;
      popover.style.left = `${Math.max(left, VIEWPORT_MARGIN)}px`;
      popover.style.top = `${top}px`;
    };
    place();
    window.addEventListener('scroll', place, { capture: true, passive: true });
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, { capture: true });
      window.removeEventListener('resize', place);
    };
  }, [open]);

  // 開いたら選択中の月（無ければ1月）へフォーカスします。年を切り替えたときは動かしません。
  useEffect(() => {
    if (!open) return;
    const popover = popoverRef.current;
    const target =
      popover?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ??
      popover?.querySelector<HTMLButtonElement>('[data-slot="month-picker-month"]');
    target?.focus({ preventScroll: true });
  }, [open]);

  // 外側の pointerdown と Escape で閉じます。
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target) || displayRef.current?.contains(target)) return;
      setViewYear(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setViewYear(null);
      displayRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  const previousYear = viewYear === null ? null : shiftGridYear(viewYear, -1);
  const nextYear = viewYear === null ? null : shiftGridYear(viewYear, 1);

  return (
    <>
      <button
        ref={displayRef}
        type="button"
        data-slot={displaySlot}
        className={displayClassName}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          if (open) close(false);
          else setViewYear(yearOfMonth(value) ?? new Date().getFullYear());
        }}
      >
        {children}
      </button>
      {open
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label="月を選択"
              data-slot="month-picker-popover"
              className={styles.popover}
              onBlur={(event) => {
                // Tab などでフォーカスがポップオーバーと表示部の外へ出たら閉じます。
                const next = event.relatedTarget;
                if (!(next instanceof Node)) return;
                if (popoverRef.current?.contains(next) || displayRef.current?.contains(next)) {
                  return;
                }
                setViewYear(null);
              }}
            >
              {allowAll ? (
                <button
                  type="button"
                  data-slot="month-picker-all"
                  className={`${styles.month} ${styles.all}`}
                  aria-pressed={value === 'all'}
                  onClick={() => {
                    onSelect('all');
                    close(true);
                  }}
                >
                  全期間
                </button>
              ) : null}
              <div className={styles.yearRow}>
                <button
                  type="button"
                  className={styles.yearStep}
                  aria-label="前の年"
                  disabled={previousYear === null}
                  onClick={() => previousYear !== null && setViewYear(previousYear)}
                >
                  <YearChevron direction="previous" />
                </button>
                <span className={styles.year} data-slot="month-picker-year" aria-live="polite">
                  {viewYear}年
                </span>
                <button
                  type="button"
                  className={styles.yearStep}
                  aria-label="次の年"
                  disabled={nextYear === null}
                  onClick={() => nextYear !== null && setViewYear(nextYear)}
                >
                  <YearChevron direction="next" />
                </button>
              </div>
              <div className={styles.grid}>
                {monthGrid(viewYear, value).map((cell) => (
                  <button
                    key={cell.value}
                    type="button"
                    data-slot="month-picker-month"
                    data-value={cell.value}
                    className={styles.month}
                    aria-label={`${viewYear}年${cell.label}`}
                    aria-pressed={cell.selected}
                    onClick={() => {
                      onSelect(cell.value);
                      close(true);
                    }}
                  >
                    {cell.label}
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
