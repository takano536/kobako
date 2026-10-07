import type { Metadata } from 'next';
import {
  aggregateBankPaymentSchedules,
  currentTokyoMonth,
  deriveCardBalancePaymentSchedule,
  getCardBillingSummaries,
  getManagedAccountBalances,
} from '@kobako/db';
import { AccountBalanceRow } from './account-balance-row';
import { calculateBalanceSummary } from '../../src/lib/balances';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../src/lib/ledger-data';
import {
  ActionLink,
  EmptyState,
  PageHeader,
  PageShell,
  SectionHeading,
  SignedYen,
} from '../_components/ui';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: '残高',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function BalancesPage({ searchParams }: { searchParams: SearchParams }) {
  void searchParams;
  const db = getLedgerDatabase();
  const householdId = getCurrentHouseholdId();
  const allBalances = await getManagedAccountBalances(db, householdId);
  const balances = allBalances.filter((account) => account.deletedAt === null);
  const cardSummaries = await getCardBillingSummaries(
    db,
    householdId,
    balances
      .filter((account) => account.kind === 'credit_card')
      .map((account) => account.accountId),
  );
  const billingByAccountId = new Map(cardSummaries.map((billing) => [billing.accountId, billing]));
  const currentMonth = currentTokyoMonth();
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
        ? deriveCardBalancePaymentSchedule(billing.periods)
        : null;
    if (account.kind === 'bank') {
      return {
        primaryAmount: (scheduledByBankId.get(account.accountId) ?? 0n).toString(),
        secondaryAmount: account.balance,
      };
    }
    if (account.kind === 'credit_card') {
      return {
        primaryAmount: billing?.liability ?? null,
        secondaryAmount: cardSchedule?.unbilledAmount ?? null,
      };
    }
    return undefined;
  };
  const groups: {
    kind: BalanceAccount['kind'];
    name: string;
    accounts: typeof balances;
  }[] = [
    { kind: 'cash', name: '現金', accounts: [] },
    { kind: 'bank', name: '銀行', accounts: [] },
    { kind: 'credit_card', name: 'クレジットカード', accounts: [] },
    { kind: 'debit_card', name: 'デビットカード', accounts: [] },
    { kind: 'electronic_money', name: '電子マネー', accounts: [] },
    { kind: 'other', name: 'その他', accounts: [] },
  ];
  for (const account of balances) {
    groups.find((group) => group.kind === account.kind)?.accounts.push(account);
  }
  return (
    <PageShell>
      <PageHeader
        title="残高"
        actions={
          <ActionLink href="/accounts/new" variant="primary">
            資産を登録
          </ActionLink>
        }
      />
      <section className="balance-summary" aria-labelledby="balance-summary-title">
        <SectionHeading id="balance-summary-title" title="残高の集計" />
        <dl className="balance-summary-list">
          <div className="balance-summary-item">
            <dt className="balance-summary-label">資産</dt>
            <dd className="balance-summary-value">
              <SignedYen value={summary.assets} tone="positive" />
            </dd>
          </div>
          <div className="balance-summary-item">
            <dt className="balance-summary-label">負債</dt>
            <dd className="balance-summary-value">
              <SignedYen value={summary.liabilities} tone="negative" />
            </dd>
          </div>
          <div className="balance-summary-item">
            <dt className="balance-summary-label">純資産</dt>
            <dd className="balance-summary-value balance-summary-net">
              <SignedYen value={summary.net} />
            </dd>
          </div>
        </dl>
      </section>
      <section className="section balances-list-section" aria-label="残高一覧">
        {balances.length === 0 ? (
          <EmptyState
            title="表示する資産がありません"
            description="資産を登録すると、ここに残高が表示されます。"
            action={
              <ActionLink href="/accounts/new" variant="quiet">
                資産を登録
              </ActionLink>
            }
            size="section"
          />
        ) : (
          <div className="balance-groups">
            {groups
              .filter((group) => group.accounts.length > 0)
              .map((group, index) => {
                const headingId = `balance-group-heading-${group.kind}-${index}`;
                const hasMetrics = group.kind === 'bank' || group.kind === 'credit_card';
                const columns: readonly string[] =
                  group.kind === 'bank'
                    ? ['支払予定', '残高']
                    : group.kind === 'credit_card'
                      ? ['未決済残高', 'カード残高']
                      : ['残高'];
                return (
                  <section className="balance-group" key={group.kind} aria-labelledby={headingId}>
                    <div
                      className={`balance-group-heading${hasMetrics ? ' balance-group-heading-with-metrics' : ''}`}
                    >
                      <h3 id={headingId}>{group.name}</h3>
                      <div
                        className={`balance-group-heading-columns${hasMetrics ? ' balance-group-heading-columns-with-metrics' : ''}`}
                      >
                        {columns.map((column) => (
                          <span className="balance-group-heading-label" key={column}>
                            {column}
                          </span>
                        ))}
                      </div>
                    </div>
                    <ul className="balance-list" aria-labelledby={headingId}>
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
