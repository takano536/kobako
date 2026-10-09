import type { Metadata } from 'next';

import { ActionLink, PageHeader, PageShell } from '../_components/ui';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const metadata: Metadata = {
  title: '設定',
};

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const resetCompleted = firstQueryValue(query.reset) === 'done';
  return (
    <PageShell width="narrow">
      <PageHeader title="設定" />
      {resetCompleted ? (
        <p className="settings-notice" role="status">
          家計のデータを削除し、初期カテゴリを再作成しました。
        </p>
      ) : null}
      <div className="settings-list">
        <section className="settings-list-section" aria-labelledby="category-management-title">
          <h2 id="category-management-title">カテゴリ管理</h2>
          <div className="settings-list-rows">
            <ActionLink href="/settings/categories/asset">資産カテゴリ</ActionLink>
            <ActionLink href="/settings/categories/expense">支出カテゴリ</ActionLink>
            <ActionLink href="/settings/categories/income">収入カテゴリ</ActionLink>
          </div>
        </section>
        <section
          className="settings-list-section settings-list-section-danger"
          aria-labelledby="data-management-title"
        >
          <h2 id="data-management-title">データ管理</h2>
          <div className="settings-list-rows">
            <ActionLink href="/settings/delete" variant="quiet">
              すべてのデータを削除
            </ActionLink>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
