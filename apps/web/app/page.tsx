import Link from 'next/link';
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

import { CategoryDot, EmptyLedgerMotif } from '../src/lib/category';
import { getCurrentHouseholdId, getLedgerDatabase } from '../src/lib/ledger-data';
import { formatExpenseShare, formatYen, monthLabel } from '../src/lib/format';
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
  const expenseTotal = BigInt(totals.expense);
  const differenceIsNegative = totals.difference.startsWith('-');
  const differenceAmount = differenceIsNegative ? totals.difference.slice(1) : totals.difference;

  return (
    <div className="content-stack overview-page">
      <nav className="month-nav" aria-label="月を移動">
        {month > `${MIN_SUPPORTED_YEAR}-01` ? (
          <Link href={`/?month=${shiftMonth(month, -1)}`} aria-label="‹ 前月">
            <span className="month-arrow" aria-hidden="true">
              ‹
            </span>
            <span className="month-nav-label">前月</span>
          </Link>
        ) : (
          <span aria-hidden="true" />
        )}
        <h1 className="month-current" aria-current="date">
          {monthLabel(month)}
        </h1>
        {month < `${MAX_SUPPORTED_YEAR}-12` ? (
          <Link href={`/?month=${shiftMonth(month, 1)}`} aria-label="翌月 ›">
            <span className="month-nav-label">翌月</span>
            <span className="month-arrow" aria-hidden="true">
              ›
            </span>
          </Link>
        ) : (
          <span aria-hidden="true" />
        )}
      </nav>

      <section className="overview-lead" role="group" aria-labelledby="expense-label">
        <h2 id="expense-label" className="eyebrow">
          この月の支出
        </h2>
        <p className="lead-amount">{formatYen(totals.expense)}</p>
      </section>

      <dl className="summary-inline" aria-label={`${monthLabel(month)}の収入と差額`}>
        <div role="group" aria-labelledby="income-total-label">
          <dt id="income-total-label">収入</dt>
          <dd>{formatYen(totals.income)}</dd>
        </div>
        <div role="group" aria-labelledby="difference-total-label">
          <dt id="difference-total-label">収支差額</dt>
          <dd>
            {differenceIsNegative ? <span className="sr-only">マイナス</span> : null}
            <span aria-hidden="true">{differenceIsNegative ? '−' : ''}</span>
            {formatYen(differenceAmount)}
          </dd>
        </div>
      </dl>

      <section className="section category-section" aria-labelledby="breakdown-title">
        <div className="section-heading">
          <h2 id="breakdown-title">カテゴリ別の支出</h2>
          <Link className="quiet-link" href={`/transactions?month=${month}&type=expense`}>
            支出をすべて見る
          </Link>
        </div>
        {categoryTotals.length === 0 ? (
          <p className="empty-inline">この月の支出はありません。</p>
        ) : (
          <ul className="category-list">
            {categoryTotals.map((category) => {
              const percentage = expenseTotal
                ? Number((BigInt(category.total) * 10000n) / expenseTotal) / 100
                : 0;
              return (
                <li
                  className="category-item"
                  key={category.categoryId}
                  style={{ '--category-width': `${Math.max(percentage, 0.8)}%` } as CSSProperties}
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
        <div className="section-heading">
          <h2 id="latest-title">最近の取引</h2>
          <Link className="quiet-link" href={`/transactions?month=${month}`}>
            取引一覧を見る
          </Link>
        </div>
        {latestTransactions.length === 0 ? (
          <div className="empty-state">
            <EmptyLedgerMotif />
            <h3>まだ記録がありません</h3>
            <p>この月の記録を、ひとつずつ残しましょう。</p>
            <Link className="text-link" href={`/transactions/new?month=${month}`}>
              最初の取引を登録する
            </Link>
          </div>
        ) : (
          <ul className="recent-list" aria-label="最近の取引">
            {latestTransactions.map((transaction) => (
              <TransactionRow key={transaction.id} transaction={transaction} />
            ))}
          </ul>
        )}
      </section>

      <Link className="register-link" href={`/transactions/new?month=${month}`}>
        <span className="register-symbol" aria-hidden="true">
          ＋
        </span>
        <span>取引を登録</span>
      </Link>
    </div>
  );
}
