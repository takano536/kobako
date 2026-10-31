import { getFixedCostSummary, listFixedCosts } from '@kobako/db';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../src/lib/ledger-data';
import { PageHeader } from '../_components/page-header';
import { PageSummary } from '../_components/page-summary';
import { ActionLink, PageShell, SignedYen } from '../_components/ui';
import { FixedCostList } from './fixed-cost-list';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata = { title: '固定費' };

export default async function FixedCostsPage() {
  const householdId = await getCurrentHouseholdId();
  const db = await getLedgerDatabase();
  const [rows, summary] = await Promise.all([
    listFixedCosts(db, householdId),
    getFixedCostSummary(db, householdId),
  ]);
  return (
    <PageShell width="wide">
      <PageHeader
        title="固定費"
        count={`${rows.length}件`}
        actions={
          <ActionLink href="/fixed-costs/new" variant="primary" scroll={false}>
            固定費を登録
          </ActionLink>
        }
      />
      <PageSummary
        label="固定費の集計"
        primary={{
          label: '月あたり',
          value: <SignedYen value={summary.monthly} tone="negative" />,
        }}
        secondary={[{ label: '年間', value: <SignedYen value={summary.annual} tone="negative" /> }]}
      />
      <FixedCostList rows={rows} />
    </PageShell>
  );
}
