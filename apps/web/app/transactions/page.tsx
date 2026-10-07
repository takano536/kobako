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

function listHref(
  month: string,
  type?: TransactionListType,
  categoryId?: number,
  accountId?: number,
): string {
  const params = new URLSearchParams({ month });
  if (type) params.set('type', type);
  if (categoryId && type !== 'transfer') params.set('category', String(categoryId));
  if (accountId) params.set('account', String(accountId));
  return `/transactions?${params.toString()}`;
}

export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const saved = firstQueryValue(query.saved) === '1';
  const rawAccount = firstQueryValue(query.account);
  const accountId = parseTransactionAccountId(rawAccount);
  if (rawAccount !== undefined && rawAccount !== '' && accountId === undefined) notFound();
  const rawMonth = firstQueryValue(query.month);
  const db = getLedgerDatabase();
  const householdId = getCurrentHouseholdId();
  const account =
    accountId === undefined ? null : await getManagedAccount(db, householdId, accountId);
  if (accountId !== undefined && !account) notFound();
  const month =
    accountId !== undefined && rawMonth === 'all'
      ? 'all'
      : parseMonth(rawMonth, currentTokyoMonth());
  const { type, categoryId } = parseTransactionListFilters(query);
  const [rows, categories, accounts] = await Promise.all([
    listLedgerEntries(db, householdId, {
      month,
      type,
      categoryId,
      accountId,
    }),
    listCategories(db, householdId),
    listManagedAccounts(db, householdId),
  ]);

  const hasFilter = Boolean(type || categoryId || accountId);
  const categoryName = categoryId
    ? categories.find((category) => category.id === categoryId)?.name
    : undefined;
  const filterSummary = [
    type === 'expense'
      ? '支出'
      : type === 'income'
        ? '収入'
        : type === 'transfer'
          ? '振替'
          : undefined,
    categoryName,
  ]
    .filter((value): value is string => Boolean(value))
    .join('・');
  const groupedRows = groupTransactionsByDate<ListedLedgerEntry>(rows);
  const currentPath = listHref(month, type, categoryId, accountId);
  const clearAssetFilterHref = listHref(
    month === 'all' ? currentTokyoMonth() : month,
    type,
    categoryId,
  );

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
          <ActionLink href={clearAssetFilterHref} variant="quiet">
            資産の絞り込みを解除
          </ActionLink>
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
        showClearAction={rows.length > 0}
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
    </PageShell>
  );
}
