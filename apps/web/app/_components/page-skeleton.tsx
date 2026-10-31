import type { ReactNode } from 'react';

import buttonStyles from './button.module.css';
import chipStyles from './filter-chips.module.css';
import headerStyles from './page-header.module.css';
import monthStyles from './month-switcher.module.css';
import skeletonStyles from './skeleton.module.css';
import styles from './page-skeleton.module.css';
import uiStyles from './ui.module.css';
import { MonthFrameSwitcher } from './month-frame-switcher';
import { CardSkeletonFields } from './card-skeleton';
import { PageShell } from './ui';

/** 本文の各部分の骨組みです。実際の画面の並びに合わせて指定します。 */
export type PageSkeletonBlock = { before?: 'group' | 'section' } & (
  | {
      /**
       * 画面固有の集計欄です。画面自身の CSS Module のクラスに `SkeletonText` を入れて渡し、
       * 実際の集計欄と同じ寸法にします。
       */
      kind: 'summary';
      content: ReactNode;
    }
  | { kind: 'filter'; content?: ReactNode }
  | {
      kind: 'list';
      title?: string;
      action?: string;
      rows: number;
      row?: 'entry' | 'line';
      amount?: boolean;
      content?: ReactNode;
      /** 取引一覧のように、この行数ごとに日付の見出しを置きます。 */
      datedEvery?: number;
    }
  | { kind: 'text'; lines: number }
  | { kind: 'form'; fields: number }
);

interface PageSkeletonProps {
  /** 読み上げ用の文言です（例: 「取引を読み込み中」）。 */
  label: string;
  title: string;
  width?: 'wide' | 'narrow' | 'import';
  /** 見出しが戻りリンクを兼ねる子画面です。 */
  back?: boolean;
  count?: boolean;
  monthSwitcher?: boolean;
  /** 月切替に表示する月です。遷移先の月が分かっているときは仮の値ではなくその月を出します。 */
  month?: string;
  blocks: readonly PageSkeletonBlock[];
}

const BONE_WIDTHS = ['72%', '56%', '64%', '48%', '60%'] as const;

function boneWidth(index: number): string {
  return BONE_WIDTHS[index % BONE_WIDTHS.length]!;
}

/** 実際の文言の幅を保ったまま、文字を透明にして面として表示します。 */
export function SkeletonText({ children }: { children: string }) {
  return <span className={skeletonStyles.text}>{children}</span>;
}

function Bone({ className, width }: { className: string | undefined; width?: string }) {
  return (
    <span
      className={`${skeletonStyles.bone} ${className ?? ''}`}
      style={width ? { width } : undefined}
    />
  );
}

function SkeletonHeader({
  title,
  back,
  count,
}: Pick<PageSkeletonProps, 'title' | 'back' | 'count'>) {
  const heading = <span className={headerStyles['heading-title']}>{title}</span>;
  return (
    <header className={headerStyles['page-header']}>
      <h1>
        {back ? (
          <span className={headerStyles['page-header-title-link']}>
            <svg
              className={headerStyles['page-header-back-chevron']}
              viewBox="0 0 12 12"
              focusable="false"
            >
              <path d="m7.5 2.25-3.25 3.75L7.5 9.75" />
            </svg>
            {heading}
          </span>
        ) : (
          heading
        )}
        {count ? (
          <span className={headerStyles['heading-count']}>
            <SkeletonText>00件</SkeletonText>
          </span>
        ) : null}
      </h1>
    </header>
  );
}

function SkeletonMonthSwitcher() {
  return (
    <div className={monthStyles.switcher}>
      <span className={monthStyles.control} />
      <span className={monthStyles.label}>
        <SkeletonText>0000年00月</SkeletonText>
      </span>
      <span className={monthStyles.control} />
    </div>
  );
}

