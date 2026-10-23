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
 * アプリ内の遷移リンクです。ホバー・フォーカス・タッチの時点で遷移先を先読みし（カードなら
 * 枠と骨組み）、画面に入っただけのリンクや開いているページと同じ URL へのリンクは先読み
 * しません。別の画面へ移るクリックは `NavigationShell` が引き受け、遷移先の骨組みを
 * すぐに表示します。
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
  const prefetch = useCallback(() => {
    if (typeof href !== 'string') return;
    const destination = new URL(href, window.location.href);
    if (
      destination.pathname === window.location.pathname &&
      destination.search === window.location.search
    )
      return;
    router.prefetch(href);
  }, [href, router]);
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
        if (event.defaultPrevented || !plainClick || replace || typeof href !== 'string') return;
        if (shell?.navigate(href, { scroll: scroll !== false })) event.preventDefault();
      }}
      onPointerEnter={(event: PointerEvent<HTMLAnchorElement>) => {
        prefetch();
        onPointerEnter?.(event);
      }}
      onPointerDown={(event: PointerEvent<HTMLAnchorElement>) => {
        prefetch();
        onPointerDown?.(event);
      }}
      onTouchStart={(event: TouchEvent<HTMLAnchorElement>) => {
        prefetch();
        onTouchStart?.(event);
      }}
      onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
        prefetch();
        onFocus?.(event);
      }}
    />
  );
}
