'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  type ComponentProps,
  type FocusEvent,
  type PointerEvent,
  type TouchEvent,
} from 'react';

type PrefetchLinkProps = ComponentProps<typeof Link>;

/**
 * カードを開くリンクです。ホバー・フォーカス・タッチの時点で遷移先の shell を取りに行き、
 * クリックやタップの時点でカードの枠を待たずに表示できるようにします。
 * 画面内の全行を先読みしないよう、`Link` の viewport 先読みは無効のまま意図だけを拾います。
 */
export function PrefetchLink({
  href,
  onPointerEnter,
  onPointerDown,
  onFocus,
  onTouchStart,
  ...props
}: PrefetchLinkProps) {
  const router = useRouter();
  const prefetch = useCallback(() => {
    if (typeof href === 'string') router.prefetch(href);
  }, [href, router]);
  return (
    <Link
      {...props}
      href={href}
      prefetch={false}
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
