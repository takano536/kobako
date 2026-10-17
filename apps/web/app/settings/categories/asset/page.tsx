import type { Metadata } from 'next';
import { listAssetCategories } from '@kobako/db';

import { getCurrentHouseholdId, getLedgerDatabase } from '../../../../src/lib/ledger-data';
import { PageHeader } from '../../../_components/page-header';
import { PageShell } from '../../../_components/ui';
import { AssetCategoryManager } from '../../asset-category-manager';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata: Metadata = {
  title: '資産カテゴリ | 設定',
};

export default async function AssetCategorySettingsPage() {
  const categories = await listAssetCategories(getLedgerDatabase(), getCurrentHouseholdId());
  return (
    <PageShell width="narrow">
      <PageHeader
        title="資産カテゴリ"
        titleAriaLabel="資産カテゴリ"
        count={`${categories.length}件`}
        backLink={{ href: '/settings', label: '設定へ戻る' }}
      />
      <AssetCategoryManager categories={categories} />
    </PageShell>
  );
}
