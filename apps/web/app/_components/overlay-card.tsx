'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { useBackgroundScrollLock } from './use-background-scroll-lock';
import styles from './overlay-card.module.css';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function OverlayCard({
  title,
  kind,
  children,
  autoFocusSelector,
}: {
  title: string;
  kind: 'transaction' | 'asset' | 'import';
  children: React.ReactNode;
  autoFocusSelector?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const cardRef = useRef<HTMLDivElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const closingRef = useRef(false);
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
    const targetSelector = autoFocusSelector ? autoFocusSelector : FOCUSABLE_SELECTOR;
    const focusTarget = card.querySelector<HTMLElement>(targetSelector);
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
      if (event.shiftKey && document.activeElement === first) {
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
  // 入力欄が現れた時点でフォーカスし、利用者が既に別の要素へ移している場合は奪いません。
  useEffect(() => {
    const card = cardRef.current;
    if (!card || !autoFocusSelector) return;
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
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        id="entry-dialog"
        ref={cardRef}
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="entry-dialog-title"
        data-card-pattern="overlay-card"
        data-card-kind={kind}
      >
        <header className={styles.header}>
          <button
            className={styles.back}
            ref={backButtonRef}
            type="button"
            aria-label="戻る"
            onClick={close}
          >
            <svg className={styles.backChevron} viewBox="0 0 12 12" aria-hidden="true">
              <path d="m7.5 2.25-3.25 3.75L7.5 9.75" />
            </svg>
          </button>
          <h1 className={styles.title} id="entry-dialog-title">
            {title}
          </h1>
          <span aria-hidden="true" />
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
