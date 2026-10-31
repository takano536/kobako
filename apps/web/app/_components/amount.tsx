import type { CSSProperties, ReactNode } from 'react';

import styles from './amount.module.css';

export function Amount({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      data-slot="money-amount"
      className={[styles.amount, className].filter(Boolean).join(' ')}
      style={style}
    >
      {children}
    </span>
  );
}
