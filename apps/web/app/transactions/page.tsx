import {
  MAX_SUPPORTED_YEAR,
  MIN_SUPPORTED_YEAR,
  currentTokyoMonth,
  listCategories,
  listLedgerEntries,
  parseMonth,
  shiftMonth,
  type ListedLedgerEntry,
} from '@kobako/db';

import { getCurrentHouseholdId, getLedgerDatabase } from '../../src/lib/ledger-data';
import { formatJapaneseDateShort, groupTransactionsByDate } from '../../src/lib/format';
import {
  ActionLink,
  EmptyState,
  FilterBar,
  MonthSwitcher,
  PageHeader,
  PageShell,
  RegisterTransactionAction,
} from '../_components/ui';
import {
  firstQueryValue,
  parseTransactionListFilters,
  type TransactionListType,
} from '../../src/lib/transaction-query';
import { TransactionRow } from './transaction-row';
import { TransferRow } from './transfer-row';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: '取引',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function listHref(month: string, type?: TransactionListType, categoryId?: number): string {
  const params = new URLSearchParams({ month });
  if (type) params.set('type', type);
  if (categoryId && type !== 'transfer') params.set('category', String(categoryId));
  return `/transactions?${params.toString()}`;
}

export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const month = parseMonth(firstQueryValue(query.month), currentTokyoMonth());
  const { type, categoryId } = parseTransactionListFilters(query);
  const db = getLedgerDatabase();
  const householdId = getCurrentHouseholdId();
  const [rows, categories] = await Promise.all([
    listLedgerEntries(db, householdId, { month, type, categoryId }),
    listCategories(db, householdId),
  ]);
  const hasFilter = Boolean(type || categoryId);
  const categoryName = categoryId
    ? categories.find((category) => category.id === categoryId)?.name
    : undefined;
  const typeName =
    type === 'expense'
      ? '支出'
      : type === 'income'
        ? '収入'
        : type === 'transfer'
          ? '振替'
          : 'すべての種別';
  const filterSummary = `${typeName}・${type === 'transfer' ? 'カテゴリなし' : (categoryName ?? 'すべてのカテゴリ')}`;
  const groupedRows = groupTransactionsByDate<ListedLedgerEntry>(rows);

  return (
    <PageShell>
      <PageHeader
        title="取引"
        count={`${rows.length}件`}
        actions={
          <>
            <ActionLink href="/transactions/import" variant="secondary">
              取り込む
            </ActionLink>
            <RegisterTransactionAction month={month} />
          </>
        }
      />
      <MonthSwitcher
        month={month}
        previousHref={
          month > `${MIN_SUPPORTED_YEAR}-01`
            ? listHref(shiftMonth(month, -1), type, categoryId)
            : undefined
        }
        nextHref={
          month < `${MAX_SUPPORTED_YEAR}-12`
            ? listHref(shiftMonth(month, 1), type, categoryId)
            : undefined
        }
      />
      <FilterBar
        month={month}
        type={type}
        categoryId={categoryId}
        categories={categories}
        summary={filterSummary}
      />

      <section className="transaction-groups" aria-label="取引一覧">
        {rows.length === 0 ? (
          <EmptyState
            size="page"
            title={hasFilter ? '条件に合う記録がありません' : 'この月はまだ空です'}
            description={
              hasFilter
                ? '条件を変えるか、条件をクリアしてください。'
                : '最初の取引を記録すると、ここに並びます。'
            }
            action={
              hasFilter ? (
                <ActionLink href={`/transactions?month=${month}`} variant="quiet">
                  条件をクリアする
                </ActionLink>
              ) : (
                <RegisterTransactionAction month={month} variant="quiet" />
              )
            }
          />
        ) : (
          <ul className="transaction-list transaction-list-full" aria-label="取引">
            {groupedRows.flatMap((group) =>
              group.transactions.map((transaction, index) =>
                transaction.type === 'transfer' ? (
                  <TransferRow
                    key={`transfer-${transaction.id}`}
                    transfer={transaction}
                    showMemo
                    dateHeading={
                      index === 0 ? formatJapaneseDateShort(group.occurredOn) : undefined
                    }
                  />
                ) : (
                  <TransactionRow
                    key={`transaction-${transaction.id}`}
                    transaction={transaction}
                    showMemo
                    showDate={false}
                    dateHeading={
                      index === 0 ? formatJapaneseDateShort(group.occurredOn) : undefined
                    }
                  />
                ),
              ),
            )}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
