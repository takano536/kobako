'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  type ComponentProps,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type TouchEvent,
} from 'react';

import { useNavigationShell } from './navigation-shell-context';

type PrefetchLinkProps = ComponentProps<typeof Link>;

/**
 * アプリ内の遷移リンクです。ホバー・キーボードのフォーカスの時点で遷移先を先読みし（カードなら
 * 枠と骨組み）、画面に入っただけのリンクや開いているページと同じ URL へのリンクは先読み
 * しません。別の画面へ移るクリックは `NavigationShellProvider` が引き受け、本文を保持したまま
 * タブで遷移先と読み込み状態を示します。
 *
 * `NavigationShellProvider` が引き受ける画面へは、タッチやクリックで押した時点（直後に遷移の取得が
 * 始まる時点）では先読みしません。動的な画面の先読みは遷移の取得に使われず、タップごとに
 * RSC リクエストが 2 件に増えるだけだったためです。カードなど `Link` に任せるリンクは、
 * 押した時点でも先読みします。
 */
export function PrefetchLink({
  href,
  scroll,
  replace,
  target,
  onClick,
  onPointerEnter,
  onPointerDown,
  onFocus,
  onTouchStart,
  ...props
}: PrefetchLinkProps) {
  const router = useRouter();
  const shell = useNavigationShell();
  const prefetch = useCallback(
    (pressed: boolean) => {
      if (typeof href !== 'string') return;
      const destination = new URL(href, window.location.href);
      if (
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search
      )
        return;
      if (pressed && shell?.handles(href)) return;
      router.prefetch(href);
    },
    [href, router, shell],
  );
  return (
    <Link
      {...props}
      href={href}
      scroll={scroll}
      replace={replace}
      target={target}
      prefetch={false}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        const plainClick =
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          (target === undefined || target === '_self');
        if (event.defaultPrevented || !plainClick) return;
        if (replace || typeof href !== 'string') {
          shell?.cancel();
          return;
        }
        if (shell?.navigate(href, { scroll: scroll !== false })) event.preventDefault();
      }}
      onPointerEnter={(event: PointerEvent<HTMLAnchorElement>) => {
        // タッチでは pointerenter が押した時点で届きます。
        prefetch(event.pointerType !== 'mouse');
        onPointerEnter?.(event);
      }}
      onPointerDown={(event: PointerEvent<HTMLAnchorElement>) => {
        prefetch(true);
        onPointerDown?.(event);
      }}
      onTouchStart={(event: TouchEvent<HTMLAnchorElement>) => {
        prefetch(true);
        onTouchStart?.(event);
      }}
      onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
        // タップやクリックで当たったフォーカスは押した時点として扱います。
        prefetch(!event.currentTarget.matches(':focus-visible'));
        onFocus?.(event);
      }}
    />
  );
}
