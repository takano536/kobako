import type { Metadata } from 'next';
import { listCategories } from '@kobako/db';

import { getCurrentHouseholdId, getLedgerDatabase } from '../../../../src/lib/ledger-data';
import { PageHeader, PageShell } from '../../../_components/ui';
import { SingleCategoryManager } from '../../category-manager';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: '支出カテゴリ | 設定',
};

export default async function ExpenseCategorySettingsPage() {
  const categories = await listCategories(getLedgerDatabase(), getCurrentHouseholdId(), 'expense');
  return (
    <PageShell width="narrow">
      <PageHeader
        title="支出カテゴリ"
        titleAriaLabel="支出カテゴリ"
        count={`${categories.length}件`}
        backLink={{ href: '/settings', label: '設定へ戻る' }}
      />
      <SingleCategoryManager type="expense" title="支出カテゴリ" categories={categories} />
    </PageShell>
  );
}
