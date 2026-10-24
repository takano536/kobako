'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef } from 'react';

import { handlePickerDisplayClick, handlePickerDisplayKeyDown } from './native-picker';
import { useNavigationShell } from './navigation-shell-context';
import styles from './month-switcher.module.css';

/**
 * The month label of the switcher. Tapping it opens the browser's month picker and
 * the chosen month keeps the filters that are already on the list URL. The label is a
 * `<label htmlFor>` for the hidden month input, so Android touch devices open the picker
 * through the label's native activation instead of `showPicker()`.
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
  const shell = useNavigationShell();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  function handleChange(value: string): void {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return;
    const params = new URLSearchParams();
    for (const [key, entry] of Object.entries(query ?? {})) {
      if (entry === undefined || entry === '') continue;
      params.set(key, String(entry));
    }
    params.set('month', value);
    const href = `${pathname}?${params.toString()}`;
    // A picked month goes through the shell too, so the frame shows the chosen month immediately.
    if (shell?.navigate(href, { scroll: false })) return;
    router.push(href, { scroll: false });
  }

  return (
    <span className={styles.select}>
      <label
        htmlFor={inputId}
        data-slot="month-switcher-label"
        className={styles.label}
        role="button"
        tabIndex={0}
        aria-label={`月を選択（${label}）`}
        onClick={(event) => handlePickerDisplayClick(event, inputRef.current)}
        onKeyDown={(event) => handlePickerDisplayKeyDown(event, inputRef.current)}
      >
        {label}
        <input
          ref={inputRef}
          id={inputId}
          type="month"
          className={styles.input}
          value={month}
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => handleChange(event.currentTarget.value)}
        />
      </label>
    </span>
  );
}
