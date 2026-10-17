import type { ReactNode } from 'react';

import styles from './amount.module.css';

export function Amount({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span data-slot="money-amount" className={[styles.amount, className].filter(Boolean).join(' ')}>
      {children}
    </span>
  );
}
