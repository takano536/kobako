import { getFixedCostSummary, listFixedCosts } from '@kobako/db';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../src/lib/ledger-data';
import { PageHeader } from '../_components/page-header';
import { ActionLink, PageShell } from '../_components/ui';
import { FixedCostList } from './fixed-cost-list';
import styles from './fixed-costs.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata = { title: '固定費' };

export default async function FixedCostsPage() {
  const householdId = await getCurrentHouseholdId();
  const db = await getLedgerDatabase();
  const [rows, summary] = await Promise.all([listFixedCosts(db, householdId), getFixedCostSummary(db, householdId)]);
  return <PageShell width="wide">
    <PageHeader title="固定費" count={`${rows.length}件`} actions={<ActionLink href="/fixed-costs/new" variant="primary">固定費を登録</ActionLink>} />
    <div className={styles.summary} aria-label="固定費の集計">
      <div className={styles.summaryCard}><span>月あたり</span><strong>{summary.monthly.toLocaleString('ja-JP')}円</strong></div>
      <div className={styles.summaryCard}><span>年間</span><strong>{summary.annual.toLocaleString('ja-JP')}円</strong></div>
    </div>
    <FixedCostList rows={rows} />
  </PageShell>;
}
