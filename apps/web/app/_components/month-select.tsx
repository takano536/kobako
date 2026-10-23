'use client';

import { useRouter } from 'next/navigation';
import { useRef } from 'react';

import { openNativePicker } from './native-picker';
import styles from './month-switcher.module.css';

/**
 * The month label of the switcher. Tapping it opens the browser's month picker and
 * the chosen month keeps the filters that are already on the list URL.
 */
export function MonthSelect({
  month,
  label,
  pathname,
  query,
}: {
  month: string;
  label: string;
  pathname: string;
  query?: Record<string, string | number | undefined>;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(value: string): void {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return;
    const params = new URLSearchParams();
    for (const [key, entry] of Object.entries(query ?? {})) {
      if (entry === undefined || entry === '') continue;
      params.set(key, String(entry));
    }
    params.set('month', value);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <span className={styles.select}>
      <button
        type="button"
        data-slot="month-switcher-label"
        className={styles.label}
        aria-label={`月を選択（${label}）`}
        onClick={() => {
          const input = inputRef.current;
          if (input) openNativePicker(input);
        }}
      >
        {label}
      </button>
      <input
        ref={inputRef}
        type="month"
        className={styles.input}
        value={month}
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => handleChange(event.currentTarget.value)}
      />
    </span>
  );
}
