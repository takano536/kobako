import type { ReactNode } from 'react';

import styles from './amount.module.css';

export function Amount({
  children,
  className,
  summaryLong,
}: {
  children: ReactNode;
  className?: string;
  summaryLong?: boolean;
}) {
  return (
    <span
      data-slot="money-amount"
      data-summary-long={summaryLong ? '' : undefined}
      className={[styles.amount, className].filter(Boolean).join(' ')}
    >
      {children}
    </span>
  );
}