function SkeletonSectionHeading({ title, action }: { title: string; action?: string }) {
  return (
    <div className={uiStyles['section-heading']}>
      <h2>{title}</h2>
      {action ? (
        <div className={uiStyles['section-heading-action']}>
          <span
            className={`${buttonStyles.linkButton} ${buttonStyles.linkButtonQuiet}`}
            data-variant="quiet"
          >
            <SkeletonText>{action}</SkeletonText>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function SkeletonBlockView({ block }: { block: PageSkeletonBlock }) {
  switch (block.kind) {
    case 'summary':
      return block.content;
    case 'filter':
      if (block.content !== undefined) return block.content;
      // 絞り込みのチップ行と同じ寸法で、条件なしの状態を出します。
      return (
        <div className={chipStyles.row}>
          {['種別', 'カテゴリ', '資産'].map((label) => (
            <span key={label} className={chipStyles.chip}>
              <span className={chipStyles.label}>{label}</span>
              <svg className={chipStyles.chevron} viewBox="0 0 12 12" aria-hidden="true">
                <path d="m2 4.5 4 4 4-4" />
              </svg>
            </span>
          ))}
          <span className={`${chipStyles.chip} ${chipStyles.toggle}`}>
            <svg className={chipStyles.check} viewBox="0 0 12 12" aria-hidden="true">
              <path d="m2 6.5 2.5 2.5L10 3.5" />
            </svg>
            <span className={chipStyles.label}>APIのみ</span>
          </span>
        </div>
      );
    case 'list':
      if (block.content !== undefined) return block.content;
      return (
        <div>
          {block.title ? (
            <SkeletonSectionHeading title={block.title} action={block.action} />
          ) : null}
          <ul className={styles.list}>
            {Array.from({ length: block.rows }, (_, index) => (
              <li className={styles.item} key={index}>
                {block.datedEvery && index % block.datedEvery === 0 ? (
                  <span className={styles['date-heading']}>
                    <Bone className={styles['date-bone']} />
                  </span>
                ) : null}
                <span
                  className={block.row === 'line' ? styles.line : styles.entry}
                  data-amount={block.amount ? 'true' : undefined}
                >
                  {block.row === 'line' ? null : <Bone className={styles.dot} />}
                  <Bone className={styles.primary} width={boneWidth(index)} />
                  {block.row === 'line' ? null : (
                    <Bone className={styles.secondary} width={boneWidth(index + 2)} />
                  )}
                  {block.amount ? <Bone className={styles.amount} /> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'text':
      return (
        <div className={styles.text}>
          {Array.from({ length: block.lines }, (_, index) => (
            <span className={styles['text-line']} key={index}>
              <Bone className={styles['text-bone']} width={boneWidth(index)} />
            </span>
          ))}
        </div>
      );
    case 'form':
      return <CardSkeletonFields fields={block.fields} />;
  }
}

/**
 * 画面遷移の直後に表示する本文の骨組みです。`PageShell` の幅を本文と揃え、見出し・月切替・
 * セクション・行の形を実際の部品と同じ寸法で並べます。文字が決まっている見出しはそのまま
 * 表示し、件数や金額などデータ次第の部分だけを `--soft-control` の面に置き換えます。
 * 読み上げは `role="status"` のラベル 1 回だけです。本文の View Transition
 * （`page-content`）とは名前を共有しないよう、骨組みには `ViewTransition` を付けません。
 */
export function PageSkeleton({
  label,
  title,
  width = 'wide',
  back = false,
  count = false,
  monthSwitcher = false,
  month,
  blocks,
}: PageSkeletonProps) {
  return (
    <PageShell width={width}>
      <div data-slot="page-skeleton" role="status">
        <span className="sr-only">{label}</span>
        <div aria-hidden="true">
          <SkeletonHeader title={title} back={back} count={count} />
        </div>
        {/* The month switcher stays live so a burst of taps keeps moving the shown month while one
            request is in flight. */}
        {monthSwitcher ? (
          month ? (
            <MonthFrameSwitcher month={month} />
          ) : (
            <div aria-hidden="true">
              <SkeletonMonthSwitcher />
            </div>
          )
        ) : null}
        <div aria-hidden="true">
          {blocks.map((block, index) => (
            <div
              className={styles.block}
              data-before={
                block.before ??
                (index === 0 || ('content' in block && block.content !== undefined)
                  ? undefined
                  : 'section')
              }
              key={index}
            >
              <SkeletonBlockView block={block} />
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
