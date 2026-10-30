import type { ReactNode } from 'react';

import balanceStyles from './balances/balances.module.css';
import overviewStyles from './overview.module.css';
import { PageSkeleton, SkeletonText } from './_components/page-skeleton';
import { SectionHeading } from './_components/ui';
import { hasPageSkeleton, type PageSkeletonPath } from '../src/lib/page-skeleton-paths';

const REGISTER_TRANSACTION = { label: '取引を登録', icon: '＋' };

function CategorySettingsSkeleton({ title }: { title: string }) {
  return (
    <PageSkeleton
      label={`${title}を読み込み中`}
      title={title}
      width="narrow"
      back
      count
      blocks={[
        { kind: 'list', before: 'group', rows: 6, row: 'line' },
        { kind: 'form', before: 'group', fields: 1 },
      ]}
    />
  );
}

/**
 * 画面ごとの骨組みです。各画面の見出し・月切替・集計欄・一覧の並びに合わせています。
 * 取引・資産の登録と編集はクライアント遷移ではカードとして開く（`@modal`）ため、
 * ここには置きません。
 */
const pageSkeletons: Record<PageSkeletonPath, (month?: string | null) => ReactNode> = {
  '/': (month) => (
    <PageSkeleton
      label="概要を読み込み中"
      title="概要"
      action={REGISTER_TRANSACTION}
      monthSwitcher
      month={month ?? undefined}
      blocks={[
        {
          kind: 'summary',
          content: (
            <div className={overviewStyles['overview-summary']}>
              <div className={overviewStyles['overview-lead']}>
                <h2 className={overviewStyles.eyebrow}>この月の支出</h2>
                <p className={overviewStyles['lead-amount']}>
                  <SkeletonText>¥000,000</SkeletonText>
                </p>
              </div>
              <dl className={overviewStyles['summary-inline']}>
                {['収入', '収支差額'].map((label) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>
                      <SkeletonText>¥000,000</SkeletonText>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ),
        },
        {
          kind: 'list',
          title: '支出カテゴリ別の支出',
          action: '支出をすべて見る',
          rows: 5,
          row: 'line',
          amount: true,
        },
        {
          kind: 'list',
          title: '最近の取引',
          action: '取引一覧を見る',
          rows: 5,
          amount: true,
          datedEvery: 1,
        },
      ]}
    />
  ),
  '/transactions': (month) => (
    <PageSkeleton
      label="取引を読み込み中"
      title="取引"
      count
      action={REGISTER_TRANSACTION}
      monthSwitcher
      month={month ?? undefined}
      blocks={[{ kind: 'filter' }, { kind: 'list', rows: 8, amount: true, datedEvery: 3 }]}
    />
  ),
  '/balances': () => (
    <PageSkeleton
      label="残高を読み込み中"
      title="残高"
      action={{ label: '資産を登録' }}
      blocks={[
        {
          kind: 'summary',
          content: (
            <div className={balanceStyles['balance-summary']}>
              <SectionHeading title="残高の集計" />
              <dl className={balanceStyles['balance-summary-list']}>
                {['資産', '負債', '純資産'].map((label) => (
                  <div className={balanceStyles['balance-summary-item']} key={label}>
                    <dt className={balanceStyles['balance-summary-label']}>{label}</dt>
                    <dd className={balanceStyles['balance-summary-value']}>
                      <SkeletonText>¥000,000</SkeletonText>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ),
        },
        { kind: 'list', rows: 4, row: 'line', amount: true },
      ]}
    />
  ),
  '/fixed-costs': () => (
    <PageSkeleton
      label="固定費を読み込み中"
      title="固定費"
      count
      action={{ label: '固定費を登録' }}
      blocks={[
        {
          kind: 'summary',
          content: (
            <div>
              <SectionHeading title="固定費の集計" />
              <SkeletonText>¥000,000</SkeletonText>
            </div>
          ),
        },
        { kind: 'filter' },
        { kind: 'list', rows: 8, amount: true },
      ]}
    />
  ),
  '/settings': () => (
    <PageSkeleton
      label="設定を読み込み中"
      title="設定"
      width="narrow"
      blocks={[
        { kind: 'list', before: 'section', title: 'カテゴリ管理', rows: 3, row: 'line' },
        { kind: 'list', title: 'データ管理', rows: 2, row: 'line' },
      ]}
    />
  ),
  '/settings/categories/asset': () => <CategorySettingsSkeleton title="資産カテゴリ" />,
  '/settings/categories/expense': () => <CategorySettingsSkeleton title="支出カテゴリ" />,
  '/settings/categories/income': () => <CategorySettingsSkeleton title="収入カテゴリ" />,
  '/settings/delete': () => (
    <PageSkeleton
      label="すべてのデータを削除を読み込み中"
      title="すべてのデータを削除"
      width="narrow"
      back
      blocks={[
        { kind: 'text', before: 'group', lines: 8 },
        { kind: 'form', before: 'group', fields: 1 },
      ]}
    />
  ),
  '/settings/import': () => (
    <PageSkeleton
      label="取り込みを読み込み中"
      title="らくな家計簿から引っ越す"
      width="import"
      back
      blocks={[
        { kind: 'text', lines: 1 },
        { kind: 'form', fields: 2 },
      ]}
    />
  ),
};

export function pageSkeletonFor(pathname: string, month?: string | null): ReactNode | null {
  if (!hasPageSkeleton(pathname)) return null;
  return pageSkeletons[pathname](month);
}
