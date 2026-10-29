import { listCategories, listActiveManagedAccounts } from '@kobako/db';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../../src/lib/ledger-data';
import { PageHeader } from '../../_components/page-header';
import { PageShell } from '../../_components/ui';
import { FixedCostForm } from '../fixed-cost-form';
import { createFixedCostAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: '固定費を登録' };

export default async function NewFixedCostPage() {
  const householdId = await getCurrentHouseholdId();
  const db = await getLedgerDatabase();
  const [categories, accounts] = await Promise.all([listCategories(db, householdId, 'expense'), listActiveManagedAccounts(db, householdId)]);
  return <PageShell width="narrow"><PageHeader title="固定費を登録" /><FixedCostForm action={createFixedCostAction} categories={categories} accounts={accounts} submitLabel="登録する" initialValues={{ name: '', amount: '', categoryId: categories[0] ? String(categories[0].id) : '', accountId: accounts[0] ? String(accounts[0].id) : '', intervalCount: '1', intervalUnit: 'month', startMonth: new Date().toISOString().slice(0, 7), day: '1' }} /></PageShell>;
}
