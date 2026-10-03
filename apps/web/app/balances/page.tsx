import type { Metadata } from 'next';
import { getAccountBalances } from '@kobako/db';

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

export default async function BalancesPage() {
  const db = getLedgerDatabase();
  const balances = await getAccountBalances(db, getCurrentHouseholdId());
  const summary = calculateBalanceSummary(balances);

  return (
    <PageShell>
      <PageHeader title="残高" />

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

      <section className="section balances-list-section" aria-labelledby="account-balances-title">
        <SectionHeading id="account-balances-title" title="口座別の残高" />
        {balances.length === 0 ? (
          <EmptyState
            title="口座がありません"
            description="Excel ファイルを取り込むと、口座が追加されます。"
            action={
              <ActionLink href="/transactions/import" variant="quiet">
                取引を取り込む
              </ActionLink>
            }
            size="section"
          />
        ) : (
          <ul className="balance-list" aria-label="口座別残高">
            {balances.map((account) => (
              <AccountBalanceRow
                key={account.accountId}
                accountName={account.accountName}
                balance={account.balance}
              />
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
