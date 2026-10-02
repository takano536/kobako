import Link from 'next/link';
import type { ReactNode } from 'react';

import { EmptyLedgerMotif } from '../../src/lib/category';
import { monthLabel } from '../../src/lib/format';
import type { TransactionListType } from '../../src/lib/transaction-query';
import { MonthPickerField } from '../transactions/date-picker-field';

type ActionLinkVariant = 'primary' | 'secondary' | 'quiet' | 'back';

interface ActionLinkProps {
  href: string;
  children: ReactNode;
  variant?: ActionLinkVariant;
  icon?: ReactNode;
}

export function ActionLink({ href, children, variant = 'quiet', icon }: ActionLinkProps) {
  const classes = `action-link action-link-${variant}`;
  return (
    <Link className={classes} href={href}>
      {icon ? (
        <span className="action-link-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
    </Link>
  );
}
export function RegisterTransactionAction({
  month,
  variant = 'primary',
}: {
  month: string;
  variant?: 'primary' | 'quiet';
}) {
  return (
    <ActionLink
      href={`/transactions/new?month=${encodeURIComponent(month)}`}
      variant={variant}
      icon="＋"
    >
      取引を登録
    </ActionLink>
  );
}

export function PageShell({
  children,
  width = 'wide',
  className,
}: {
  children: ReactNode;
  width?: 'wide' | 'narrow' | 'import';
  className?: string;
}) {
  const classes = ['content-stack', 'page-shell', `page-shell-${width}`, className]
    .filter(Boolean)
    .join(' ');
  return <div className={classes}>{children}</div>;
}

export function PageHeader({
  title,
  titleAriaLabel,
  count,
  actions,
  className,
}: {
  title: ReactNode;
  titleAriaLabel?: string;
  count?: string;
  actions?: ReactNode;
  className?: string;
}) {
  const classes = ['page-header', className].filter(Boolean).join(' ');
  return (
    <header className={classes}>
      <h1 aria-label={titleAriaLabel}>
        <span className="heading-title">{title}</span>
        {count ? <span className="heading-count">{count}</span> : null}
      </h1>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}

export function SectionHeading({
  id,
  title,
  action,
}: {
  id?: string;
  title: string;
  action?: ReactNode;
}) {
  const classes = 'section-heading';
  return (
    <div className={classes}>
      <h2 id={id}>{title}</h2>
      {action ? <div className="section-heading-action">{action}</div> : null}
    </div>
  );
}

export function MonthSwitcher({
  month,
  previousHref,
  nextHref,
}: {
  month: string;
  previousHref?: string;
  nextHref?: string;
}) {
  return (
    <nav className="month-switcher" aria-label="月を移動">
      {previousHref ? (
        <Link className="month-switcher-control" href={previousHref} aria-label="前月">
          <span aria-hidden="true">‹</span>
        </Link>
      ) : (
        <span className="month-switcher-control" aria-hidden="true" />
      )}
      <span className="month-switcher-label">{monthLabel(month)}</span>
      {nextHref ? (
        <Link className="month-switcher-control" href={nextHref} aria-label="翌月">
          <span aria-hidden="true">›</span>
        </Link>
      ) : (
        <span className="month-switcher-control" aria-hidden="true" />
      )}
    </nav>
  );
}

export function EmptyState({
  title,
  description,
  action,
  size = 'page',
  headingLevel = 2,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
  size?: 'page' | 'section';
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <div className={`empty-state empty-state-${size}`}>
      <EmptyLedgerMotif />
      <Heading>{title}</Heading>
      <p className="empty-state-description">{description}</p>
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}

type FilterCategory = { id: number; name: string; type: 'expense' | 'income' };

export function FilterBar({
  month,
  type,
  categoryId,
  categories,
  summary,
}: {
  month: string;
  type?: TransactionListType;
  categoryId?: number;
  categories: readonly FilterCategory[];
  summary: string;
}) {
  const filterCategories =
    type && type !== 'transfer'
      ? categories.filter((category) => category.type === type)
      : type === 'transfer'
        ? []
        : categories;
  return (
    <section className="filter-bar" aria-labelledby="filter-title">
      <details className="filter-details">
        <summary>
          <span className="filter-summary-action">条件を変更する</span>
          <span className="filter-summary" id="filter-title">
            {summary}
          </span>
        </summary>
        <form className="filter-form" method="get">
          <label id="filter-month-label" htmlFor="filter-month">
            月
            <MonthPickerField
              id="filter-month"
              name="month"
              value={month}
              labelId="filter-month-label"
            />
          </label>
          <label>
            種別
            <select name="type" defaultValue={type ?? ''}>
              <option value="">すべて</option>
              <option value="expense">支出</option>
              <option value="income">収入</option>
              <option value="transfer">振替</option>
            </select>
          </label>
          <label>
            カテゴリ
            <select
              name="category"
              defaultValue={categoryId ? String(categoryId) : ''}
              disabled={type === 'transfer'}
              aria-describedby={type === 'transfer' ? 'transfer-category-note' : undefined}
            >
              <option value="">すべて</option>
              {filterCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}（{category.type === 'income' ? '収入' : '支出'}）
                </option>
              ))}
            </select>
            {type === 'transfer' ? (
              <span id="transfer-category-note" className="sr-only">
                振替にはカテゴリがありません
              </span>
            ) : null}
          </label>
          <button className="button button-primary" type="submit">
            適用
          </button>
        </form>
      </details>
    </section>
  );
}
