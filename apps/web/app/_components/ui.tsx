import type { ReactNode } from 'react';
import layoutStyles from './layout.module.css';
import monthStyles from './month-switcher.module.css';
import uiStyles from './ui.module.css';
import { Amount } from './amount';
import { Button, LinkButton } from './button';
import { MonthSelect } from './month-select';
import { PageTransition } from './page-transition';
import { PrefetchLink } from './prefetch-link';

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

import { formatYen, moneyTone, type MoneyTone, monthLabel } from '../../src/lib/format';
import { EmptyLedgerMotif } from '../../src/lib/category';
import type { FilterCategory, TransactionListType } from '../../src/lib/transaction-query';
import { MonthPickerField } from '../transactions/date-picker-field';

type ActionLinkVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

interface ActionLinkProps {
  href: string;
  children: ReactNode;
  variant?: ActionLinkVariant;
  icon?: ReactNode;
  scroll?: boolean;
}
export function ActionLink({ href, children, variant = 'quiet', icon, scroll }: ActionLinkProps) {
  return (
    <LinkButton href={href} variant={variant} icon={icon} scroll={scroll}>
      {children}
    </LinkButton>
  );
}

export function SignedYen({ value, tone }: { value: string | number; tone?: MoneyTone }) {
  const source =
    typeof value === 'number' ? Math.trunc(value).toString() : value.trim().replace(/^−/, '-');
  const resolvedTone = tone === 'neutral' ? 'neutral' : moneyTone(value, tone);
  const negative = source.startsWith('-');
  const absoluteValue = negative ? source.slice(1) : source;
  const toneClass = {
    neutral: uiStyles['money-amount'],
    positive: joinClasses(uiStyles['money-amount'], uiStyles['money-positive']),
    negative: joinClasses(uiStyles['money-amount'], uiStyles['money-negative']),
  }[resolvedTone];
  return (
    <Amount className={toneClass}>
      {negative ? <span className="sr-only">マイナス</span> : null}
      <span aria-hidden="true">{negative ? '−' : ''}</span>
      {formatYen(absoluteValue)}
    </Amount>
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

export function RegisterTransactionAction({ month }: { month: string }) {
  return (
    <ActionLink
      href={`/transactions/new?month=${encodeURIComponent(month)}`}
      variant="primary"
      scroll={false}
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
  transition = false,
}: {
  children: ReactNode;
  width?: 'wide' | 'narrow' | 'import';
  className?: string;
  transition?: boolean;
}) {
  const classes = joinClasses(
    layoutStyles['content-stack'],
    layoutStyles[`page-shell-${width}`],
    className,
  );
  return (
    <div data-slot="page-shell" className={classes}>
      {transition ? (
        <PageTransition className={layoutStyles['page-transition-content']}>
          {children}
        </PageTransition>
      ) : (
        children
      )}
    </div>
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
  const classes = uiStyles['section-heading'];
  return (
    <div data-slot="section-heading" className={classes}>
      <h2 id={id}>{title}</h2>
      {action ? <div className={uiStyles['section-heading-action']}>{action}</div> : null}
    </div>
  );
}

function MonthChevron({ direction }: { direction: 'previous' | 'next' }) {
  return (
    <svg className={monthStyles.chevron} viewBox="0 0 12 12" focusable="false" aria-hidden="true">
      <path
        d={
          direction === 'previous' ? 'm7.5 2.25-3.25 3.75L7.5 9.75' : 'm4.5 2.25 3.25 3.75L4.5 9.75'
        }
      />
    </svg>
  );
}

export function MonthSwitcher({
  month,
  previousHref,
  nextHref,
  selectPathname,
  selectQuery,
}: {
  month: string;
  previousHref?: string;
  nextHref?: string;
  selectPathname: string;
  selectQuery?: Record<string, string | number | undefined>;
}) {
  return (
    <nav data-slot="month-switcher" className={monthStyles.switcher} aria-label="月を移動">
      {previousHref ? (
        <PrefetchLink
          className={monthStyles.control}
          href={previousHref}
          aria-label="前月"
          scroll={false}
        >
          <MonthChevron direction="previous" />
        </PrefetchLink>
      ) : (
        <span className={monthStyles.control} aria-hidden="true" />
      )}
      <MonthSelect
        month={month}
        label={monthLabel(month)}
        pathname={selectPathname}
        query={selectQuery}
      />
      {nextHref ? (
        <PrefetchLink
          className={monthStyles.control}
          href={nextHref}
          aria-label="翌月"
          scroll={false}
        >
          <MonthChevron direction="next" />
        </PrefetchLink>
      ) : (
        <span className={monthStyles.control} aria-hidden="true" />
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
    <div
      className={joinClasses(
        uiStyles['empty-state'],
        size === 'section' && uiStyles['empty-state-section'],
      )}
    >
      <EmptyLedgerMotif />
      <Heading data-slot="empty-state-title">{title}</Heading>
      <p data-slot="empty-state-description" className={uiStyles['empty-state-description']}>
        {description}
      </p>
      {action ? (
        <div data-slot="empty-state-action" className={uiStyles['empty-state-action']}>
          {action}
        </div>
      ) : null}
    </div>
  );
}

type FilterAccount = {
  id: number;
  name: string;
  assetCategoryName: string;
  status: 'active' | 'closed';
};

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
      className={uiStyles['filter-bar']}
      aria-label="取引の絞り込み"
      aria-labelledby={summary ? 'filter-title' : undefined}
    >
      <details data-slot="filter-details" className={uiStyles['filter-details']}>
        <summary>
          <span className={uiStyles['filter-summary-action']}>条件を変更する</span>
          {summary ? (
            <span
              data-slot="filter-summary"
              className={uiStyles['filter-summary']}
              id="filter-title"
            >
              {summary}
            </span>
          ) : null}
        </summary>
        <form data-slot="filter-form" className={uiStyles['filter-form']} method="get">
          {/* 月欄はラベルが中の操作要素（select、または月グリッドの表示ボタン）を包んで関連づけます。 */}
          <label id="filter-month-label">
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
                    {account.name}（{account.assetCategoryName}）
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Button type="submit">適用</Button>
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
