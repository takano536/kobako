import type { Metadata } from 'next';
import { listCategories } from '@kobako/db';

import { getCurrentHouseholdId, getLedgerDatabase } from '../../../../src/lib/ledger-data';
import { ActionLink, PageHeader, PageShell } from '../../../_components/ui';
import { SingleCategoryManager } from '../../category-manager';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: '収入カテゴリ | 設定',
};

export default async function IncomeCategorySettingsPage() {
  const categories = await listCategories(getLedgerDatabase(), getCurrentHouseholdId(), 'income');
  return (
    <PageShell width="narrow">
      <PageHeader
        title="収入カテゴリ"
        titleAriaLabel="収入カテゴリ"
        count={`${categories.length}件`}
        className="settings-heading-stacked"
        actions={<ActionLink href="/settings">設定へ戻る</ActionLink>}
      />
      <SingleCategoryManager type="income" title="収入カテゴリ" categories={categories} />
    </PageShell>
  );
}
