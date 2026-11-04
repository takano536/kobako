'use client';

import { useRouter } from 'next/navigation';

import { MonthPicker } from './month-picker';
import { useNavigationShell } from './navigation-shell-context';
import styles from './month-switcher.module.css';

/**
 * The month label of the switcher. Tapping it opens the in-app month grid, and the chosen
 * month keeps the filters that are already on the list URL. `allowAll` adds 全期間 (`month=all`)
 * at the top of the grid.
 */
export function MonthSelect({
  month,
  label,
  pathname,
  query,
  allowAll = false,
}: {
  month: string;
  label: string;
  pathname: string;
  query?: Record<string, string | number | undefined>;
  allowAll?: boolean;
}) {
  const router = useRouter();
  const shell = useNavigationShell();

  function handleSelect(value: string): void {
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
      <MonthPicker
        value={month}
        onSelect={handleSelect}
        allowAll={allowAll}
        displaySlot="month-switcher-label"
        displayClassName={styles.label}
        ariaLabel={`月を選択（${label}）`}
      >
        {label}
      </MonthPicker>
    </span>
  );
}
