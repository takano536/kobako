'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useOptimistic,
  useTransition,
  type MouseEvent,
  type ReactNode,
} from 'react';

import type { TransactionListType } from '../../src/lib/transaction-query';
import buttonStyles from './button.module.css';
import { useNavigationShell } from './navigation-shell-context';

export interface FilterState {
  type?: TransactionListType;
  categoryId?: number;
  accountId?: number;
  origin?: 'api';
}

interface FilterTransitionValue {
  /** 表示する条件。反映を待つ間は選んだ値、終われば URL（サーバー）の値です。 */
  filters: FilterState;
  /** 反映を待っている間 `true`。 */
  pending: boolean;
  apply: (next: FilterState) => void;
}

const FilterTransitionContext = createContext<FilterTransitionValue | null>(null);

function listHref(pathname: string, month: string, state: FilterState): string {
  const params = new URLSearchParams({ month });
  if (state.type) params.set('type', state.type);
  if (state.categoryId !== undefined && state.type !== 'transfer') {
    params.set('category', String(state.categoryId));
  }
  if (state.accountId !== undefined) params.set('account', String(state.accountId));
  if (state.origin) params.set('origin', state.origin);
  return `${pathname}?${params.toString()}`;
}

/**
 * 絞り込みの変更を「静かな遷移」として扱う範囲。チップと一覧（{@link FilterResults}）が同じ遷移を
 * 共有します。条件を選んだ時点で表示を切り替え（`useOptimistic`）、URL は `router.replace` で
 * 置き換えます（履歴を増やさず、スクロールも保ちます）。ナビゲーションの外枠を通さないので骨組みは
 * 出さず、一覧は応答が届くまで直前の内容を残します。遷移が終わると表示はサーバーの値に戻るため、
 * 失敗しても URL と食い違ったままになりません。
 */
export function FilterTransition({
  month,
  currentMonth,
  type,
  categoryId,
  accountId,
  origin,
  children,
}: FilterState & {
  /** 表示中の期間（`YYYY-MM` または `all`）。 */
  month: string;
  /** 全期間の表示から資産の条件を外したときに戻る月（`YYYY-MM`）。 */
  currentMonth: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const shell = useNavigationShell();
  const [pending, startTransition] = useTransition();
  const [filters, setOptimisticFilters] = useOptimistic<FilterState>({
    type,
    categoryId,
    accountId,
    origin,
  });

  // 外枠を通らずに URL が変わるため、確定した URL を外枠に知らせます。
  const syncCommitted = shell?.syncCommitted;
  useEffect(() => {
    if (!pending) syncCommitted?.();
  }, [pending, syncCommitted]);

  // 選んだ直後と応答が届いた commit で、本文の View Transition（フェード）を走らせません。
  // 属性は apply で遷移より先に付け、遷移が終わった後の effect で外します（遷移の開始時に読まれます）。
  useEffect(() => {
    if (!pending) delete document.documentElement.dataset.filterTransition;
  }, [pending]);
  useEffect(
    () => () => {
      delete document.documentElement.dataset.filterTransition;
    },
    [],
  );

  function apply(next: FilterState): void {
    // 全期間は資産で絞り込んでいるときだけの表示です。資産を外したら月の表示に戻します。
    const nextMonth = month === 'all' && next.accountId === undefined ? currentMonth : month;
    const href = listHref(pathname, nextMonth, next);
    document.documentElement.dataset.filterTransition = '';
    startTransition(() => {
      setOptimisticFilters(next);
      router.replace(href, { scroll: false });
    });
  }

  return (
    <FilterTransitionContext value={{ filters, pending, apply }}>
      {children}
    </FilterTransitionContext>
  );
}

export function useFilterTransition(): FilterTransitionValue {
  const value = useContext(FilterTransitionContext);
  if (!value) throw new Error('useFilterTransition must be used inside <FilterTransition>');
  return value;
}

/**
 * 絞り込みの結果を描く範囲。反映を待つ間は `aria-busy` を付け、CSS で控えめに薄くします
 * （位置や高さは変えません）。
 */
export function FilterResults({
  className,
  label,
  children,
}: {
  className?: string;
  label: string;
  children: ReactNode;
}) {
  const { pending } = useFilterTransition();
  return (
    <section
      className={className}
      aria-label={label}
      aria-busy={pending || undefined}
      data-slot="filter-results"
    >
      {children}
    </section>
  );
}

/**
 * 空の一覧の「条件をクリア」。絞り込み行のボタンと同じく静かな遷移で4条件を外します。
 * JavaScript が動く前はふつうのリンクとして同じ URL を開きます。
 */
export function FilterClearLink({ href, children }: { href: string; children: ReactNode }) {
  const { apply } = useFilterTransition();
  return (
    <a
      href={href}
      data-slot="button-link"
      data-variant="quiet"
      className={`${buttonStyles.linkButton} ${buttonStyles.linkButtonQuiet}`}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        apply({});
      }}
    >
      <span>{children}</span>
    </a>
  );
}
