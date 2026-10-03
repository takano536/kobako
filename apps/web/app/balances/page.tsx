import type { Metadata } from 'next';
import { getAccountBalances } from '@kobako/db';

import { calculateBalanceTotal } from '../../src/lib/balances';
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

  return (
    <PageShell>
      <PageHeader title="残高" />
      <p className="balances-description">
        登録済みの全期間の取引から計算しています。初期残高は未反映です。口座未指定の取引は含みません。未来日付も含みます。
      </p>
      {balances.length === 0 ? (
        <EmptyState
          title="口座がありません"
          description="Excel ファイルを取り込むと、口座が追加されます。"
          action={
            <ActionLink href="/transactions/import" variant="quiet">
              取引を取り込む
            </ActionLink>
          }
        />
      ) : (
        <>
          <section className="overview-summary" aria-labelledby="balance-total-label">
            <div className="overview-lead">
              <h2 id="balance-total-label" className="eyebrow">
                残高合計
              </h2>
              <p className="lead-amount">
                <SignedYen value={calculateBalanceTotal(balances)} />
              </p>
            </div>
          </section>
          <section
            className="section balances-list-section"
            aria-labelledby="account-balances-title"
          >
            <SectionHeading id="account-balances-title" title="口座別の残高" />
            <ul className="balance-list" aria-label="口座別残高">
              {balances.map((account) => (
                <li className="balance-row" key={account.accountId}>
                  <span className="balance-account-name">{account.accountName}</span>
                  <span className="balance-amount">
                    <SignedYen value={account.balance} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </PageShell>
  );
}
