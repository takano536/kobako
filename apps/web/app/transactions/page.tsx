import {
  MAX_SUPPORTED_YEAR,
  MIN_SUPPORTED_YEAR,
  currentTokyoMonth,
  getManagedAccount,
  listCategories,
  listLedgerEntries,
  listManagedAccounts,
  parseMonth,
  shiftMonth,
  type ListedLedgerEntry,
} from '@kobako/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../src/lib/ledger-data';
import {
  formatJapaneseDate,
  formatJapaneseDateWithYear,
  groupTransactionsByDate,
} from '../../src/lib/format';
import {
  ActionLink,
  EmptyState,
  FilterBar,
  MonthSwitcher,
  PageHeader,
  PageShell,
  RegisterTransactionAction,
  SettingsIcon,
} from '../_components/ui';
import {
  firstQueryValue,
  parseTransactionAccountId,
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

const PAGE_SIZE = 50;

function listHref(
  month: string,
  type?: TransactionListType,
  categoryId?: number,
  accountId?: number,
  page?: number,
): string {
  const params = new URLSearchParams({ month });
  if (type) params.set('type', type);
  if (categoryId && type !== 'transfer') params.set('category', String(categoryId));
  if (accountId) params.set('account', String(accountId));
  if (page && page > 1) params.set('page', String(page));
  return `/transactions?${params.toString()}`;
}

export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const saved = firstQueryValue(query.saved) === '1';
  const rawAccount = firstQueryValue(query.account);
  const accountId = parseTransactionAccountId(rawAccount);
  if (rawAccount !== undefined && rawAccount !== '' && accountId === undefined) notFound();
  const rawMonth = firstQueryValue(query.month);
  const month =
    accountId !== undefined && rawMonth === 'all'
      ? 'all'
      : parseMonth(rawMonth, currentTokyoMonth());
  const { type, categoryId, page = 1 } = parseTransactionListFilters(query);
  const db = getLedgerDatabase();
  const householdId = getCurrentHouseholdId();
  const [fetchedRows, categories, accounts, account] = await Promise.all([
    listLedgerEntries(db, householdId, {
      month,
      type,
      categoryId,
      accountId,
      limit: PAGE_SIZE + 1,
      offset: (page - 1) * PAGE_SIZE,
    }),
    listCategories(db, householdId),
    listManagedAccounts(db, householdId),
    accountId === undefined ? Promise.resolve(null) : getManagedAccount(db, householdId, accountId),
  ]);
  if (accountId !== undefined && !account) notFound();
  const hasNextPage = fetchedRows.length > PAGE_SIZE;
  const rows = hasNextPage ? fetchedRows.slice(0, PAGE_SIZE) : fetchedRows;
  const hasFilter = Boolean(type || categoryId || accountId);
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
  const filterSummary = `${typeName}・${type === 'transfer' ? 'カテゴリなし' : (categoryName ?? 'すべてのカテゴリ')}${account ? `・資産: ${account.name}` : ''}`;
  const groupedRows = groupTransactionsByDate<ListedLedgerEntry>(rows);
  const currentPath = listHref(month, type, categoryId, accountId, page);

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
            <RegisterTransactionAction month={month === 'all' ? currentTokyoMonth() : month} />
          </>
        }
      />
      {saved ? (
        <p className="form-message" role="status">
          保存しました
        </p>
      ) : null}
      {account ? (
        <section className="asset-transaction-header" aria-labelledby="asset-filter-title">
          <div className="asset-transaction-heading">
            {account.deletedAt === null ? (
              <Link
                className="asset-settings-link"
                href={`/accounts/${account.id}/edit?return=${encodeURIComponent(currentPath)}`}
                aria-label="資産設定"
                title="資産設定"
              >
                <SettingsIcon />
              </Link>
            ) : null}
            <h2 id="asset-filter-title">{account.name}</h2>
          </div>
        </section>
      ) : null}
      {month === 'all' ? (
        <div className="month-switcher month-switcher-all" aria-label="表示期間">
          <span className="month-switcher-label">全期間</span>
          <ActionLink
            href={listHref(currentTokyoMonth(), type, categoryId, accountId)}
            variant="quiet"
          >
            月で絞り込む
          </ActionLink>
        </div>
      ) : (
        <MonthSwitcher
          month={month}
          previousHref={
            month > `${MIN_SUPPORTED_YEAR}-01`
              ? listHref(shiftMonth(month, -1), type, categoryId, accountId)
              : undefined
          }
          nextHref={
            month < `${MAX_SUPPORTED_YEAR}-12`
              ? listHref(shiftMonth(month, 1), type, categoryId, accountId)
              : undefined
          }
        />
      )}
      <FilterBar
        month={month}
        type={type}
        categoryId={categoryId}
        accountId={accountId}
        categories={categories}
        accounts={accounts}
        summary={filterSummary}
      />

      <section className="transaction-groups" aria-label="取引一覧">
        {rows.length === 0 ? (
          <EmptyState
            size="page"
            title={hasFilter ? '条件に合う記録がありません' : 'この月はまだ空です'}
            description={
              hasFilter ? (
                <>
                  <span className="phrase-wrap">条件を変えるか、</span>
                  <span className="phrase-wrap">条件をクリアしてください。</span>
                </>
              ) : (
                <>
                  <span className="phrase-wrap">最初の取引を記録すると、</span>
                  <span className="phrase-wrap">ここに並びます。</span>
                </>
              )
            }
            action={
              hasFilter ? (
                <ActionLink href={`/transactions?month=${month}`} variant="quiet">
                  条件をクリアする
                </ActionLink>
              ) : (
                <RegisterTransactionAction
                  month={month === 'all' ? currentTokyoMonth() : month}
                  variant="quiet"
                />
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
                      index === 0
                        ? (month === 'all' ? formatJapaneseDateWithYear : formatJapaneseDate)(
                            group.occurredOn,
                          )
                        : undefined
                    }
                  />
                ) : (
                  <TransactionRow
                    key={`transaction-${transaction.id}`}
                    transaction={transaction}
                    showMemo
                    showDate={false}
                    dateHeading={
                      index === 0
                        ? (month === 'all' ? formatJapaneseDateWithYear : formatJapaneseDate)(
                            group.occurredOn,
                          )
                        : undefined
                    }
                  />
                ),
              ),
            )}
          </ul>
        )}
      </section>
      {page > 1 || hasNextPage ? (
        <nav aria-label="取引のページ移動" className="pagination">
          {page > 1 ? (
            <ActionLink
              href={listHref(month, type, categoryId, accountId, page - 1)}
              variant="secondary"
            >
              前の50件
            </ActionLink>
          ) : null}
          <span aria-current="page">{page}ページ</span>
          {hasNextPage ? (
            <ActionLink
              href={listHref(month, type, categoryId, accountId, page + 1)}
              variant="secondary"
            >
              次の50件
            </ActionLink>
          ) : null}
        </nav>
      ) : null}
    </PageShell>
  );
}
