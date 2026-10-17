import type { ReactNode } from 'react';

import styles from './card.module.css';

export function Card({
  as: Element = 'div',
  className,
  children,
}: {
  as?: 'div' | 'section';
  className?: string;
  children: ReactNode;
}) {
  return (
    <Element className={[styles.card, className].filter(Boolean).join(' ')}>{children}</Element>
  );
}
