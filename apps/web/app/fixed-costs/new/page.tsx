import { listCategories, listActiveManagedAccounts } from '@kobako/db';
import { OverlayCard } from '../../_components/overlay-card';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../../src/lib/ledger-data';
import { PageHeader } from '../../_components/page-header';
import { PageShell } from '../../_components/ui';
import { FixedCostForm } from '../fixed-cost-form';
import { createFixedCostAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: '固定費を登録' };

export async function NewFixedCostContent({ showCancel = false }: { showCancel?: boolean }) {
  const householdId = await getCurrentHouseholdId();
  const db = await getLedgerDatabase();
  const [categories, accounts] = await Promise.all([
    listCategories(db, householdId, 'expense'),
    listActiveManagedAccounts(db, householdId),
  ]);
  return (
    <FixedCostForm
      action={createFixedCostAction}
      categories={categories}
      accounts={accounts}
      submitLabel="登録する"
      showCancel={showCancel}
      initialValues={{
        name: '',
        amount: '',
        categoryId: categories[0] ? String(categories[0].id) : '',
        accountId: accounts[0] ? String(accounts[0].id) : '',
        intervalCount: '1',
        intervalUnit: 'month',
        startMonth: new Date().toISOString().slice(0, 7),
        day: '1',
      }}
    />
  );
}

export default async function NewFixedCostPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = (await searchParams) ?? {};
  const modal = query.modal === '1';
  const content = <NewFixedCostContent showCancel={modal} />;
  if (modal) {
    return (
      <OverlayCard title="固定費を登録" kind="transaction" autoFocusSelector="#fixed-cost-name">
        {content}
      </OverlayCard>
    );
  }
  return (
    <PageShell width="narrow">
      <PageHeader title="固定費を登録" />
      {content}
    </PageShell>
  );
}
