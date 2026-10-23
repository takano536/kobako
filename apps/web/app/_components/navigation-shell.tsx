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

import { NavigationShellContext, type NavigationShellValue } from './navigation-shell-context';
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
 * Keep content painted until the next page commits. Tab feedback is immediate; router pushes are
 * single-flight with one replaceable destination. This avoids overlapping router actions (including
 * the races between brand/settings links and tabs), without a skeleton swap or a reveal timer.
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
