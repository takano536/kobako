import { PrefetchLink } from './prefetch-link';
import styles from './register-fab.module.css';

export function RegisterFab({ href, label }: { href: string; label: string }) {
  return (
    <PrefetchLink className={styles.fab} href={href} aria-label={label} scroll={false}>
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </PrefetchLink>
  );
}
