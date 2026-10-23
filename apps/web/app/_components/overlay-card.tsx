'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { useBackgroundScrollLock } from './use-background-scroll-lock';
import styles from './overlay-card.module.css';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 主たる入力手段がタッチ（`pointer: coarse`）かどうか。タッチ端末でテキスト入力へ
 * フォーカスするとソフトキーボードが開くため、カード表示時の自動フォーカスはこの判定で止めます。
 * クライアントでのみ呼び出します。
 */
export function prefersTouchInput(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

export function OverlayCard({
  title,
  kind,
  children,
  autoFocusSelector,
}: {
  title: string;
  kind: 'transaction' | 'asset' | 'import';
  children: React.ReactNode;
  /**
   * デスクトップ（タッチ以外）でカード表示時にフォーカスする要素。
   * タッチ端末ではキーボードを開かないよう、これを使わずカード自体にフォーカスします。
   */
  autoFocusSelector?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const cardRef = useRef<HTMLDivElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const closingRef = useRef(false);
  // 初回マウント時に一度だけ判定し、以降の再実行でも同じ初期フォーカス方針を使います。
  const touchInputRef = useRef<boolean | null>(null);
  useBackgroundScrollLock();
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    router.back();
  }, [router]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    document.documentElement.dataset.overlayOpen = 'true';
    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    originRef.current =
      activeElement && !card.contains(activeElement)
        ? activeElement
        : document.querySelector<HTMLElement>(`main a[href^="${pathname}"]`);
    touchInputRef.current ??= prefersTouchInput();
    // タッチ端末: 入力欄ではなくダイアログ自体へフォーカスし、キーボードを開きません。
    // デスクトップ: 指定の入力欄（無ければ先頭の操作要素）へフォーカスします。
    const focusTarget = touchInputRef.current
      ? card
      : card.querySelector<HTMLElement>(autoFocusSelector || FOCUSABLE_SELECTOR);
    const frame = window.requestAnimationFrame(() => focusTarget?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        card.querySelector('details[open]') ||
        document.querySelector('[data-slot="delete-confirm"][open]')
      ) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.getClientRects().length > 0,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === card)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!card.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    const handlePopState = () => {
      closingRef.current = true;
    };
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('popstate', handlePopState, true);
    return () => {
      delete document.documentElement.dataset.overlayOpen;
      document.removeEventListener('keydown', handleKeyDown);
      window.cancelAnimationFrame(frame);
      window.removeEventListener('popstate', handlePopState, true);
      window.requestAnimationFrame(() => {
        if (cardRef.current?.isConnected || !originRef.current?.isConnected) return;
        const activeElement = document.activeElement;
        const focusAlreadyMoved =
          activeElement &&
          activeElement !== document.body &&
          activeElement !== document.documentElement;
        if (!closingRef.current && focusAlreadyMoved) return;
        originRef.current.focus();
      });
    };
  }, [autoFocusSelector, close, pathname]);

  // 中身をストリーミングで受け取る場合、入力欄はカードの枠より後に現れます。
  // デスクトップでは入力欄が現れた時点でフォーカスし、利用者が既に別の要素へ移している場合は奪いません。
  // タッチ端末では遅れてキーボードが開かないよう、入力欄の出現を待ちません。
  useEffect(() => {
    const card = cardRef.current;
    if (!card || !autoFocusSelector) return;
    if (touchInputRef.current) return;
    if (card.querySelector(autoFocusSelector)) return;
    const observer = new MutationObserver(() => {
      const field = card.querySelector<HTMLElement>(autoFocusSelector);
      if (!field) return;
      observer.disconnect();
      const active = document.activeElement;
      const userMovedFocus =
        active instanceof HTMLElement &&
        active !== backButtonRef.current &&
        card.contains(active) &&
        active.matches(FOCUSABLE_SELECTOR);
      if (userMovedFocus) return;
      field.focus();
    });
    observer.observe(card, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [autoFocusSelector]);

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onPointerDown={(event) => {
        // 背景のタップではカードを閉じません（閉じるのは戻る・Escape・履歴の戻る・保存後の遷移）。
        // カード内で押し始めたドラッグや選択は target が背景にならないため、ここでは扱いません。
        if (event.target !== event.currentTarget) return;
        // 既定の動作（フォーカスを body へ移す・テキスト選択）を止め、フォーカスは動かしません。
        event.preventDefault();
        const card = cardRef.current;
        const active = document.activeElement;
        const ownsKeyboard =
          active instanceof HTMLElement &&
          (active.matches('input, textarea, select') || active.isContentEditable);
        // 入力中ならフォーカスをカード本体へ移し、ソフトキーボードを閉じます。
        if (card && ownsKeyboard && card.contains(active)) card.focus({ preventScroll: true });
      }}
    >
      <div
        id="entry-dialog"
        ref={cardRef}
        className={styles.card}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="entry-dialog-title"
        data-card-pattern="overlay-card"
        data-card-kind={kind}
      >
        <header className={styles.header}>
          {/* 戻るボタンの当たり判定を見出し文字まで広げます（::after が backTarget 全体を覆います）。
              見出しはボタンの外に置き、ダイアログ名は素の見出しテキストのまま保ちます。 */}
          <div className={styles.backTarget}>
            <button
              className={styles.back}
              ref={backButtonRef}
              type="button"
              aria-label={`${title} — 戻る`}
              onClick={close}
            >
              <svg className={styles.backChevron} viewBox="0 0 12 12" aria-hidden="true">
                <path d="m7.5 2.25-3.25 3.75L7.5 9.75" />
              </svg>
            </button>
            <h1 className={styles.title} id="entry-dialog-title">
              {title}
            </h1>
          </div>
          <span aria-hidden="true" />
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
