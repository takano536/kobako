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
}

export function PageSummary({ label, primary, secondary = [] }: PageSummaryProps) {
  return (
    <section className={styles.summary} data-slot="page-summary" aria-label={label}>
      <dl className={styles.list}>
        <div className={[styles.metric, styles.primary].join(' ')}>
          <dt>{primary.label}</dt>
          <dd>{primary.value}</dd>
        </div>
        {secondary.length > 0 ? (
          <div className={styles.group}>
            {secondary.map((metric) => (
              <div className={styles.metric} key={metric.label}>
                <dt>{metric.label}</dt>
                <dd>{metric.value}</dd>
              </div>
            ))}
          </div>
        ) : null}
      </dl>
    </section>
  );
}
