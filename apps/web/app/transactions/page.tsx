import monthStyles from '../_components/month-switcher.module.css';
import pageStyles from './transactions.module.css';
import transactionStyles from './transaction-row.module.css';
import uiStyles from '../_components/ui.module.css';
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
import { notFound } from 'next/navigation';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../src/lib/ledger-data';
import {
  formatJapaneseDate,
  formatJapaneseDateWithYear,
  groupTransactionsByDate,
} from '../../src/lib/format';
import { PageHeader } from '../_components/page-header';
import { RegisterFab } from '../_components/register-fab';
import { FilterClearLink, FilterResults, FilterTransition } from '../_components/filter-transition';
import {
  ActionLink,
  EmptyState,
  FilterBar,
  MonthSwitcher,
  PageShell,
  RegisterTransactionAction,
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
  origin?: 'api',
): string {
  const params = new URLSearchParams({ month });
  if (type) params.set('type', type);
  if (categoryId && type !== 'transfer') params.set('category', String(categoryId));
  if (accountId) params.set('account', String(accountId));
  if (origin) params.set('origin', origin);
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
  const householdId = await getCurrentHouseholdId();
  const account =
    accountId === undefined ? null : await getManagedAccount(db, householdId, accountId);
  if (accountId !== undefined && !account) notFound();
  const month =
    accountId !== undefined && rawMonth === 'all'
      ? 'all'
      : parseMonth(rawMonth, currentTokyoMonth());
  const { type, categoryId, origin } = parseTransactionListFilters(query);
  const [rows, categories, accounts] = await Promise.all([
    listLedgerEntries(db, householdId, {
      month,
      type,
      categoryId,
      accountId,
      origin,
    }),
    listCategories(db, householdId),
    listManagedAccounts(db, householdId),
  ]);

  const hasFilter = Boolean(type || categoryId || accountId || origin);
  const groupedRows = groupTransactionsByDate<ListedLedgerEntry>(rows);
  const currentMonth = currentTokyoMonth();
  const listMonth = month === 'all' ? currentMonth : month;

  return (
    <>
      <PageShell transition>
        <PageHeader title="取引" count={`${rows.length}件`} />
        {saved ? (
          <p className={pageStyles['form-message']} role="status">
            保存しました
          </p>
        ) : null}
        {month === 'all' ? (
          <div className={monthStyles.all} aria-label="表示期間">
            <span className={monthStyles.label}>全期間</span>
            <ActionLink
              href={listHref(currentMonth, type, categoryId, accountId, origin)}
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
                ? listHref(shiftMonth(month, -1), type, categoryId, accountId, origin)
                : undefined
            }
            nextHref={
              month < `${MAX_SUPPORTED_YEAR}-12`
                ? listHref(shiftMonth(month, 1), type, categoryId, accountId, origin)
                : undefined
            }
            selectPathname="/transactions"
            selectQuery={{ type, category: categoryId, account: accountId, origin }}
            allowAll={accountId !== undefined}
          />
        )}
        <FilterTransition
          month={month}
          currentMonth={currentMonth}
          type={type}
          categoryId={categoryId}
          accountId={accountId}
          origin={origin}
        >
          <FilterBar categories={categories} accounts={accounts} />

          <FilterResults className={transactionStyles['transaction-groups']} label="取引一覧">
            {rows.length === 0 ? (
              <EmptyState
                size="page"
                title={hasFilter ? '条件に合う記録がありません' : 'この月はまだ空です'}
                description={
                  hasFilter ? (
                    <>
                      <span data-slot="phrase-wrap" className={uiStyles['phrase-wrap']}>
                        条件を変えるか、
                      </span>
                      <span data-slot="phrase-wrap" className={uiStyles['phrase-wrap']}>
                        条件をクリアしてください。
                      </span>
                    </>
                  ) : (
                    <>
                      <span data-slot="phrase-wrap" className={uiStyles['phrase-wrap']}>
                        最初の取引を記録すると、
                      </span>
                      <span data-slot="phrase-wrap" className={uiStyles['phrase-wrap']}>
                        ここに並びます。
                      </span>
                    </>
                  )
                }
                action={
                  hasFilter ? (
                    <FilterClearLink href={`/transactions?month=${listMonth}`}>
                      条件をクリア
                    </FilterClearLink>
                  ) : (
                    <RegisterTransactionAction month={listMonth} />
                  )
                }
              />
            ) : (
              <ul className={transactionStyles['transaction-list']} aria-label="取引">
                {groupedRows.flatMap((group) =>
                  group.transactions.map((transaction, index) =>
                    transaction.type === 'transfer' ? (
                      <TransferRow
                        key={`transfer-${transaction.id}`}
                        transfer={transaction}
                        selectedMonth={rawMonth}
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
                        selectedMonth={rawMonth}
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
          </FilterResults>
        </FilterTransition>
      </PageShell>
      <RegisterFab
        href={`/transactions/new?month=${encodeURIComponent(listMonth)}`}
        label="取引を登録"
      />
    </>
  );
}
