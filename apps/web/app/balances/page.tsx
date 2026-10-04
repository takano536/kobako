import type { Metadata } from 'next';
import { getManagedAccountBalances } from '@kobako/db';
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

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function BalancesPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const showClosed = firstQueryValue(query.showClosed) === '1';
  const db = getLedgerDatabase();
  const allBalances = await getManagedAccountBalances(db, getCurrentHouseholdId());
  const balances = showClosed
    ? allBalances
    : allBalances.filter((account) => account.status !== 'closed' || account.balance !== '0');
  const summary = calculateBalanceSummary(allBalances);
  const groups: { id: number; name: string; accounts: typeof balances }[] = [];
  for (const account of balances) {
    const group = groups[groups.length - 1];
    if (!group || group.id !== account.groupId) {
      groups.push({ id: account.groupId, name: account.groupName, accounts: [account] });
    } else {
      group.accounts.push(account);
    }
  }

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
      <p className="balances-description">
        登録済みの全期間の取引から計算しています。初期残高は未反映です。口座未指定の取引は含みません。未来日付も含みます。
      </p>

      <section className="section balances-list-section" aria-labelledby="account-balances-title">
        <SectionHeading
          id="account-balances-title"
          title="口座別の残高"
          action={
            <ActionLink
              href={showClosed ? '/balances' : '/balances?showClosed=1'}
              variant="secondary"
            >
              {showClosed ? '利用終了の口座（残高0円）を隠す' : '利用終了の口座（残高0円）を表示'}
            </ActionLink>
          }
        />
        {balances.length === 0 ? (
          <EmptyState
            title="表示する口座がありません"
            description={
              allBalances.length === 0
                ? '口座を登録すると、ここに残高が表示されます。'
                : '利用終了で残高0円の口座は非表示です。'
            }
            action={
              allBalances.length === 0 ? (
                <ActionLink href="/accounts/new" variant="quiet">
                  口座を登録
                </ActionLink>
              ) : undefined
            }
            size="section"
          />
        ) : (
          <div className="balance-groups">
            {groups.map((group) => {
              const groupSummary = calculateBalanceSummary(group.accounts);
              return (
                <section
                  className="balance-group"
                  key={group.id}
                  aria-labelledby={`balance-group-${group.id}`}
                >
                  <h3 id={`balance-group-${group.id}`}>{group.name}</h3>
                  <ul className="balance-list" aria-label={`${group.name}の口座別残高`}>
                    {group.accounts.map((account) => (
                      <AccountBalanceRow
                        key={account.accountId}
                        accountName={account.accountName}
                        balance={account.balance}
                        kind={account.kind}
                        status={account.status}
                        transactionsHref={`/transactions?account=${account.accountId}&month=all`}
                      />
                    ))}
                  </ul>
                  <dl className="balance-group-subtotal" aria-label={`${group.name}の小計`}>
                    <div>
                      <dt>資産</dt>
                      <dd>
                        <SignedYen value={groupSummary.assets} tone="positive" />
                      </dd>
                    </div>
                    <div>
                      <dt>負債</dt>
                      <dd>
                        <SignedYen value={groupSummary.liabilities} tone="negative" />
                      </dd>
                    </div>
                    <div>
                      <dt>純額</dt>
                      <dd>
                        <SignedYen value={groupSummary.net} />
                      </dd>
                    </div>
                  </dl>
                </section>
              );
            })}
          </div>
        )}
      </section>
    </PageShell>
  );
}
