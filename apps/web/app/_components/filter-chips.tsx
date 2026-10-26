'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import type { FilterCategory, TransactionListType } from '../../src/lib/transaction-query';
import styles from './filter-chips.module.css';
import { useNavigationShell } from './navigation-shell-context';

export interface FilterChipAccount {
  id: number;
  name: string;
  /** 資産カテゴリ名（銀行・クレジットカードなど）。メニューの右端に小さく出します。 */
  categoryName: string;
}

interface FilterState {
  type?: TransactionListType;
  categoryId?: number;
  accountId?: number;
  origin?: 'api';
}

type MenuName = 'type' | 'category' | 'account';

interface MenuItem {
  value: string;
  label: string;
  meta?: string;
}

interface MenuGroup {
  label?: string;
  items: MenuItem[];
}

const TYPE_LABELS: Record<TransactionListType, string> = {
  expense: '支出',
  income: '収入',
  transfer: '振替',
};

const CHIP_LABELS: Record<MenuName, string> = {
  type: '種別',
  category: 'カテゴリ',
  account: '資産',
};

/** チップとメニューの間、および画面端との余白（px）。 */
const MENU_GAP = 6;
const VIEWPORT_MARGIN = 8;
/** 画面がどれだけ狭くても、メニューに確保する高さ（px）。 */
const MIN_MENU_HEIGHT = 120;

/**
 * 絞り込みを反映した後にフォーカスを戻すチップ（`data-filter` の値）。遷移でコンポーネントが
 * 作り直されても引き継げるよう、モジュールに置きます。
 */
let pendingFocusFilter: string | null = null;

function Chevron() {
  return (
    <svg className={styles.chevron} viewBox="0 0 12 12" focusable="false" aria-hidden="true">
      <path d="m2 4.5 4 4 4-4" />
    </svg>
  );
}

function Check() {
  return (
    <svg className={styles.check} viewBox="0 0 12 12" focusable="false" aria-hidden="true">
      <path d="m2 6.5 2.5 2.5L10 3.5" />
    </svg>
  );
}

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
 * 取引一覧の絞り込み。種別・カテゴリ・資産・APIのみを常時表示のチップ1行に並べ、値はチップ直下の
 * メニューで選びます。選んだ時点で URL を置き換え（履歴は増やさず、スクロールも保ちます）、
 * 一覧はサーバーで描き直します。チップの表示は URL の反映を待たずに先に切り替えます。
 */
