import type { Metadata } from 'next';

import { ActionLink, PageHeader, PageShell } from '../../_components/ui';
import { DeleteAllForm } from '../delete-all-form';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'すべてのデータを削除 | 設定',
};

export default function DeleteSettingsPage() {
  return (
    <PageShell width="narrow">
      <PageHeader
        title="すべてのデータを削除"
        className="settings-heading-stacked"
        actions={<ActionLink href="/settings">設定へ戻る</ActionLink>}
      />
      <section className="delete-all-scope" aria-labelledby="delete-all-remove-title">
        <h2 id="delete-all-remove-title">削除されるデータ</h2>
        <ul aria-labelledby="delete-all-remove-title">
          <li>取引・振替</li>
          <li>資産（削除済みの資産を含む）とカード設定・自動決済の記録</li>
          <li>取り込み履歴と取り込み時の資産対応</li>
          <li>支出・収入カテゴリ（追加・変更したものを含む）</li>
        </ul>
        <h2 id="delete-all-preserve-title">削除後も残るもの</h2>
        <ul aria-labelledby="delete-all-preserve-title">
          <li>固定の資産カテゴリ</li>
          <li>初期の支出・収入カテゴリ（再作成）</li>
        </ul>
      </section>
      <p className="delete-all-warning">この操作は取り消せません。</p>
      <DeleteAllForm />
    </PageShell>
  );
}
