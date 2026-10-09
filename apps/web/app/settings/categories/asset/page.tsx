import type { Metadata } from 'next';

import { ACCOUNT_KIND_OPTIONS } from '../../../../src/lib/account-kind';
import { ActionLink, PageHeader, PageShell } from '../../../_components/ui';

export const metadata: Metadata = {
  title: '資産カテゴリ | 設定',
};

export default function AssetCategorySettingsPage() {
  return (
    <PageShell width="narrow">
      <PageHeader
        title="資産カテゴリ"
        actions={<ActionLink href="/settings">設定へ戻る</ActionLink>}
      />
      <div className="settings-fixed-assets">
        <p className="settings-help">固定の分類です。追加・削除・名前変更はできません。</p>
        <ul className="settings-fixed-asset-list" aria-label="資産カテゴリの一覧">
          {ACCOUNT_KIND_OPTIONS.map(([value, label]) => (
            <li key={value}>{label}</li>
          ))}
        </ul>
      </div>
    </PageShell>
  );
}
