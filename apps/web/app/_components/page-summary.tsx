import type { ReactNode } from 'react';

import styles from './page-summary.module.css';

export interface PageSummaryMetric {
  label: string;
  value: ReactNode;
}

interface PageSummaryProps {
  /** 見出しは置かないため、領域の名前だけを読み上げ用に残します。 */
  label: string;
  primary: PageSummaryMetric;
  secondary?: readonly PageSummaryMetric[];
  /** 概要だけは主指標と副指標を狭い画面でも1行に保ちます。 */
  mobileLayout?: 'stack' | 'inline';
  /** 概要の主指標は、固定費・残高より大きく表示します。 */
  primaryScale?: 'default' | 'hero';
  /** 概要の既存の読み上げ構造を維持します。 */
  role?: 'group';
  listLabel?: string;
  secondaryRole?: boolean;
  sticky?: boolean;
}

export function PageSummary({
  label,
  primary,
  secondary = [],
  mobileLayout = 'stack',
  primaryScale = 'default',
  role,
  listLabel,
  secondaryRole = false,
  sticky = true,
}: PageSummaryProps) {
  const summaryClasses = [
    styles.summary,
    styles[mobileLayout],
    styles[primaryScale],
    sticky ? null : styles.static,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={summaryClasses} data-slot="page-summary" aria-label={label} role={role}>
      <dl className={styles.list} aria-label={listLabel}>
        <div className={[styles.metric, styles.primary].join(' ')}>
          <dt>{primary.label}</dt>
          <dd data-slot={primaryScale === 'hero' ? 'lead-amount' : undefined}>{primary.value}</dd>
        </div>
        {secondary.map((metric) => (
          <div
            className={[styles.metric, styles.secondary].join(' ')}
            key={metric.label}
            role={secondaryRole ? 'group' : undefined}
            aria-label={secondaryRole ? metric.label : undefined}
          >
            <dt>{metric.label}</dt>
            <dd>{metric.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
