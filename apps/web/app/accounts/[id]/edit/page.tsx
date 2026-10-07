import type { Metadata } from 'next';
import { getActiveManagedAccount, getCurrentCardCondition, listManagedAccounts } from '@kobako/db';
import { notFound } from 'next/navigation';

import { validatedTransactionReturn } from '../../../../src/lib/transaction-query';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../../../src/lib/ledger-data';
import { parseInt4Id } from '../../../../src/lib/ids';
import { ActionLink, PageHeader, PageShell } from '../../../_components/ui';
import { DeleteTransactionForm } from '../../../transactions/transaction-form';
import { AccountForm } from '../../account-form';
import { deleteAccountAction, updateAccountAction } from '../../actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata: Metadata = { title: '資産設定' };

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
  const [account, accounts] = await Promise.all([
    getActiveManagedAccount(db, householdId, id),
    listManagedAccounts(db, householdId),
  ]);
  if (!account) notFound();
  const cardCondition = await getCurrentCardCondition(db, householdId, id);
  return (
    <PageShell width="narrow">
      <PageHeader
        title="資産設定"
        actions={
          <ActionLink href={returnTo} variant="back">
            取引一覧へ戻る
          </ActionLink>
        }
      />
      <section className="form-surface" aria-label="資産設定">
        <div className="edit-form-layout">
          <AccountForm
            action={updateAccountAction.bind(null, idValue)}
            accounts={accounts}
            accountId={account.id}
            initialValues={{
              name: account.name,
              kind: account.kind,
              expectedKind: account.kind,
              closingDay: cardCondition?.closingDay ?? '',
              paymentDay: cardCondition?.paymentDay ?? '',
              paymentMonthOffset: cardCondition?.paymentMonthOffset ?? '',
              debitAccountId: cardCondition?.debitAccountId
                ? String(cardCondition.debitAccountId)
                : '',
            }}
            submitLabel="保存する"
            returnTo={returnTo}
          />
          <DeleteTransactionForm
            transactionId={account.id}
            formId="delete-account-form"
            action={deleteAccountAction}
            targetLabel="資産"
            idFieldName="accountId"
            cancelHref={`/accounts/${account.id}/edit?return=${encodeURIComponent(returnTo)}`}
          />
        </div>
      </section>
    </PageShell>
  );
}
