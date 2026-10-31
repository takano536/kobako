import { PrefetchLink } from './prefetch-link';
import type { ReactNode } from 'react';

import styles from './page-header.module.css';

interface PageHeaderBackLink {
  href: string;
  label: string;
}

export function PageHeader({
  title,
  titleAriaLabel,
  count,
  backLink,
  className,
}: {
  title: ReactNode;
  titleAriaLabel?: string;
  count?: string;
  backLink?: PageHeaderBackLink;
  actions?: ReactNode;
  className?: string;
}) {
  const classes = [styles['page-header'], className].filter(Boolean).join(' ');
  return (
    <header data-slot="page-header" className={classes}>
      <h1 data-slot="page-header-title" aria-label={titleAriaLabel}>
        {backLink ? (
          <PrefetchLink
            data-slot="page-header-title-link"
            className={styles['page-header-title-link']}
            href={backLink.href}
            aria-label={titleAriaLabel ? `${titleAriaLabel} — ${backLink.label}` : undefined}
          >
            <svg
              data-slot="page-header-back-chevron"
              className={styles['page-header-back-chevron']}
              viewBox="0 0 12 12"
              focusable="false"
              aria-hidden="true"
            >
              <path d="m7.5 2.25-3.25 3.75L7.5 9.75" />
            </svg>
            <span data-slot="heading-title" className={styles['heading-title']}>
              {title}
            </span>
            <span className="sr-only"> — {backLink.label}</span>
          </PrefetchLink>
        ) : (
          <span data-slot="heading-title" className={styles['heading-title']}>
            {title}
          </span>
        )}
        {count ? (
          <span data-slot="heading-count" className={styles['heading-count']}>
            {count}
          </span>
        ) : null}
      </h1>
    </header>
  );
}
