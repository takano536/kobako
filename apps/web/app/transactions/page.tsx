import {
  MAX_SUPPORTED_YEAR,
  MIN_SUPPORTED_YEAR,
  currentTokyoMonth,
  getCardBillingSummary,
  getManagedAccount,
  isCalendarDate,
  listCategories,
  listLedgerEntries,
  listManagedAccounts,
  parseMonth,
  shiftMonth,
  type CardBillingPeriod,
  type CardBillingSummary,
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
  SectionHeading,
  SettingsIcon,
  SignedYen,
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
  periodStart?: string,
  periodEnd?: string,
): string {
  const params = new URLSearchParams({ month });
  if (type) params.set('type', type);
  if (categoryId && type !== 'transfer') params.set('category', String(categoryId));
  if (accountId) params.set('account', String(accountId));
  if (page && page > 1) params.set('page', String(page));
  if (periodStart && periodEnd) {
    params.set('periodStart', periodStart);
    params.set('periodEnd', periodEnd);
  }
  return `/transactions?${params.toString()}`;
}

const BILLING_STATUS_LABELS: Record<CardBillingPeriod['status'], string> = {
  unbilled: '未請求',
  'billed-unpaid': '未払い',
  overdue: '期限超過',
  paid: '支払済',
};

function CardStatementPeriod({
  period,
  accountId,
  debitAccountId,
  currentPath,
  isLatestClosed,
  isSelected,
}: {
  period: CardBillingPeriod;
  accountId: number;
  debitAccountId: number | null;
  currentPath: string;
  isLatestClosed?: boolean;
  isSelected?: boolean;
}) {
  const periodHref = listHref(
    'all',
    undefined,
    undefined,
    accountId,
    undefined,
    period.periodStart,
    period.periodEnd,
  );
  const hasRemaining = BigInt(period.remaining) > 0n;
  const paymentQuery = new URLSearchParams({
    type: 'transfer',
    payment: '1',
    toAccountId: String(accountId),
    amount: hasRemaining ? period.remaining : '',
    occurredOn: period.dueOn,
    remaining: period.remaining,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    return: currentPath,
  });
  if (debitAccountId !== null) {
    paymentQuery.set('fromAccountId', String(debitAccountId));
  }
  const statusLabel =
    period.status === 'paid' && BigInt(period.remaining) < 0n
      ? '支払済（クレジット）'
      : BILLING_STATUS_LABELS[period.status];
  return (
    <article className="card-statement" data-latest-closed={isLatestClosed ? 'true' : undefined}>
      <h3>
        <span>
          {`${formatJapaneseDateWithYear(period.periodStart)}〜${formatJapaneseDateWithYear(period.periodEnd)}`}
        </span>
        <span className="card-statement-due">
          支払日 {formatJapaneseDateWithYear(period.dueOn)}
        </span>
      </h3>
      <dl className="card-statement-details">
        <div>
          <dt>請求額</dt>
          <dd>
            <SignedYen value={period.charge} tone="neutral" />
          </dd>
        </div>
        <div>
          <dt>支払済</dt>
          <dd>
            <SignedYen value={period.paid} tone="neutral" />
          </dd>
        </div>
        <div>
          <dt>残り</dt>
          <dd>
            <SignedYen value={period.remaining} tone="neutral" />
          </dd>
        </div>
        <div>
          <dt>状態</dt>
          <dd>{statusLabel}</dd>
        </div>
      </dl>
      <div className="card-statement-actions">
        {isSelected ? (
          <span className="action-link action-link-quiet" aria-current="page">
            この期間の取引
          </span>
        ) : (
          <ActionLink href={periodHref} variant="quiet">
            この期間の取引
          </ActionLink>
        )}
        {hasRemaining ? (
          <ActionLink href={`/transactions/new?${paymentQuery.toString()}`} variant="primary">
            支払いを記録
          </ActionLink>
        ) : null}
      </div>
    </article>
  );
}

