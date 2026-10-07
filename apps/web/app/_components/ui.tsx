import Link from 'next/link';
import type { ReactNode } from 'react';

import { EmptyLedgerMotif } from '../../src/lib/category';
import {
  formatYen,
  moneyTone,
  moneyToneClass,
  type MoneyTone,
  monthLabel,
} from '../../src/lib/format';
import type { FilterCategory, TransactionListType } from '../../src/lib/transaction-query';
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

export function SignedYen({ value, tone }: { value: string | number; tone?: MoneyTone }) {
  const source =
    typeof value === 'number' ? Math.trunc(value).toString() : value.trim().replace(/^−/, '-');
  const resolvedTone = tone === 'neutral' ? 'neutral' : moneyTone(value, tone);
  const negative = source.startsWith('-');
  const absoluteValue = negative ? source.slice(1) : source;
  return (
    <span className={moneyToneClass(resolvedTone)}>
      {negative ? <span className="sr-only">マイナス</span> : null}
      <span aria-hidden="true">{negative ? '−' : ''}</span>
      {formatYen(absoluteValue)}
    </span>
  );
}

export function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="m9.7 3.7.5-1.2h3.6l.5 1.2 1 .4 1.2-.5 2.5 2.5-.5 1.2.4 1 1.2.5v3.6l-1.2.5-.4 1 .5 1.2-2.5 2.5-1.2-.5-1 .4-.5 1.2h-3.6l-.5-1.2-1-.4-1.2.5-2.5-2.5.5-1.2-.4-1-1.2-.5V8.8l1.2-.5.4-1-.5-1.2 2.5-2.5 1.2.5 1-.4Z" />
      <circle cx="12" cy="10.6" r="2.5" />
    </svg>
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

type FilterAccount = { id: number; name: string; status: 'active' | 'closed' };

export function FilterBar({
  month,
  type,
  categoryId,
  accountId,
  categories,
  accounts,
  summary,
  showClearAction = false,
}: {
  month: string;
  type?: TransactionListType;
  categoryId?: number;
  accountId?: number;
  categories: readonly FilterCategory[];
  accounts?: readonly FilterAccount[];
  summary?: string;
  showClearAction?: boolean;
}) {
  const filterCategories =
    type && type !== 'transfer'
      ? categories.filter((category) => category.type === type)
      : type === 'transfer'
        ? []
        : categories;
  const clearParams = new URLSearchParams({ month });
  if (accountId !== undefined) clearParams.set('account', String(accountId));
  const clearAdditionalFiltersHref = `/transactions?${clearParams.toString()}`;
  const hasAdditionalFilter = Boolean(type || categoryId);
  return (
    <section
      className="filter-bar"
      aria-label="取引の絞り込み"
      aria-labelledby={summary ? 'filter-title' : undefined}
    >
      <details className="filter-details">
        <summary>
          <span className="filter-summary-action">条件を変更する</span>
          {summary ? (
            <span className="filter-summary" id="filter-title">
              {summary}
            </span>
          ) : null}
        </summary>
        <form className="filter-form" method="get">
          <label id="filter-month-label" htmlFor="filter-month">
            月
            {accountId !== undefined ? (
              <select id="filter-month" name="month" defaultValue={month}>
                <option value="all">全期間</option>
                {month !== 'all' ? <option value={month}>{monthLabel(month)}</option> : null}
              </select>
            ) : (
              <MonthPickerField
                id="filter-month"
                name="month"
                value={month}
                labelId="filter-month-label"
              />
            )}
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
          {accounts ? (
            <label>
              資産
              <select name="account" defaultValue={accountId ? String(accountId) : ''}>
                <option value="">すべて</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button className="button button-primary" type="submit">
            適用
          </button>
        </form>
      </details>
      {showClearAction && hasAdditionalFilter ? (
        <ActionLink href={clearAdditionalFiltersHref} variant="quiet">
          条件をクリアする
        </ActionLink>
      ) : null}
    </section>
  );
}
