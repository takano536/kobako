import Link from 'next/link';

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

import { getCurrentHouseholdId, getLedgerDatabase } from '../src/lib/ledger-data';
import { formatYen, monthLabel } from '../src/lib/format';
import { TransactionRow } from './transactions/transaction-row';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: '月次概要',
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
  const maxCategoryTotal = categoryTotals[0] ? BigInt(categoryTotals[0].total) : 0n;

  return (
    <div className="content-stack">
      <section className="page-heading" aria-labelledby="overview-title">
        <div>
          <p className="eyebrow">月次概要</p>
          <h1 id="overview-title">{monthLabel(month)}</h1>
        </div>
        <Link className="button button-primary" href={`/transactions/new?month=${month}`}>
          取引を登録
        </Link>
      </section>

      <nav className="month-nav" aria-label="月を移動">
        {month > `${MIN_SUPPORTED_YEAR}-01` ? (
          <Link href={`/?month=${shiftMonth(month, -1)}`}>‹ 前月</Link>
        ) : (
          <span aria-hidden="true" />
        )}
        <span aria-current="date">{monthLabel(month)}</span>
        {month < `${MAX_SUPPORTED_YEAR}-12` ? (
          <Link href={`/?month=${shiftMonth(month, 1)}`}>翌月 ›</Link>
        ) : (
          <span aria-hidden="true" />
        )}
      </nav>

      <dl className="summary-grid" aria-label={`${monthLabel(month)}の集計`}>
        <div className="summary-card" role="group" aria-labelledby="income-total-label">
          <dt id="income-total-label">収入合計</dt>
          <dd>{formatYen(totals.income)}</dd>
        </div>
        <div className="summary-card" role="group" aria-labelledby="expense-total-label">
          <dt id="expense-total-label">支出合計</dt>
          <dd>{formatYen(totals.expense)}</dd>
        </div>
        <div
          className="summary-card summary-card-difference"
          role="group"
          aria-labelledby="difference-total-label"
        >
          <dt id="difference-total-label">収支差額</dt>
          <dd>{formatYen(totals.difference)}</dd>
        </div>
      </dl>

      <section className="panel" aria-labelledby="breakdown-title">
        <div className="section-heading">
          <h2 id="breakdown-title">支出のカテゴリ別</h2>
          <Link href={`/transactions?month=${month}&type=expense`}>支出をすべて見る</Link>
        </div>
        {categoryTotals.length === 0 ? (
          <p className="empty-state">この月の支出はありません。</p>
        ) : (
          <ul className="category-list">
            {categoryTotals.map((category) => {
              const percentage = maxCategoryTotal
                ? Number((BigInt(category.total) * 100n) / maxCategoryTotal)
                : 0;
              return (
                <li key={category.categoryId}>
                  <div className="category-line">
                    <span>{category.categoryName}</span>
                    <strong>{formatYen(category.total)}</strong>
                  </div>
                  <div className="category-bar" aria-hidden="true">
                    <span style={{ width: `${percentage}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel" aria-labelledby="latest-title">
        <div className="section-heading">
          <h2 id="latest-title">最近の取引</h2>
          <Link href={`/transactions?month=${month}`}>取引一覧を見る</Link>
        </div>
        {latestTransactions.length === 0 ? (
          <div className="empty-state">
            <p>この月の取引はまだありません。</p>
            <Link className="text-link" href={`/transactions/new?month=${month}`}>
              最初の取引を登録する
            </Link>
          </div>
        ) : (
          <ul className="transaction-list">
            {latestTransactions.map((transaction) => (
              <TransactionRow key={transaction.id} transaction={transaction} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