export function FilterChips({
  month,
  currentMonth,
  type,
  categoryId,
  accountId,
  origin,
  categories,
  accounts,
}: {
  /** 表示中の期間（`YYYY-MM` または `all`）。 */
  month: string;
  /** 全期間の表示から資産の条件を外したときに戻る月（`YYYY-MM`）。 */
  currentMonth: string;
  categories: readonly FilterCategory[];
  accounts: readonly FilterChipAccount[];
} & FilterState) {
  const router = useRouter();
  const pathname = usePathname();
  const shell = useNavigationShell();
  const [state, setState] = useState<FilterState>({ type, categoryId, accountId, origin });
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);
  const rowRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Partial<Record<MenuName, HTMLButtonElement | null>>>({});
  const id = useId();
  const transferNoteId = `${id}-transfer-note`;

  // 戻る・進むやリンクで URL が変わったら、サーバーから届いた条件に合わせます。
  useEffect(() => {
    setState({ type, categoryId, accountId, origin });
    // 遷移の間は本文が骨組みに置き換わり（`hidden`）、フォーカスが外れます。本文が戻ったら、
    // 操作したチップへフォーカスを戻します。本文を戻すのはこの後の commit なので、数フレーム待ちます。
    const key = pendingFocusFilter;
    pendingFocusFilter = null;
    if (!key) return;
    let frame = 0;
    let attempts = 0;
    const restore = () => {
      const target = rowRef.current?.querySelector<HTMLElement>(
        key === 'origin'
          ? '[data-filter="origin"]'
          : `[data-filter="${key}"] [data-slot="filter-chip-trigger"]`,
      );
      const active = document.activeElement;
      if (!target || (active !== null && active !== document.body)) return;
      target.focus({ preventScroll: true });
      attempts += 1;
      if (document.activeElement !== target && attempts < 60) {
        frame = requestAnimationFrame(restore);
      }
    };
    restore();
    return () => cancelAnimationFrame(frame);
  }, [type, categoryId, accountId, origin]);

  function apply(next: FilterState, focusFilter?: string): void {
    setState(next);
    const active = document.activeElement;
    pendingFocusFilter =
      focusFilter ??
      (active instanceof HTMLElement && rowRef.current?.contains(active)
        ? (active.closest('[data-filter]')?.getAttribute('data-filter') ?? null)
        : null);
    // 全期間は資産で絞り込んでいるときだけの表示です。資産を外したら月の表示に戻します。
    const nextMonth = month === 'all' && next.accountId === undefined ? currentMonth : month;
    const href = listHref(pathname, nextMonth, next);
    // 絞り込みは置き換えます。検索ごとに履歴を1件ずつ増やしません。
    if (shell?.navigate(href, { scroll: false, replace: true }) === true) return;
    router.replace(href, { scroll: false });
  }

  function select(name: MenuName, value: string): void {
    if (name === 'type') {
      const nextType = value ? (value as TransactionListType) : undefined;
      const category = categories.find((entry) => entry.id === state.categoryId);
      // 種別と合わないカテゴリは外します。振替にはカテゴリがありません。
      const keepCategory = category && (!nextType || nextType === category.type);
      apply({ ...state, type: nextType, categoryId: keepCategory ? state.categoryId : undefined });
    } else if (name === 'category') {
      apply({ ...state, categoryId: value ? Number(value) : undefined });
    } else {
      apply({ ...state, accountId: value ? Number(value) : undefined });
    }
  }

  function closeMenu(returnFocus: boolean): void {
    const name = openMenu;
    setOpenMenu(null);
    if (returnFocus && name) triggerRefs.current[name]?.focus();
  }

  const categoryDisabled = state.type === 'transfer';
  const selectedCategory = categories.find((entry) => entry.id === state.categoryId);
  const selectedAccount = accounts.find((entry) => entry.id === state.accountId);
  const values: Record<MenuName, string | undefined> = {
    type: state.type ? TYPE_LABELS[state.type] : undefined,
    category: categoryDisabled ? undefined : selectedCategory?.name,
    account: selectedAccount?.name,
  };
  const selectedValues: Record<MenuName, string> = {
    type: state.type ?? '',
    category: state.categoryId !== undefined ? String(state.categoryId) : '',
    account: state.accountId !== undefined ? String(state.accountId) : '',
  };
  const hasFilter = Boolean(
    state.type || state.categoryId !== undefined || state.accountId !== undefined || state.origin,
  );

  function menuGroups(name: MenuName): MenuGroup[] {
    const all: MenuGroup = { items: [{ value: '', label: 'すべて' }] };
    if (name === 'type') {
      return [
        {
          items: [
            ...all.items,
            ...(['expense', 'income', 'transfer'] as const).map((value) => ({
              value,
              label: TYPE_LABELS[value],
            })),
          ],
        },
      ];
    }
    if (name === 'category') {
      const types =
        state.type === 'expense' || state.type === 'income'
          ? [state.type]
          : (['expense', 'income'] as const);
      return [
        all,
        ...types.map((groupType) => ({
          label: TYPE_LABELS[groupType],
          items: categories
            .filter((entry) => entry.type === groupType)
            .map((entry) => ({ value: String(entry.id), label: entry.name })),
        })),
      ].filter((group) => group.items.length > 0);
    }
    return [
      all,
      {
        label: '資産',
        items: accounts.map((entry) => ({
          value: String(entry.id),
          label: entry.name,
          // 「現金（現金）」のように名前と同じ分類名は繰り返しません。
          meta: entry.categoryName !== entry.name ? entry.categoryName : undefined,
        })),
      },
    ].filter((group) => group.items.length > 0);
  }

  // メニューは開いたチップの左端に揃え、絞り込み行の右端からはみ出す分だけ左へ寄せます。
  // 縦は直下に開き、下に入りきらず上の方が広ければ直上に開きます。高さは入る分までに抑え、
  // 中でスクロールします（`month-picker.tsx` と同じ考え方です）。
  useLayoutEffect(() => {
    if (!openMenu) return;
    const place = (event?: Event) => {
      const menu = menuRef.current;
      const row = rowRef.current;
      const chip = menu?.parentElement;
      if (!menu || !row || !chip) return;
      // メニューの中のスクロールでは置き直しません。
      if (event?.target instanceof Node && menu.contains(event.target)) return;
      menu.style.transform = '';
      menu.style.maxHeight = '';
      const overflow = menu.getBoundingClientRect().right - row.getBoundingClientRect().right;
      if (overflow > 0) menu.style.transform = `translateX(${-overflow}px)`;

      const rect = chip.getBoundingClientRect();
      // 狭い画面では下部ナビゲーションが画面下端に固定されるため、その上端までを使えます。
      const bottomNav = Array.from(
        document.querySelectorAll<HTMLElement>('[data-slot="site-nav"]'),
      ).find((element) => getComputedStyle(element).position === 'fixed');
      const bottomLimit = Math.min(
        bottomNav?.getBoundingClientRect().top ?? window.innerHeight,
        window.innerHeight,
      );
      const below = bottomLimit - rect.bottom - MENU_GAP - VIEWPORT_MARGIN;
      const above = rect.top - MENU_GAP - VIEWPORT_MARGIN;
      // CSS の max-height（上限）を超えない自然な高さ。
      const natural = Math.min(menu.scrollHeight, menu.getBoundingClientRect().height);
      const up = natural > below && above > below;
      menu.dataset.placement = up ? 'top' : 'bottom';
      const space = Math.max(up ? above : below, MIN_MENU_HEIGHT);
      if (natural > space) menu.style.maxHeight = `${space}px`;
    };
    place();
    window.addEventListener('scroll', place, { capture: true, passive: true });
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, { capture: true });
      window.removeEventListener('resize', place);
    };
  }, [openMenu]);

  // 開いたら選択中の項目（無ければ先頭）へフォーカスします。
  useEffect(() => {
    if (!openMenu) return;
    const menu = menuRef.current;
    const target =
      menu?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      menu?.querySelector<HTMLElement>('[role="menuitemradio"]');
    target?.focus({ preventScroll: true });
    // メニューの中だけをスクロールして、選択中の項目を見せます。
    if (target && menu) {
      const top = target.offsetTop - menu.clientHeight / 2 + target.offsetHeight / 2;
      menu.scrollTop = Math.max(0, top);
    }
  }, [openMenu]);

  // 外側の押下と Escape で閉じます。
  useEffect(() => {
    if (!openMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const chip = triggerRefs.current[openMenu]?.parentElement;
      if (chip?.contains(target)) return;
      setOpenMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpenMenu(null);
      triggerRefs.current[openMenu]?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [openMenu]);

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = index <= 0 ? items.length - 1 : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Tab') {
      // Tab はメニューを閉じ、チップの並びに沿って次（Shift なら前）へ進みます。
      closeMenu(true);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  }

  function renderMenu(name: MenuName) {
    const groups = menuGroups(name);
    return (
      <div
        ref={menuRef}
        id={`${id}-${name}-menu`}
        role="menu"
        aria-label={CHIP_LABELS[name]}
        data-slot="filter-menu"
        className={styles.menu}
        onKeyDown={handleMenuKeyDown}
        onBlur={(event) => {
          // フォーカスがチップとメニューの外へ出たら閉じます。
          const next = event.relatedTarget;
          if (!(next instanceof Node)) return;
          if (triggerRefs.current[name]?.parentElement?.contains(next)) return;
          setOpenMenu(null);
        }}
      >
        {groups.map((group, groupIndex) => {
          const items = group.items.map((item) => {
            const checked = selectedValues[name] === item.value;
            return (
              <button
                key={item.value}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={-1}
                className={styles['menu-item']}
                onClick={() => {
                  closeMenu(true);
                  if (!checked) select(name, item.value);
                }}
              >
                <span className={styles['menu-label']}>{item.label}</span>
                {item.meta ? <span className={styles['menu-meta']}>{item.meta}</span> : null}
              </button>
            );
          });
          return (
            <div key={group.label ?? `group-${groupIndex}`} className={styles['menu-section']}>
              {group.label ? (
                <div role="group" aria-labelledby={`${id}-${name}-group-${groupIndex}`}>
                  <div
                    id={`${id}-${name}-group-${groupIndex}`}
                    className={styles['menu-group']}
                    data-slot="filter-menu-group"
                  >
                    {group.label}
                  </div>
                  {items}
                </div>
              ) : (
                items
              )}
            </div>
          );
        })}
      </div>
    );
  }

  function renderChip(name: MenuName) {
    const value = values[name];
    const open = openMenu === name;
    const disabled = name === 'category' && categoryDisabled;
    return (
      <div
        key={name}
        data-slot="filter-chip"
        data-filter={name}
        data-active={value ? 'true' : 'false'}
        data-open={open ? 'true' : undefined}
        data-disabled={disabled ? 'true' : undefined}
        className={styles.chip}
      >
        <button
          ref={(element) => {
            triggerRefs.current[name] = element;
          }}
          type="button"
          data-slot="filter-chip-trigger"
          className={styles.trigger}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? `${id}-${name}-menu` : undefined}
          aria-describedby={disabled ? transferNoteId : undefined}
          disabled={disabled}
          onClick={() => setOpenMenu(open ? null : name)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' || open) return;
            event.preventDefault();
            setOpenMenu(name);
          }}
        >
          <span className={styles.label}>{CHIP_LABELS[name]}</span>
          {value ? (
            <>
              {' '}
              <span className={styles.value}>{value}</span>
            </>
          ) : null}
        </button>
        {value ? (
          <button
            type="button"
            data-slot="filter-chip-clear"
            className={styles.remove}
            aria-label={`${CHIP_LABELS[name]}の条件を外す`}
            onClick={() => {
              setOpenMenu(null);
              triggerRefs.current[name]?.focus();
              select(name, '');
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
        <Chevron />
        {open ? renderMenu(name) : null}
      </div>
    );
  }

  return (
    <section
      ref={rowRef}
      data-slot="filter-chips"
      className={styles.row}
      aria-label="取引の絞り込み"
    >
      {renderChip('type')}
      {renderChip('category')}
      {renderChip('account')}
      <button
        type="button"
        data-slot="filter-chip"
        data-filter="origin"
        data-active={state.origin ? 'true' : 'false'}
        className={`${styles.chip} ${styles.toggle}`}
        aria-pressed={state.origin === 'api'}
        onClick={() => apply({ ...state, origin: state.origin ? undefined : 'api' })}
      >
        <Check />
        <span className={styles.label}>APIのみ</span>
      </button>
      {hasFilter ? (
        <button
          type="button"
          data-slot="filter-clear"
          className={styles.clear}
          onClick={() => {
            setOpenMenu(null);
            // ボタンは条件が無くなると消えるため、先頭のチップへ戻します。
            apply({}, 'type');
          }}
        >
          条件をクリア
        </button>
      ) : null}
      {categoryDisabled ? (
        <span id={transferNoteId} className="sr-only">
          振替にはカテゴリがありません
        </span>
      ) : null}
    </section>
  );
}
