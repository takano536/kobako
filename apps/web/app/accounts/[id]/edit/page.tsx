import formsStyles from '../../../forms.module.css';
import type { Metadata } from 'next';
import {
  getActiveManagedAccount,
  getCurrentCardCondition,
  listAssetCategories,
  listManagedAccounts,
} from '@kobako/db';
import { notFound } from 'next/navigation';

import { validatedTransactionReturn } from '../../../../src/lib/transaction-query';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../../../src/lib/ledger-data';
import { parseInt4Id } from '../../../../src/lib/ids';
import { Card } from '../../../_components/card';
import { PageHeader } from '../../../_components/page-header';
import { PageShell } from '../../../_components/ui';
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
  const [account, accounts, assetCategories] = await Promise.all([
    getActiveManagedAccount(db, householdId, id),
    listManagedAccounts(db, householdId),
    listAssetCategories(db, householdId),
  ]);
  if (!account) notFound();
  const cardCondition = await getCurrentCardCondition(db, householdId, id);
  return (
    <PageShell width="narrow">
      <PageHeader
        title="資産設定"
        titleAriaLabel="資産設定"
        backLink={{ href: returnTo, label: '取引一覧へ戻る' }}
      />
      <Card as="section" aria-label="資産設定">
        <div className={formsStyles['edit-form-layout']}>
          <AccountForm
            action={updateAccountAction.bind(null, idValue)}
            accounts={accounts}
            assetCategories={assetCategories}
            accountId={account.id}
            initialValues={{
              name: account.name,
              assetCategoryId: String(account.assetCategoryId),
              expectedAssetCategoryId: String(account.assetCategoryId),
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
      </Card>
    </PageShell>
  );
}
