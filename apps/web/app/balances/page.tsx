import type { Metadata } from 'next';
import {
  aggregateBankPaymentSchedules,
  currentTokyoDate,
  deriveCardBalancePaymentSchedule,
  getCardBillingSummaries,
  getManagedAccountBalances,
} from '@kobako/db';
import { AccountBalanceRow } from './account-balance-row';
import balanceStyles from './balances.module.css';
import { calculateBalanceSummary } from '../../src/lib/balances';
import { withSelectedMonth } from '../../src/lib/month-navigation';
import { firstQueryValue } from '../../src/lib/transaction-query';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../src/lib/ledger-data';
import { PageHeader } from '../_components/page-header';
import { ActionLink, EmptyState, PageShell, SectionHeading, SignedYen } from '../_components/ui';
import uiStyles from '../_components/ui.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: '残高',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function BalancesPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const accountNewHref = withSelectedMonth('/accounts/new', firstQueryValue(query.month));
  const householdId = getCurrentHouseholdId();
  const db = getLedgerDatabase();
  const today = currentTokyoDate();
  const allBalances = await getManagedAccountBalances(db, householdId);
  const balances = allBalances.filter((account) => account.deletedAt === null);
  const cardSummaries = await getCardBillingSummaries(
    db,
    householdId,
    balances
      .filter((account) => account.kind === 'credit_card')
      .map((account) => account.accountId),
    today,
  );
  const billingByAccountId = new Map(cardSummaries.map((billing) => [billing.accountId, billing]));
  const currentMonth = today.slice(0, 7);
  const scheduledByBankId = aggregateBankPaymentSchedules(cardSummaries, currentMonth);
  const summary = calculateBalanceSummary(allBalances);
  type BalanceAccount = (typeof balances)[number];
  type PaymentSchedule = {
    primaryAmount: string | null;
    secondaryAmount: string | null;
  };
  const paymentScheduleFor = (account: BalanceAccount): PaymentSchedule | undefined => {
    const billing =
      account.kind === 'credit_card' ? billingByAccountId.get(account.accountId) : undefined;
    const cardSchedule =
      account.kind === 'credit_card' &&
      billing?.settings &&
      billing.settingsComplete &&
      billing.calendarError === null
        ? deriveCardBalancePaymentSchedule(billing.periods, today)
        : null;
    if (account.kind === 'bank') {
      return {
        primaryAmount: (scheduledByBankId.get(account.accountId) ?? 0n).toString(),
        secondaryAmount: account.balance,
      };
    }
    if (account.kind === 'credit_card') {
      return {
        primaryAmount: cardSchedule?.scheduledAmount ?? null,
        secondaryAmount: cardSchedule?.unbilledAmount ?? null,
      };
    }
    return undefined;
  };
  const groups = new Map<
    number,
    {
      id: number;
      systemKey: string | null;
      name: string;
      accounts: typeof balances;
    }
  >();
  for (const account of balances) {
    const existing = groups.get(account.assetCategoryId);
    if (existing) {
      existing.accounts.push(account);
    } else {
      groups.set(account.assetCategoryId, {
        id: account.assetCategoryId,
        systemKey: account.assetCategorySystemKey,
        name: account.assetCategoryName,
        accounts: [account],
      });
    }
  }
  return (
    <PageShell>
      <PageHeader
        title="残高"
        actions={
          <ActionLink href={accountNewHref} variant="primary">
            資産を登録
          </ActionLink>
        }
      />
      <section className={balanceStyles['balance-summary']} aria-labelledby="balance-summary-title">
        <SectionHeading id="balance-summary-title" title="残高の集計" />
        <dl className={balanceStyles['balance-summary-list']}>
          <div className={balanceStyles['balance-summary-item']}>
            <dt className={balanceStyles['balance-summary-label']}>資産</dt>
            <dd className={balanceStyles['balance-summary-value']}>
              <SignedYen value={summary.assets} tone="positive" />
            </dd>
          </div>
          <div className={balanceStyles['balance-summary-item']}>
            <dt className={balanceStyles['balance-summary-label']}>負債</dt>
            <dd className={balanceStyles['balance-summary-value']}>
              <SignedYen value={summary.liabilities} tone="negative" />
            </dd>
          </div>
          <div className={balanceStyles['balance-summary-item']}>
            <dt className={balanceStyles['balance-summary-label']}>純資産</dt>
            <dd
              className={[
                balanceStyles['balance-summary-value'],
                balanceStyles['balance-summary-net'],
              ].join(' ')}
            >
              <SignedYen value={summary.net} />
            </dd>
          </div>
        </dl>
      </section>
      <section
        className={[uiStyles.section, balanceStyles['balances-list-section']].join(' ')}
        aria-label="残高一覧"
      >
        {balances.length === 0 ? (
          <EmptyState
            title="表示する資産がありません"
            description="資産を登録すると、ここに残高が表示されます。"
            action={
              <ActionLink href={accountNewHref} variant="quiet">
                資産を登録
              </ActionLink>
            }
            size="section"
          />
        ) : (
          <div className={balanceStyles['balance-groups']}>
            {Array.from(groups.values()).map((group) => {
              const headingId = `balance-group-heading-${group.id}`;
              const hasMetrics = group.systemKey === 'bank' || group.systemKey === 'credit_card';
              const columns: readonly string[] =
                group.systemKey === 'bank'
                  ? ['支払予定', '残高']
                  : group.systemKey === 'credit_card'
                    ? ['決済予定', '未決済']
                    : ['残高'];
              return (
                <section
                  data-slot="balance-group"
                  className={balanceStyles['balance-group']}
                  key={group.id}
                  aria-labelledby={headingId}
                >
                  <div
                    data-slot="balance-group-heading"
                    className={[
                      balanceStyles['balance-group-heading'],
                      hasMetrics && balanceStyles['balance-group-heading-with-metrics'],
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <h3 id={headingId}>{group.name}</h3>
                    <div
                      data-slot="balance-group-heading-columns"
                      className={[
                        balanceStyles['balance-group-heading-columns'],
                        hasMetrics && balanceStyles['balance-group-heading-columns-with-metrics'],
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {columns.map((column) => (
                        <span
                          data-slot="balance-group-heading-label"
                          className={balanceStyles['balance-group-heading-label']}
                          key={column}
                        >
                          {column}
                        </span>
                      ))}
                    </div>
                  </div>
                  <ul
                    data-slot="balance-list"
                    className={balanceStyles['balance-list']}
                    aria-labelledby={headingId}
                  >
                    {group.accounts.map((account) => (
                      <AccountBalanceRow
                        key={account.accountId}
                        accountName={account.accountName}
                        balance={account.balance}
                        kind={account.kind}
                        transactionsHref={`/transactions?account=${account.accountId}&month=all`}
                        paymentSchedule={paymentScheduleFor(account)}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </section>
    </PageShell>
  );
}
