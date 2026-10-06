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
  type DisplayGroup = {
    kind: BalanceAccount['kind'];
    name: string;
    showName: boolean;
    isCardContinuation: boolean;
    columns: readonly string[];
    rows: Array<{
      account: BalanceAccount;
      paymentSchedule?: {
        scheduledAmount: string | null;
        balanceAmount: string | null;
        balanceLabel?: string;
      };
    }>;
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
  const paymentScheduleFor = (account: BalanceAccount) => {
    const billing =
      account.kind === 'credit_card' ? billingByAccountId.get(account.accountId) : undefined;
    const cardBalance = account.kind === 'credit_card' ? -BigInt(account.balance) : null;
    const cardSchedule =
      account.kind === 'credit_card' &&
      billing?.settings &&
      billing.settingsComplete &&
      billing.calendarError === null
        ? deriveCardBalancePaymentSchedule(billing.periods)
        : null;
    if (account.kind === 'bank') {
      return {
        scheduledAmount: (scheduledByBankId.get(account.accountId) ?? 0n).toString(),
        balanceAmount: account.balance,
      };
    }
    if (account.kind === 'credit_card' && cardSchedule) {
      return {
        scheduledAmount: cardSchedule.scheduledAmount,
        balanceAmount:
          cardBalance !== null && cardBalance < 0n
            ? cardBalance.toString()
            : cardSchedule.unbilledAmount,
        balanceLabel: cardBalance !== null && cardBalance < 0n ? '利用残高' : '未請求',
      };
    }
    if (account.kind === 'credit_card') {
      return {
        scheduledAmount: null,
        balanceAmount: cardBalance?.toString() ?? null,
        balanceLabel: '利用残高',
      };
    }
    return undefined;
  };
  const displayGroups: DisplayGroup[] = [];
  for (const group of groups) {
    if (group.accounts.length === 0) continue;
    const rows = group.accounts.map((account) => ({
      account,
      paymentSchedule: paymentScheduleFor(account),
    }));
    if (group.kind === 'credit_card') {
      let hasDisplayedCardGroup = false;
      for (const balanceLabel of ['未請求', '利用残高'] as const) {
        const cardRows = rows.filter((row) => row.paymentSchedule?.balanceLabel === balanceLabel);
        if (cardRows.length > 0) {
          displayGroups.push({
            kind: group.kind,
            name: group.name,
            showName: balanceLabel === '未請求',
            isCardContinuation: hasDisplayedCardGroup,
            columns: ['支払予定', balanceLabel],
            rows: cardRows,
          });
          hasDisplayedCardGroup = true;
        }
      }
    } else {
      displayGroups.push({
        kind: group.kind,
        name: group.name,
        showName: true,
        isCardContinuation: false,
        columns: group.kind === 'bank' ? ['支払予定', '残高'] : ['残高'],
        rows,
      });
    }
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
            {displayGroups.map((group, index) => {
              const headingId = `balance-group-heading-${group.kind}-${index}`;
              const hasMetrics = group.columns.length === 2;
              return (
                <section
                  className={`balance-group${group.isCardContinuation ? ' balance-group-card-continuation' : ''}`}
                  key={`${group.kind}-${group.columns.join('-')}-${index}`}
                  aria-labelledby={headingId}
                >
                  <div
                    className={`balance-group-heading${hasMetrics ? ' balance-group-heading-with-metrics' : ''}`}
                  >
                    <h3 id={headingId}>
                      {group.showName ? group.name : <span className="sr-only">{group.name}</span>}
                    </h3>
                    <div
                      className={`balance-group-heading-columns${hasMetrics ? ' balance-group-heading-columns-with-metrics' : ''}`}
                    >
                      {group.columns.map((column) => (
                        <span className="balance-group-heading-label" key={column}>
                          {column}
                        </span>
                      ))}
                    </div>
                  </div>
                  <ul
                    className={`balance-list${hasMetrics ? ' balance-list-with-metrics' : ''}`}
                    aria-labelledby={headingId}
                  >
                    {group.rows.map(({ account, paymentSchedule }) => (
                      <AccountBalanceRow
                        key={account.accountId}
                        accountName={account.accountName}
                        balance={account.balance}
                        kind={account.kind}
                        transactionsHref={`/transactions?account=${account.accountId}&month=all`}
                        paymentSchedule={paymentSchedule}
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
