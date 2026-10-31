import type { ReactNode } from 'react';

import fixedCostStyles from './fixed-costs/fixed-costs.module.css';
import { PageSkeleton, SkeletonText } from './_components/page-skeleton';
import { PageSummary } from './_components/page-summary';
import { hasPageSkeleton, type PageSkeletonPath } from '../src/lib/page-skeleton-paths';

function FixedCostFilterSkeleton() {
  const filters: readonly { label: string; value?: string; arrow: boolean }[] = [
    { label: 'グループ', value: 'カテゴリ別', arrow: false },
    { label: 'カテゴリ', arrow: true },
    { label: '頻度', arrow: true },
    { label: '資産', arrow: true },
  ];
  return (
    <div className={fixedCostStyles.filters}>
      {filters.map(({ label, value, arrow }) => (
        <div className={fixedCostStyles.chipWrap} data-active="false" key={label}>
          <div className={fixedCostStyles.chip} data-active="false" data-open="false">
            <span className={fixedCostStyles.trigger}>
              <span className={fixedCostStyles.label}>{label}</span>
              {value ? <span className={fixedCostStyles.value}>{value}</span> : null}
              {arrow ? (
                <svg className={fixedCostStyles.arrow} viewBox="0 0 10 10" aria-hidden="true">
                  <path d="m2 3.5 3 3 3-3" />
                </svg>
              ) : null}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function FixedCostListSkeleton() {
  const groups = [
    ['住居', ['家賃', '駐車場']],
    ['通信', ['携帯電話', 'インターネット']],
    ['サブスクリプション', ['動画配信', '音楽配信', 'クラウドストレージ']],
  ] as const;
  return (
    <div className={fixedCostStyles.groups}>
      {groups.map(([groupName, names]) => (
        <section className={fixedCostStyles.group} key={groupName}>
          <div className={fixedCostStyles.groupHeading}>
            <h3>
              <SkeletonText>{groupName}</SkeletonText>
            </h3>
            <div className={fixedCostStyles.groupHeadingColumns}>
              <span className={fixedCostStyles.groupLabel}>金額</span>
            </div>
          </div>
          <ul className={fixedCostStyles.list}>
            {names.map((name) => (
              <li className={fixedCostStyles.row} key={name}>
                <span className={fixedCostStyles.rowLink}>
                  <span className={fixedCostStyles.nameCell}>
                    <span className={fixedCostStyles.name}>
                      <SkeletonText>{name}</SkeletonText>
                    </span>
                    <span className={fixedCostStyles.meta}>
                      <SkeletonText>毎月1日・普通預金</SkeletonText>
                    </span>
                  </span>
                  <strong className={fixedCostStyles.amount}>
                    <SkeletonText>12,345円</SkeletonText>
                  </strong>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

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
      monthSwitcher
      month={month ?? undefined}
      blocks={[
        {
          kind: 'summary',
          content: (
            <PageSummary
              label="この月の支出"
              role="group"
              primaryScale="hero"
              mobileLayout="inline"
              sticky={false}
              secondaryRole
              primary={{ label: 'この月の支出', value: <SkeletonText>¥000,000</SkeletonText> }}
              secondary={['収入', '収支差額'].map((label) => ({
                label,
                value: <SkeletonText>¥000,000</SkeletonText>,
              }))}
            />
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
      monthSwitcher
      month={month ?? undefined}
      blocks={[{ kind: 'filter' }, { kind: 'list', rows: 8, amount: true, datedEvery: 3 }]}
    />
  ),
  '/balances': () => (
    <PageSkeleton
      label="残高を読み込み中"
      title="残高"
      blocks={[
        {
          kind: 'summary',
          content: (
            <PageSummary
              label="残高の集計"
              primary={{ label: '純資産', value: <SkeletonText>¥000,000</SkeletonText> }}
              secondary={[
                { label: '資産', value: <SkeletonText>¥000,000</SkeletonText> },
                { label: '負債', value: <SkeletonText>¥000,000</SkeletonText> },
              ]}
            />
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
      blocks={[
        {
          kind: 'summary',
          content: (
            <PageSummary
              label="固定費の集計"
              primary={{ label: '月あたり', value: <SkeletonText>000,000円</SkeletonText> }}
              secondary={[{ label: '年間', value: <SkeletonText>0,000,000円</SkeletonText> }]}
            />
          ),
        },
        { kind: 'filter', content: <FixedCostFilterSkeleton /> },
        { kind: 'list', rows: 0, content: <FixedCostListSkeleton /> },
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
