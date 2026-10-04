import type { Metadata } from 'next';
import {
  getAccountReferenceSummary,
  getManagedAccount,
  listAccountGroups,
  listManagedAccounts,
} from '@kobako/db';
import { notFound } from 'next/navigation';

import { validatedTransactionReturn } from '../../../../src/lib/transaction-query';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../../../src/lib/ledger-data';
import { parseInt4Id } from '../../../../src/lib/ids';
import { ActionLink, PageHeader, PageShell } from '../../../_components/ui';
import { AccountForm } from '../../account-form';
import { deleteAccountAction, updateAccountAction } from '../../actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata: Metadata = { title: '口座を編集' };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EditAccountPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id: idValue } = await params;
  const id = parseInt4Id(idValue);
  if (id === undefined) notFound();
  const query = await searchParams;
  const returnTo =
    validatedTransactionReturn(firstQueryValue(query.return), id) ??
    `/transactions?account=${id}&month=all`;
  const db = getLedgerDatabase();
  const householdId = getCurrentHouseholdId();
  const [account, groups, accounts, references] = await Promise.all([
    getManagedAccount(db, householdId, id),
    listAccountGroups(db, householdId),
    listManagedAccounts(db, householdId),
    getAccountReferenceSummary(db, householdId, id),
  ]);
  if (!account) notFound();
  return (
    <PageShell width="narrow">
      <PageHeader
        title="口座を編集"
        actions={
          <ActionLink href={returnTo} variant="back">
            取引一覧へ戻る
          </ActionLink>
        }
      />
      <AccountForm
        action={updateAccountAction.bind(null, idValue)}
        groups={groups}
        existingNames={accounts
          .filter((candidate) => candidate.id !== account.id)
          .map((candidate) => candidate.name)}
        initialValues={{
          name: account.name,
          kind: account.kind,
          groupId: String(account.groupId),
          status: account.status,
          expectedKind: account.kind,
          confirmKindChange: false,
        }}
        submitLabel="保存する"
        editing
        returnTo={returnTo}
      />
      {account.kind === 'credit_card' ? (
        <section className="section">
          <ActionLink
            href={`/accounts/${account.id}/card?return=${encodeURIComponent(returnTo)}`}
            variant="secondary"
          >
            カードの締め日・支払日を管理
          </ActionLink>
        </section>
      ) : null}
      <section className="danger-zone" aria-labelledby="delete-account-title">
        <h2 id="delete-account-title">口座を削除</h2>
        <p>取引・振替・取り込み履歴などの参照がある口座は削除できません。</p>
        {references.cardConditions > 0 ? (
          <p>{`この口座のカード条件（${references.cardConditions}件）も削除されます`}</p>
        ) : null}
        <details className="delete-details">
          <summary className="button button-danger">この口座を削除する</summary>
          <form action={deleteAccountAction}>
            <input type="hidden" name="accountId" value={account.id} />
            <input type="hidden" name="confirm" value="delete" />
            <button className="button button-danger" type="submit">
              削除を確定
            </button>
          </form>
        </details>
      </section>
    </PageShell>
  );
}
