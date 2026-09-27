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

import { CategoryIcon, EmptyLedgerMotif } from '../src/lib/category';
import { formatYen, monthLabel } from '../src/lib/format';
import { getCurrentHouseholdId, getLedgerDatabase } from '../src/lib/ledger-data';
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

  return (
    <div className="content-stack overview-page">
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

      <section className="overview-intro" aria-labelledby="overview-title">
        <p className="eyebrow">小さな家計ノート</p>
        <h1 id="overview-title">{monthLabel(month)}</h1>
      </section>

      <section className="expense-hero" role="group" aria-labelledby="expense-label">
        <p className="hero-label" id="expense-label">
          この月の支出
        </p>
        <p className="hero-amount">{formatYen(totals.expense)}</p>
        <p className="hero-note">使ったお金を、ゆっくり見返せます。</p>
      </section>

      <dl className="secondary-summary" aria-label={`${monthLabel(month)}の収入と差額`}>
        <div className="secondary-summary-item" role="group" aria-labelledby="income-total-label">
          <dt id="income-total-label">収入</dt>
          <dd>{formatYen(totals.income)}</dd>
        </div>
        <div
          className="secondary-summary-item"
          role="group"
          aria-labelledby="difference-total-label"
        >
          <dt id="difference-total-label">収支差額</dt>
          <dd>{formatYen(totals.difference)}</dd>
        </div>
      </dl>

      <section className="notebook-section" aria-labelledby="breakdown-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">支出の内訳</p>
            <h2 id="breakdown-title">カテゴリ別</h2>
          </div>
          <Link href={`/transactions?month=${month}&type=expense`}>支出をすべて見る</Link>
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
                <li className="category-item" key={category.categoryId}>
                  <div className="category-line">
                    <span className="category-label">
                      <CategoryIcon type="expense" name={category.categoryName} />
                      <span>{category.categoryName}</span>
                    </span>
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

      <section className="notebook-section" aria-labelledby="latest-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">記録</p>
            <h2 id="latest-title">最近の取引</h2>
          </div>
          <Link href={`/transactions?month=${month}`}>取引一覧を見る</Link>
        </div>
        {latestTransactions.length === 0 ? (
          <div className="empty-state">
            <EmptyLedgerMotif />
            <h3>まだ記録がありません</h3>
            <p>この月のお金を、ひとつずつしまっていきましょう。</p>
            <Link className="text-link" href={`/transactions/new?month=${month}`}>
              最初の取引を登録する
            </Link>
          </div>
        ) : (
          <ul className="transaction-list" aria-label="最近の取引">
            {latestTransactions.map((transaction) => (
              <TransactionRow key={transaction.id} transaction={transaction} />
            ))}
          </ul>
        )}
      </section>

      <section className="overview-add" aria-label="取引の追加">
        <p>忘れないうちに、今日の記録を。</p>
        <Link className="add-link" href={`/transactions/new?month=${month}`}>
          <span className="add-link-icon" aria-hidden="true">
            ＋
          </span>
          <span>取引を登録</span>
        </Link>
      </section>
    </div>
  );
}
