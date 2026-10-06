import type { Metadata } from 'next';
import { currentTokyoMonth, getCardBillingSummaries, getManagedAccountBalances } from '@kobako/db';
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
  const scheduledByBankId = new Map<number, bigint>();
  for (const billing of cardSummaries) {
    if (!billing.settingsComplete || billing.calendarError !== null) continue;
    const debitAccountId = billing.settings?.debitAccountId;
    if (debitAccountId === null || debitAccountId === undefined) continue;
    const dueThisMonth = billing.periods
      .filter(
        (period) =>
          period.dueOn.startsWith(`${currentMonth}-`) &&
          period.status !== 'unbilled' &&
          BigInt(period.remaining) > 0n,
      )
      .reduce((sum, period) => sum + BigInt(period.remaining), 0n);
    scheduledByBankId.set(
      debitAccountId,
      (scheduledByBankId.get(debitAccountId) ?? 0n) + dueThisMonth,
    );
  }
  const summary = calculateBalanceSummary(allBalances);
  const groups: {
    kind: (typeof balances)[number]['kind'];
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
      <section className="section balances-list-section" aria-labelledby="asset-balances-title">
        <SectionHeading id="asset-balances-title" title="資産別の残高" />
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
              .map((group) => (
                <section className="balance-group" key={group.kind}>
                  <h3>{group.name}</h3>
                  <ul className="balance-list" aria-label={`${group.name}の資産別残高`}>
                    {group.accounts.map((account) => {
                      const billing =
                        account.kind === 'credit_card'
                          ? billingByAccountId.get(account.accountId)
                          : undefined;
                      const paymentSchedule =
                        account.kind === 'bank'
                          ? {
                              amount: (scheduledByBankId.get(account.accountId) ?? 0n).toString(),
                            }
                          : account.kind === 'credit_card' && billing?.settings
                            ? billing.settingsComplete && billing.calendarError === null
                              ? billing.nextPayment
                                ? {
                                    amount: billing.nextPayment.amount,
                                    dueOn: billing.nextPayment.dueOn,
                                  }
                                : { amount: '0' }
                              : { settingsHref: `/accounts/${account.accountId}/edit` }
                            : undefined;
                      return (
                        <AccountBalanceRow
                          accountName={account.accountName}
                          balance={account.balance}
                          kind={account.kind}
                          transactionsHref={`/transactions?account=${account.accountId}&month=all`}
                          paymentSchedule={paymentSchedule}
                        />
                      );
                    })}
                  </ul>
                </section>
              ))}
          </div>
        )}
      </section>
    </PageShell>
  );
}
