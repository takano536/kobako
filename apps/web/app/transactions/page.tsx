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
  const filterSummary = `${type === 'expense' ? '支出' : type === 'income' ? '収入' : 'すべての種別'}・${categoryName ?? 'すべてのカテゴリ'}`;
  const groupedRows = groupTransactionsByDate(rows);

  return (
    <div className="content-stack transactions-page">
      <section className="page-heading" aria-labelledby="transactions-title">
        <h1 id="transactions-title">
          取引 <span className="heading-count">{rows.length}件</span>
        </h1>
        <Link className="heading-add-link" href={newTransactionHref(month)}>
          ＋ 取引を追加
        </Link>
      </section>

      <section className="filter-section" aria-labelledby="filter-title">
        <div className="filter-month-row" aria-label="月を移動">
          {month > `${MIN_SUPPORTED_YEAR}-01` ? (
            <Link href={listHref(shiftMonth(month, -1), type, categoryId)}>‹ 前月</Link>
          ) : (
            <span aria-hidden="true" />
          )}
          <p className="filter-month">{monthLabel(month)}</p>
          {month < `${MAX_SUPPORTED_YEAR}-12` ? (
            <Link href={listHref(shiftMonth(month, 1), type, categoryId)}>翌月 ›</Link>
          ) : (
            <span aria-hidden="true" />
          )}
        </div>
        <details className="filter-details">
          <summary>
            <span className="filter-summary" id="filter-title">
              {filterSummary}
            </span>
            <span className="filter-summary-action">条件を変更する</span>
          </summary>
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

      <section className="notebook-section" aria-labelledby="transactions-title">
        {rows.length === 0 ? (
          <div className="empty-state">
            <EmptyLedgerMotif />
            <h2>{hasFilter ? '条件に合う記録がありません' : 'この月はまだ空です'}</h2>
            <p>
              {hasFilter
                ? '条件を変えるか、条件をクリアしてください。'
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
          <ul className="transaction-list transaction-list-full" aria-label="取引">
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
