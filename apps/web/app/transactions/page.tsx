import Link from 'next/link';

import {
  MAX_SUPPORTED_YEAR,
  MIN_SUPPORTED_YEAR,
  currentTokyoMonth,
  listCategories,
  listTransactions,
  parseMonth,
  shiftMonth,
} from '@kobako/db';

import { EmptyLedgerMotif } from '../../src/lib/category';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../src/lib/ledger-data';
import { formatJapaneseDate, groupTransactionsByDate, monthLabel } from '../../src/lib/format';
import { parseInt4Id } from '../../src/lib/ids';
import { TransactionRow } from './transaction-row';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: '取引',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type TransactionType = 'expense' | 'income';

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseType(value: string | undefined): TransactionType | undefined {
  return value === 'expense' || value === 'income' ? value : undefined;
}

function parseCategoryId(value: string | undefined): number | undefined {
  return value ? parseInt4Id(value) : undefined;
}

function listHref(month: string, type?: TransactionType, categoryId?: number): string {
  const params = new URLSearchParams({ month });
  if (type) params.set('type', type);
  if (categoryId) params.set('category', String(categoryId));
  return `/transactions?${params.toString()}`;
}

function newTransactionHref(month: string): string {
  return `/transactions/new?${new URLSearchParams({ month }).toString()}`;
}

export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const month = parseMonth(firstQueryValue(query.month), currentTokyoMonth());
  const type = parseType(firstQueryValue(query.type));
  const categoryId = parseCategoryId(firstQueryValue(query.category));
  const db = getLedgerDatabase();
  const householdId = getCurrentHouseholdId();
  const [rows, categories] = await Promise.all([
    listTransactions(db, householdId, { month, type, categoryId }),
    listCategories(db, householdId),
  ]);
  const filterCategories = type
    ? categories.filter((category) => category.type === type)
    : categories;
  const hasFilter = Boolean(type || categoryId);
  const categoryName = categoryId
    ? categories.find((category) => category.id === categoryId)?.name
    : undefined;
  const filterSummary = `${monthLabel(month)}・${type === 'expense' ? '支出' : type === 'income' ? '収入' : 'すべて'}・${categoryName ?? 'すべてのカテゴリ'}`;
  const groupedRows = groupTransactionsByDate(rows);

  return (
    <div className="content-stack transactions-page">
      <section className="page-heading" aria-labelledby="transactions-title">
        <div>
          <p className="eyebrow">小さな家計ノート</p>
          <h1 id="transactions-title">取引</h1>
        </div>
        <Link className="button button-secondary" href={newTransactionHref(month)}>
          <span aria-hidden="true">＋</span> 取引を追加
        </Link>
      </section>

      <nav className="month-nav" aria-label="月を移動">
        {month > `${MIN_SUPPORTED_YEAR}-01` ? (
          <Link href={listHref(shiftMonth(month, -1), type, categoryId)}>‹ 前月</Link>
        ) : (
          <span aria-hidden="true" />
        )}
        <span aria-current="date">対象月：{monthLabel(month)}</span>
        {month < `${MAX_SUPPORTED_YEAR}-12` ? (
          <Link href={listHref(shiftMonth(month, 1), type, categoryId)}>翌月 ›</Link>
        ) : (
          <span aria-hidden="true" />
        )}
      </nav>

      <section className="filter-section" aria-labelledby="filter-title">
        <p className="filter-summary" id="filter-title">
          {filterSummary}
        </p>
        <details className="filter-details">
          <summary>条件を変更する</summary>
          <form className="filter-form" method="get">
            <label>
              月
              <input type="month" name="month" defaultValue={month} />
            </label>
            <label>
              種別
              <select name="type" defaultValue={type ?? ''}>
                <option value="">すべて</option>
                <option value="expense">支出</option>
                <option value="income">収入</option>
              </select>
            </label>
            <label>
              カテゴリ
              <select name="category" defaultValue={categoryId ? String(categoryId) : ''}>
                <option value="">すべて</option>
                {filterCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}（{category.type === 'income' ? '収入' : '支出'}）
                  </option>
                ))}
              </select>
            </label>
            <button className="button button-secondary" type="submit">
              適用
            </button>
          </form>
        </details>
      </section>

      <section className="notebook-section" aria-labelledby="list-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">記録</p>
            <h2 id="list-title">取引一覧</h2>
          </div>
          <span className="result-count">{rows.length}件</span>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">
            <EmptyLedgerMotif />
            <h3>{hasFilter ? '条件に合う記録がありません' : 'この月はまだ空です'}</h3>
            <p>
              {hasFilter
                ? '条件を変えるか、すべての条件を表示してみてください。'
                : '最初の取引を記録すると、ここに並びます。'}
            </p>
            {hasFilter ? (
              <Link className="text-link" href={`/transactions?month=${month}`}>
                条件をクリアする
              </Link>
            ) : (
              <Link className="text-link" href={newTransactionHref(month)}>
                取引を登録する
              </Link>
            )}
          </div>
        ) : (
          <ul className="transaction-list transaction-list-full" aria-labelledby="list-title">
            {groupedRows.flatMap((group) =>
              group.transactions.map((transaction, index) => (
                <TransactionRow
                  key={transaction.id}
                  transaction={transaction}
                  showMemo
                  showDate={false}
                  dateHeading={index === 0 ? formatJapaneseDate(group.occurredOn) : undefined}
                />
              )),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
