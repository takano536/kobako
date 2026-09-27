import type { CSSProperties } from 'react';

export type CategoryType = 'expense' | 'income';

type CategoryPresentation = {
  icon:
    | 'food'
    | 'bag'
    | 'home'
    | 'water'
    | 'phone'
    | 'train'
    | 'medical'
    | 'spark'
    | 'wallet'
    | 'gift'
    | 'box';
  background: string;
  ink: string;
};

const CATEGORY_PRESENTATIONS: Record<string, CategoryPresentation> = {
  'expense:食費': { icon: 'food', background: '#f4e5dd', ink: '#7d5143' },
  'expense:日用品': { icon: 'bag', background: '#e8ece4', ink: '#526451' },
  'expense:住居': { icon: 'home', background: '#e9e5ef', ink: '#625578' },
  'expense:水道・光熱': { icon: 'water', background: '#e1edf0', ink: '#3f6870' },
  'expense:通信': { icon: 'phone', background: '#e5e9f1', ink: '#53617c' },
  'expense:交通': { icon: 'train', background: '#f1e9d8', ink: '#786342' },
  'expense:医療': { icon: 'medical', background: '#f2e1e0', ink: '#814c4d' },
  'expense:娯楽': { icon: 'spark', background: '#eee6f0', ink: '#735378' },
  'expense:その他': { icon: 'box', background: '#ebe9e2', ink: '#60635b' },
  'income:給与': { icon: 'wallet', background: '#e1eee8', ink: '#356554' },
  'income:臨時収入': { icon: 'gift', background: '#e8e8d9', ink: '#66623a' },
  'income:その他': { icon: 'box', background: '#ebe9e2', ink: '#60635b' },
};

const FALLBACK_PRESENTATION: CategoryPresentation = {
  icon: 'box',
  background: '#eeece6',
  ink: '#5d6058',
};

export function categoryPresentation(type: CategoryType, name: string): CategoryPresentation {
  return CATEGORY_PRESENTATIONS[`${type}:${name}`] ?? FALLBACK_PRESENTATION;
}

type IconName = CategoryPresentation['icon'];

function IconPath({ icon }: { icon: IconName }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.7,
  };

  switch (icon) {
    case 'food':
      return (
        <>
          <path
            {...common}
            d="M7 3v7m0-3H4m3 0h3M5.5 3v4.5A1.5 1.5 0 0 0 7 9a1.5 1.5 0 0 0 1.5-1.5V3M7 9v8M14 3v14m0-14c1.7 1 2.2 2.8 2.2 4.5H14"
          />
        </>
      );
    case 'bag':
      return <path {...common} d="M4.5 6.5h11l.8 10h-12zM7 6.5V5a2 2 0 0 1 4 0v1.5" />;
    case 'home':
      return <path {...common} d="m3.5 8.5 4.8-4 4.9 4v7h-3.2v-4h-3v4H3.5zM13.2 6.2l1.5-1.2v3" />;
    case 'water':
      return (
        <path
          {...common}
          d="M10 3.5c2 2.6 4.1 4.8 4.1 7.1A4.1 4.1 0 1 1 5.9 10.6C5.9 8.3 8 6.1 10 3.5Z"
        />
      );
    case 'phone':
      return (
        <path
          {...common}
          d="M6.2 3.5 8 3l1.2 3.2-1.4 1.1c.8 1.6 2 2.8 3.6 3.6l1.1-1.4 3.2 1.2-.5 1.8c-.3 1-1.3 1.6-2.3 1.3a11.1 11.1 0 0 1-7.7-7.7c-.3-1 .3-2 1.3-2.3Z"
        />
      );
    case 'train':
      return (
        <path
          {...common}
          d="M6 14.5h8M7 17l1.2-2.5M13 14.5l1.2 2.5M6 11.5h8M7 4h6a2 2 0 0 1 2 2v7H5V6a2 2 0 0 1 2-2Zm1.5 3h3M8 11.5v.1M12 11.5v.1"
        />
      );
    case 'medical':
      return <path {...common} d="M7 3.5h6v4h4v6h-4v4H7v-4H3v-6h4z" />;
    case 'spark':
      return (
        <path
          {...common}
          d="m10 3 .9 4.1L14.5 9l-3.6 1.9L10 15l-.9-4.1L5.5 9l3.6-1.9zM15.5 13.5l.4 1.7 1.6.8-1.6.8-.4 1.7-.4-1.7-1.6-.8 1.6-.8z"
        />
      );
    case 'wallet':
      return (
        <path
          {...common}
          d="M4.5 5.5h10a1.5 1.5 0 0 1 1.5 1.5v8.5H5.5A1.5 1.5 0 0 1 4 14V6.5a1 1 0 0 1 1-1Zm0 0V4.5A1.5 1.5 0 0 1 6.5 3h7M12 10h4"
        />
      );
    case 'gift':
      return (
        <path
          {...common}
          d="M4 8h12v8.5H4zM3 5.5h14V8H3zM10 5.5V16.5M10 5.5H7.5a1.7 1.7 0 1 1 1.2-2.9C10 3.9 10 5.5 10 5.5Zm0 0h2.5a1.7 1.7 0 1 0-1.2-2.9C10 3.9 10 5.5 10 5.5Z"
        />
      );
    case 'box':
    default:
      return (
        <path
          {...common}
          d="m3.5 6.5 6.5-3 6.5 3v7L10 16.5l-6.5-3zM3.5 6.5 10 10l6.5-3.5M10 10v6.5"
        />
      );
  }
}

export function CategoryIcon({
  type,
  name,
  size = 'small',
}: {
  type: CategoryType;
  name: string;
  size?: 'small' | 'medium';
}) {
  const presentation = categoryPresentation(type, name);
  return (
    <span
      className={`category-icon category-icon-${size}`}
      style={
        {
          '--category-bg': presentation.background,
          '--category-ink': presentation.ink,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
        <IconPath icon={presentation.icon} />
      </svg>
    </span>
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