function CardBillingSection({
  summary,
  accountId,
  currentPath,
  selectedPeriod,
}: {
  summary: CardBillingSummary;
  accountId: number;
  currentPath: string;
  selectedPeriod?: { periodStart: string; periodEnd: string };
}) {
  const billingUnavailable = !summary.settingsComplete || summary.calendarError !== null;
  if (billingUnavailable) {
    return (
      <section className="section" aria-labelledby="card-billing-title">
        <SectionHeading id="card-billing-title" title="カード請求" />
        <p className="form-message" role="status">
          カード条件を確認できません。 <Link href={`/accounts/${accountId}/edit`}>設定</Link>
        </p>
      </section>
    );
  }
  const closedPeriods = summary.periods.filter((period) => period.status !== 'unbilled');
  const latestClosed = closedPeriods[closedPeriods.length - 1];
  const statementPeriods = [
    ...summary.periods.filter(
      (period) =>
        period !== latestClosed &&
        (period.status === 'overdue' || period.status === 'billed-unpaid'),
    ),
    ...(latestClosed ? [latestClosed] : []),
    ...summary.periods.filter((period) => period.status === 'unbilled'),
  ];
  return (
    <section className="section card-billing-section" aria-labelledby="card-billing-title">
      <SectionHeading id="card-billing-title" title="カード請求" />
      {statementPeriods.length > 0 ? (
        <div className="card-statement-list">
          {statementPeriods.map((period) => (
            <CardStatementPeriod
              key={`${period.periodStart}-${period.periodEnd}`}
              period={period}
              accountId={accountId}
              debitAccountId={summary.settings?.debitAccountId ?? null}
              currentPath={currentPath}
              isLatestClosed={period === latestClosed}
              isSelected={
                selectedPeriod?.periodStart === period.periodStart &&
                selectedPeriod.periodEnd === period.periodEnd
              }
            />
          ))}
        </div>
      ) : null}
      {summary.blockedAutoPayments.length > 0 ? (
        <div className="card-billing-blocked">
          {summary.blockedAutoPayments.map((notice) => (
            <p className="form-message" role="status" key={notice.dueOn}>
              自動決済を実行できません（{formatJapaneseDateWithYear(notice.dueOn)}）：{' '}
              {notice.reason ?? '引落口座を確認してください。'}{' '}
              <Link href={`/accounts/${accountId}/edit`}>設定</Link>
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const saved = firstQueryValue(query.saved) === '1';
  const rawAccount = firstQueryValue(query.account);
  const accountId = parseTransactionAccountId(rawAccount);
  if (rawAccount !== undefined && rawAccount !== '' && accountId === undefined) notFound();
  const rawMonth = firstQueryValue(query.month);
  const { type, categoryId, page = 1, periodStart, periodEnd } = parseTransactionListFilters(query);
  const parsedPeriodStart = periodStart && isCalendarDate(periodStart) ? periodStart : undefined;
  const parsedPeriodEnd = periodEnd && isCalendarDate(periodEnd) ? periodEnd : undefined;
  const db = getLedgerDatabase();
  const householdId = getCurrentHouseholdId();
  const account =
    accountId === undefined ? null : await getManagedAccount(db, householdId, accountId);
  if (accountId !== undefined && !account) notFound();
  const cardAccount = account?.kind === 'credit_card';
  const selectedPeriod =
    cardAccount && parsedPeriodStart && parsedPeriodEnd && parsedPeriodStart <= parsedPeriodEnd
      ? { periodStart: parsedPeriodStart, periodEnd: parsedPeriodEnd }
      : undefined;
  const month =
    selectedPeriod || (accountId !== undefined && rawMonth === 'all')
      ? 'all'
      : parseMonth(rawMonth, currentTokyoMonth());
  const [fetchedRows, categories, accounts, billingSummary] = await Promise.all([
    listLedgerEntries(db, householdId, {
      month,
      type,
      categoryId,
      accountId,
      periodStart: selectedPeriod?.periodStart,
      periodEnd: selectedPeriod?.periodEnd,
      limit: PAGE_SIZE + 1,
      offset: (page - 1) * PAGE_SIZE,
    }),
    listCategories(db, householdId),
    listManagedAccounts(db, householdId),
    cardAccount
      ? getCardBillingSummary(db, householdId, accountId as number)
      : Promise.resolve(null),
  ]);
  const hasNextPage = fetchedRows.length > PAGE_SIZE;
  const rows = hasNextPage ? fetchedRows.slice(0, PAGE_SIZE) : fetchedRows;
  const hasFilter = Boolean(type || categoryId || accountId || selectedPeriod);
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
  const currentPath = listHref(
    month,
    type,
    categoryId,
    accountId,
    page,
    selectedPeriod?.periodStart,
    selectedPeriod?.periodEnd,
  );
  const clearAssetFilterHref = listHref(
    month === 'all' ? currentTokyoMonth() : month,
    type,
    categoryId,
    undefined,
    page,
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
      {selectedPeriod ? (
        <div className="month-switcher month-switcher-all" aria-label="表示期間">
          <span className="month-switcher-label filter-summary">
            {`${formatJapaneseDateWithYear(selectedPeriod.periodStart)}〜${formatJapaneseDateWithYear(selectedPeriod.periodEnd)}`}
          </span>
          <ActionLink href={listHref('all', type, categoryId, accountId)} variant="quiet">
            全期間で表示
          </ActionLink>
        </div>
      ) : month === 'all' ? (
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
        periodStart={selectedPeriod?.periodStart}
        periodEnd={selectedPeriod?.periodEnd}
        categories={categories}
        accounts={accounts}
        summary={filterSummary}
        showClearAction={rows.length > 0}
      />
      {cardAccount && billingSummary ? (
        <CardBillingSection
          summary={billingSummary}
          accountId={accountId as number}
          currentPath={currentPath}
          selectedPeriod={selectedPeriod}
        />
      ) : null}

      <section className="transaction-groups" aria-label="取引一覧">
        {cardAccount ? <SectionHeading title="明細" /> : null}
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
              href={listHref(
                month,
                type,
                categoryId,
                accountId,
                page - 1,
                selectedPeriod?.periodStart,
                selectedPeriod?.periodEnd,
              )}
              variant="secondary"
            >
              前の50件
            </ActionLink>
          ) : null}
          <span aria-current="page">{page}ページ</span>
          {hasNextPage ? (
            <ActionLink
              href={listHref(
                month,
                type,
                categoryId,
                accountId,
                page + 1,
                selectedPeriod?.periodStart,
                selectedPeriod?.periodEnd,
              )}
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
