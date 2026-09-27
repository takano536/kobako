import type { CSSProperties } from 'react';

export type CategoryType = 'expense' | 'income';

type CategoryPresentation = {
  background: string;
  ink: string;
  dot: string;
};

const CATEGORY_PRESENTATIONS: Record<string, CategoryPresentation> = {
  'expense:食費': { background: '#f4e5dd', ink: '#7d5143', dot: '#b49a96' },
  'expense:日用品': { background: '#e8ece4', ink: '#526451', dot: '#b0a784' },
  'expense:住居': { background: '#e9e5ef', ink: '#625578', dot: '#91a99d' },
  'expense:水道・光熱': { background: '#e1edf0', ink: '#3f6870', dot: '#98a6b0' },
  'expense:通信': { background: '#e5e9f1', ink: '#53617c', dot: '#aaa383' },
  'expense:交通': { background: '#f1e9d8', ink: '#786342', dot: '#a4b2a9' },
  'expense:医療': { background: '#f2e1e0', ink: '#814c4d', dot: '#b49a96' },
  'expense:娯楽': { background: '#eee6f0', ink: '#735378', dot: '#b09eaf' },
  'expense:その他': { background: '#ebe9e2', ink: '#60635b', dot: '#b8b7ab' },
  'income:給与': { background: '#e1eee8', ink: '#356554', dot: '#91a99d' },
  'income:臨時収入': { background: '#e8e8d9', ink: '#66623a', dot: '#b7b9ad' },
  'income:その他': { background: '#ebe9e2', ink: '#60635b', dot: '#b8b7ab' },
};

const FALLBACK_PRESENTATION: CategoryPresentation = {
  background: '#eeece6',
  ink: '#5d6058',
  dot: '#b8b7ab',
};

export function categoryPresentation(type: CategoryType, name: string): CategoryPresentation {
  return CATEGORY_PRESENTATIONS[`${type}:${name}`] ?? FALLBACK_PRESENTATION;
}

/** A quiet, color-coded marker used in place of the former category icon badges. */
export function CategoryDot({ type, name }: { type: CategoryType; name: string }) {
  const presentation = categoryPresentation(type, name);
  return (
    <span
      className="category-dot"
      style={{ '--category-dot-color': presentation.dot } as CSSProperties}
      aria-hidden="true"
    />
  );
}

export function KobakoMark({ size = 'small' }: { size?: 'small' | 'large' }) {
  return (
    <span className={`kobako-mark kobako-mark-${size}`} aria-hidden="true">
      <svg viewBox="0 0 28 24" focusable="false">
        <path d="m3 7 11-4 11 4v11l-11 4-11-4z" />
        <path d="m3 7 11 4 11-4M14 11v11" />
        <path d="m8 5 6 2 6-2" />
      </svg>
    </span>
  );
}

export function EmptyLedgerMotif() {
  return (
    <svg className="empty-motif" viewBox="0 0 88 64" focusable="false" aria-hidden="true">
      <path d="M16 20h56v34H16zM16 20l8-9h40l8 9M30 30h28M30 39h20M30 48h13" />
      <path d="M24 11v9M64 11v9" />
    </svg>
  );
}
