'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';

import { pageSkeletonFor } from '../page-skeletons';
import {
  useNavigationShell,
  NavigationShellContext,
  type NavigationShellValue,
} from './navigation-shell-context';
import shellStyles from './navigation-shell.module.css';
import { installRscNavigationRetry } from './rsc-navigation-retry';

installRscNavigationRetry();

// Full-page destinations only. Search-only updates and intercepted cards stay with Link.
const PAGE_PATHS: Record<string, true | undefined> = {
  '/': true,
  '/transactions': true,
  '/balances': true,
  '/settings': true,
  '/settings/categories/asset': true,
  '/settings/categories/expense': true,
  '/settings/categories/income': true,
  '/settings/delete': true,
  '/settings/import': true,
};

interface NavigationRequest {
  href: string;
  pathname: string;
  scroll: boolean;
}

/**
 * Tab feedback is immediate and the destination frame replaces the body until the next page
 * commits. Router pushes are single-flight with one replaceable destination, which avoids the
 * overlapping router actions that turned taps into full document navigations.
 */
export function NavigationShellProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);
  const active = useRef<{ from: string; href: string } | null>(null);
  const latest = useRef<NavigationRequest | null>(null);

  const cancel = useCallback(() => {
    latest.current = null;
    active.current = null;
    setNavigatingTo(null);
  }, []);

  useEffect(() => {
    window.addEventListener('popstate', cancel);
    return () => window.removeEventListener('popstate', cancel);
  }, [cancel]);

  const begin = useCallback(
    (request: NavigationRequest) => {
      active.current = { from: pathname, href: request.href };
      startTransition(() => router.push(request.href, { scroll: request.scroll }));
    },
    [pathname, router],
  );

  useEffect(() => {
    const running = active.current;
    if (running === null || (isPending && pathname === running.from)) return;
    active.current = null;
    const request = latest.current;
    const currentHref = window.location.pathname + window.location.search + window.location.hash;
    // If the router settled without changing the URL, don't re-dispatch that same request forever.
    if (request !== null && request.href !== running.href && request.href !== currentHref) {
      begin(request);
    } else {
      latest.current = null;
      setNavigatingTo(null);
    }
  }, [begin, isPending, pathname]);

  const handles = useCallback(
    (href: string) => {
      const url = new URL(href, window.location.href);
      return (
        url.origin === window.location.origin &&
        url.pathname !== pathname &&
        PAGE_PATHS[url.pathname] === true
      );
    },
    [pathname],
  );
  const navigate = useCallback(
    (href: string, { scroll }: { scroll: boolean }) => {
      const url = new URL(href, window.location.href);
      // Same-URL taps refresh through the same queue too. Delegating them to Link would start an
      // untracked router action that the next tab tap could overtake.
      const currentPage = url.href === window.location.href && PAGE_PATHS[url.pathname] === true;
      if (!handles(href) && !currentPage) {
        cancel();
        return false;
      }
      const request = {
        href: url.pathname + url.search + url.hash,
        pathname: url.pathname,
        scroll,
      };
      latest.current = request;
      setNavigatingTo(request.pathname);
      if (scroll) window.scrollTo(0, 0);
      if (active.current === null) begin(request);
      return true;
    },
    [begin, cancel, handles],
  );
  const value = useMemo<NavigationShellValue>(
    () => ({ navigatingTo, navigate, handles, cancel }),
    [cancel, handles, navigate, navigatingTo],
  );
  return <NavigationShellContext value={value}>{children}</NavigationShellContext>;
}

/**
 * 引き受けた遷移の間、遷移先の外枠（骨組み）を本文の位置に表示します。現在の本文は state を
 * 保ったまま `hidden` で隠し、遷移が確定した commit で骨組みを外します。同じ画面への再タップは
 * 骨組みを出しません（表示中の画面を一瞬消すだけになるため）。
 */
export function NavigationShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const navigatingTo = useNavigationShell()?.navigatingTo ?? null;
  const skeleton =
    navigatingTo !== null && navigatingTo !== pathname ? pageSkeletonFor(navigatingTo) : null;
  // The body was already replaced by the frame, so fading the committed page in would blank the
  // screen for the length of the transition. The attribute is read when the transition starts,
  // which happens before this effect removes it.
  useEffect(() => {
    const root = document.documentElement;
    if (skeleton === null) delete root.dataset.navFrame;
    else root.dataset.navFrame = '';
  }, [skeleton]);
  return (
    <>
      {skeleton}
      <div className={shellStyles.content} hidden={skeleton !== null}>
        {children}
      </div>
    </>
  );
}
