import type { Metadata } from 'next';
import { listActiveManagedAccounts, listAssetCategories } from '@kobako/db';
import { withSelectedMonth } from '../../../src/lib/month-navigation';
import { firstQueryValue } from '../../../src/lib/transaction-query';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../../src/lib/ledger-data';
import { Card } from '../../_components/card';
import { PageHeader } from '../../_components/page-header';
import { PageShell } from '../../_components/ui';
import { createAccountAction } from '../actions';
import { AccountForm } from '../account-form';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata: Metadata = { title: '資産を登録' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function AccountNewContent({
  searchParams,
  showCancel = false,
}: {
  searchParams: SearchParams;
  showCancel?: boolean;
}) {
  await searchParams;
  const householdId = getCurrentHouseholdId();
  const db = getLedgerDatabase();
  const [accounts, assetCategories] = await Promise.all([
    listActiveManagedAccounts(db, householdId),
    listAssetCategories(db, householdId),
  ]);
  return (
    <AccountForm
      action={createAccountAction}
      accounts={accounts}
      assetCategories={assetCategories}
      initialValues={{
        name: '',
        assetCategoryId: String(
          assetCategories.find((category) => category.systemKey === 'other')?.id ?? '',
        ),
        expectedAssetCategoryId: '',
        closingDay: '',
        paymentDay: '',
        paymentMonthOffset: '',
        debitAccountId: '',
      }}
      submitLabel="登録する"
      showCancel={showCancel}
    />
  );
}

export default async function NewAccountPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const backHref = withSelectedMonth('/balances', firstQueryValue(query.month));
  return (
    <PageShell width="narrow">
      <PageHeader
        title="資産を登録"
        titleAriaLabel="資産を登録"
        backLink={{ href: backHref, label: '残高へ戻る' }}
      />
      <Card as="section" aria-label="資産の入力">
        <AccountNewContent searchParams={searchParams} />
      </Card>
    </PageShell>
  );
}
