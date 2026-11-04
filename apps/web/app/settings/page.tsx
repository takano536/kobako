import settingsStyles from './settings.module.css';
import type { Metadata } from 'next';
import { listActiveManagedAccounts } from '@kobako/db';

import { getCurrentHouseholdId, getLedgerDatabase } from '../../src/lib/ledger-data';
import { ActionLink, PageShell } from '../_components/ui';
import { PageHeader } from '../_components/page-header';
import { AppearanceSettings } from './appearance-settings';
import { OriginBadgeSetting } from './origin-badge-setting';

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
  const saved = firstQueryValue(query.saved) === '1';
  const householdId = await getCurrentHouseholdId();
  const accounts = await listActiveManagedAccounts(getLedgerDatabase(), householdId);
  return (
    <PageShell width="narrow">
      <PageHeader title="設定" />
      {saved ? (
        <p className={settingsStyles['settings-notice']} role="status">
          保存しました
        </p>
      ) : null}
      {resetCompleted ? (
        <p className={settingsStyles['settings-notice']} role="status">
          家計のデータを削除し、初期カテゴリを再作成しました。
        </p>
      ) : null}
      <div className={settingsStyles['settings-list']}>
        <section
          className={settingsStyles['settings-list-section']}
          aria-labelledby="appearance-title"
        >
          <h2 id="appearance-title">外観</h2>
          <AppearanceSettings labelledBy="appearance-title" />
          <OriginBadgeSetting />
        </section>
        <section
          className={settingsStyles['settings-list-section']}
          aria-labelledby="category-management-title"
        >
          <h2 id="category-management-title">カテゴリ管理</h2>
          <div className={settingsStyles['settings-list-rows']}>
            <ActionLink href="/settings/categories/asset">資産カテゴリ</ActionLink>
            <ActionLink href="/settings/categories/expense">支出カテゴリ</ActionLink>
            <ActionLink href="/settings/categories/income">収入カテゴリ</ActionLink>
          </div>
        </section>
        <section
          className={settingsStyles['settings-list-section']}
          aria-labelledby="account-management-title"
        >
          <h2 id="account-management-title">資産</h2>
          <ul className={settingsStyles['settings-list-rows']} aria-label="資産一覧">
            {accounts.length > 0 ? (
              accounts.map((account) => (
                <li key={account.id}>
                  <ActionLink
                    href={`/accounts/${account.id}/edit?return=${encodeURIComponent('/settings')}`}
                    scroll={false}
                  >
                    <span className={settingsStyles['settings-account-copy']}>
                      <span className={settingsStyles['settings-account-name']}>
                        {account.name}
                      </span>
                      {/* 「現金（現金）」のように名前と同じ分類名は繰り返しません。 */}
                      {account.assetCategoryName !== account.name ? (
                        <span className={settingsStyles['settings-account-category']}>
                          {account.assetCategoryName}
                        </span>
                      ) : null}
                    </span>
                  </ActionLink>
                </li>
              ))
            ) : (
              <li>
                <p>資産は残高画面から登録できます。</p>
              </li>
            )}
          </ul>
        </section>
        <section
          className={settingsStyles['settings-list-section']}
          aria-labelledby="data-management-title"
        >
          <h2 id="data-management-title">データ管理</h2>
          <div className={settingsStyles['settings-list-rows']}>
            <ActionLink href="/settings/import">取り込む</ActionLink>
            <ActionLink href="/settings/delete" variant="danger">
              すべてのデータを削除
            </ActionLink>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
