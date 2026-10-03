import type { CSSProperties } from 'react';
import {
  MAX_SUPPORTED_YEAR,
  MIN_SUPPORTED_YEAR,
  currentTokyoMonth,
  getExpenseCategoryTotals,
  getMonthlyTotals,
  listTransactions,
  parseMonth,
  shiftMonth,
} from '@kobako/db';

import { CategoryDot } from '../src/lib/category';
import { getCurrentHouseholdId, getLedgerDatabase } from '../src/lib/ledger-data';
import { expenseBarWidth, formatExpenseShare, formatYen, monthLabel } from '../src/lib/format';
import {
  ActionLink,
  EmptyState,
  MonthSwitcher,
  PageHeader,
  PageShell,
  RegisterTransactionAction,
  SectionHeading,
  SignedYen,
} from './_components/ui';
import { TransactionRow } from './transactions/transaction-row';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: '概要',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const month = parseMonth(firstQueryValue(query.month), currentTokyoMonth());
  const db = getLedgerDatabase();
  const householdId = getCurrentHouseholdId();
  const [totals, latestTransactions, categoryTotals] = await Promise.all([
    getMonthlyTotals(db, householdId, month),
    listTransactions(db, householdId, { month, limit: 5 }),
    getExpenseCategoryTotals(db, householdId, month),
  ]);

  return (
    <PageShell className="overview-page">
      <PageHeader title="概要" actions={<RegisterTransactionAction month={month} />} />
      <MonthSwitcher
        month={month}
        previousHref={
          month > `${MIN_SUPPORTED_YEAR}-01` ? `/?month=${shiftMonth(month, -1)}` : undefined
        }
        nextHref={
          month < `${MAX_SUPPORTED_YEAR}-12` ? `/?month=${shiftMonth(month, 1)}` : undefined
        }
      />

      <section className="overview-summary" role="group" aria-labelledby="expense-label">
        <div className="overview-lead">
          <h2 id="expense-label" className="eyebrow">
            この月の支出
          </h2>
          <p className="lead-amount">{formatYen(totals.expense)}</p>
        </div>

        <dl className="summary-inline" aria-label={`${monthLabel(month)}の収入と差額`}>
          <div role="group" aria-labelledby="income-total-label">
            <dt id="income-total-label">収入</dt>
            <dd>{formatYen(totals.income)}</dd>
          </div>
          <div role="group" aria-labelledby="difference-total-label">
            <dt id="difference-total-label">収支差額</dt>
            <dd>
              <SignedYen value={totals.difference} />
            </dd>
          </div>
        </dl>
      </section>

      <section className="section" aria-labelledby="breakdown-title">
        <SectionHeading
          id="breakdown-title"
          title="カテゴリ別の支出"
          action={
            <ActionLink href={`/transactions?month=${month}&type=expense`} variant="quiet">
              支出をすべて見る
            </ActionLink>
          }
        />
        {categoryTotals.length === 0 ? (
          <p className="empty-inline">この月の支出はありません。</p>
        ) : (
          <ul className="category-list">
            {categoryTotals.map((category) => {
              const categoryWidth = expenseBarWidth(category.total, totals.expense);
              return (
                <li
                  className="category-item"
                  key={category.categoryId}
                  style={{ '--category-width': `${categoryWidth}%` } as CSSProperties}
                >
                  <div className="category-row">
                    <CategoryDot type="expense" name={category.categoryName} />
                    <span className="category-name">{category.categoryName}</span>
                    <span className="category-bar" aria-hidden="true">
                      <span />
                    </span>
                    <span className="category-amount">{formatYen(category.total)}</span>
                    <small className="category-share">
                      {formatExpenseShare(category.total, totals.expense)}
                    </small>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="section recent-section" aria-labelledby="latest-title">
        <SectionHeading
          id="latest-title"
          title="最近の取引"
          action={
            <ActionLink href={`/transactions?month=${month}`} variant="quiet">
              取引一覧を見る
            </ActionLink>
          }
        />
        {latestTransactions.length === 0 ? (
          <EmptyState
            size="section"
            headingLevel={3}
            title="まだ記録がありません"
            description={
              <>
                <span className="phrase-wrap">この月の記録を、</span>
                <span className="phrase-wrap">ひとつずつ残しましょう。</span>
              </>
            }
            action={<RegisterTransactionAction month={month} variant="quiet" />}
          />
        ) : (
          <ul className="recent-list" aria-label="最近の取引">
            {latestTransactions.map((transaction) => (
              <TransactionRow key={transaction.id} transaction={transaction} />
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
