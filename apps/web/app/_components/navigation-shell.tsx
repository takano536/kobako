'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useMemo, useState, useTransition, type ReactNode } from 'react';

import { pageSkeletonFor } from '../page-skeletons';
import {
  NavigationShellContext,
  useNavigationShell,
  type NavigationShellValue,
  type PendingNavigation,
} from './navigation-shell-context';
import styles from './navigation-shell.module.css';

/**
 * 画面遷移の間、遷移先の骨組みを本文の位置に表示します。遷移は `router.push` を
 * `useTransition` の中で呼び、Next.js の遷移が確定した commit で骨組みを外します。
 * 文書の読み込みはこれまでどおりサーバーで本文まで描画し、JavaScript が無くても読めます。
 */
export function NavigationShellProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [pending, setPending] = useState<PendingNavigation | null>(null);
  const navigate = useCallback(
    (href: string, { scroll }: { scroll: boolean }) => {
      const to = new URL(href, window.location.href).pathname;
      if (to === pathname || pageSkeletonFor(to) === null) return false;
      setPending({ from: pathname, to });
      if (scroll) window.scrollTo(0, 0);
      startTransition(() => router.push(href, { scroll }));
      return true;
    },
    [pathname, router],
  );
  const value = useMemo<NavigationShellValue>(
    () => ({
      // 別の遷移（戻る・進むなど）で URL が先に変わった場合も骨組みを残しません。
      pending: isPending && pending?.from === pathname ? pending : null,
      navigate,
    }),
    [isPending, navigate, pathname, pending],
  );
  return <NavigationShellContext value={value}>{children}</NavigationShellContext>;
}

/** 遷移中は現在の本文を隠し（state は保ったまま）、遷移先の骨組みを表示します。 */
export function NavigationShell({ children }: { children: ReactNode }) {
  const pending = useNavigationShell()?.pending ?? null;
  const skeleton = pending ? pageSkeletonFor(pending.to) : null;
  return (
    <>
      {skeleton}
      <div className={styles.content} hidden={skeleton !== null}>
        {children}
      </div>
    </>
  );
}
