import type { HTMLAttributes } from 'react';

import styles from './section.module.css';

export function Section({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={[styles.section!, className].filter(Boolean).join(' ')} {...props} />;
}
