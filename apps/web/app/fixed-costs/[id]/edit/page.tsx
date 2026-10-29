import { notFound } from 'next/navigation';
import { listCategories, listActiveManagedAccounts } from '@kobako/db';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../../../src/lib/ledger-data';
import { PageHeader } from '../../../_components/page-header';
import { PageShell } from '../../../_components/ui';
import { FixedCostForm } from '../../fixed-cost-form';
import { deleteFixedCostAction, getFixedCostForEdit, updateFixedCostAction } from '../../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: '固定費を編集' };

type Params = Promise<{ id: string }>;

export default async function EditFixedCostPage({ params }: { params: Params }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const fixedCost = await getFixedCostForEdit(id);
  if (!fixedCost) notFound();
  const householdId = await getCurrentHouseholdId();
  const db = await getLedgerDatabase();
  const [categories, accounts] = await Promise.all([listCategories(db, householdId, 'expense'), listActiveManagedAccounts(db, householdId)]);
  const update = updateFixedCostAction.bind(null, id);
  const remove = deleteFixedCostAction.bind(null, id);
  return <PageShell width="narrow"><PageHeader title="固定費を編集" /><FixedCostForm action={update} categories={categories} accounts={accounts} submitLabel="保存する" initialValues={{ name: fixedCost.name, amount: String(fixedCost.amount), categoryId: String(fixedCost.categoryId), accountId: String(fixedCost.accountId), intervalCount: String(fixedCost.intervalCount), intervalUnit: fixedCost.intervalUnit, startMonth: fixedCost.startMonth.slice(0, 7), day: String(fixedCost.day) }} /><form action={remove}><button type="submit">削除</button></form></PageShell>;
}
