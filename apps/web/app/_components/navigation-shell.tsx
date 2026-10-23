'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
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

// Full-page destinations only. Other search-only updates and intercepted cards stay with Link.
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

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthOf(url: URL): string | null {
  const value = url.searchParams.get('month');
  return value !== null && MONTH.test(value) ? value : null;
}

function monthOfLocation(): string | null {
  return monthOf(new URL(window.location.href));
}

interface NavigationRequest {
  href: string;
  pathname: string;
  month: string | null;
  scroll: boolean;
}

/**
 * Tab and month feedback is immediate and the destination frame replaces the body until the page
 * commits. Router pushes are single-flight with one replaceable destination, so a burst of taps
 * fetches the last destination once and the frame stays up until it arrives.
 */
export function NavigationShellProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [pending, setPending] = useState<{ pathname: string; month: string | null } | null>(null);
  // The month of the body that is on screen now. It only moves when a navigation commits.
  const [committedMonth, setCommittedMonth] = useState<string | null>(null);
  const active = useRef<{ from: string; href: string } | null>(null);
  const latest = useRef<NavigationRequest | null>(null);

  const cancel = useCallback(() => {
    latest.current = null;
    active.current = null;
    setPending(null);
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
    // If the router settled without reaching the destination, don't re-dispatch that same request.
    if (request !== null && request.href !== running.href && request.href !== currentHref) {
      begin(request);
    } else {
      latest.current = null;
      setPending(null);
    }
  }, [begin, isPending, pathname]);

  // Read the month off the URL after every commit instead of `useSearchParams`, which would need a
  // suspense boundary around the whole shell.
  useEffect(() => {
    setCommittedMonth(isPending ? null : monthOfLocation());
  }, [isPending, pathname]);

  const handles = useCallback(
    (href: string) => {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin || PAGE_PATHS[url.pathname] !== true) return false;
      if (url.pathname !== pathname) return true;
      // The same page on another month is a real navigation too; keep other search-only changes on
      // Link so filters and cards stay out of the queue.
      const month = monthOf(url);
      return month !== null && month !== monthOfLocation();
    },
    [pathname],
  );
  const navigate = useCallback(
    (href: string, { scroll }: { scroll: boolean }) => {
      const url = new URL(href, window.location.href);
      // Same-URL taps refresh through the same queue too. Delegating them to Link would start an
      // untracked router action that the next tap could overtake.
      const currentPage = url.href === window.location.href && PAGE_PATHS[url.pathname] === true;
      if (!handles(href) && !currentPage) {
        cancel();
        return false;
      }
      const request = {
        href: url.pathname + url.search + url.hash,
        pathname: url.pathname,
        month: monthOf(url),
        scroll,
      };
      latest.current = request;
      setPending({ pathname: request.pathname, month: request.month });
      if (scroll) window.scrollTo(0, 0);
      if (active.current === null) begin(request);
      return true;
    },
    [begin, cancel, handles],
  );
  const pendingMonth = pending?.month ?? null;
  const value = useMemo<NavigationShellValue>(
    () => ({ pending, pendingMonth, committedMonth, navigate, handles, cancel }),
    [cancel, committedMonth, handles, navigate, pending, pendingMonth],
  );
  return <NavigationShellContext value={value}>{children}</NavigationShellContext>;
}

/**
 * 引き受けた遷移の間、遷移先の外枠（骨組み）を本文の位置に表示します。現在の本文は state を
 * 保ったまま `hidden` で隠し、遷移が確定した commit で骨組みを外します。月の切り替えでは
 * 骨組みの月を切り替え先の月にします。同じ画面を同じ月で開き直すときは骨組みを出しません
 * （表示中の画面を一瞬消すだけになるため）。
 */
export function NavigationShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const shell = useNavigationShell();
  const pending = shell?.pending ?? null;
  const committedMonth = shell?.committedMonth ?? null;
  const replaced =
    pending !== null &&
    (pending.pathname !== pathname || (pending.month !== null && pending.month !== committedMonth));
  const skeleton =
    replaced && pending !== null ? pageSkeletonFor(pending.pathname, pending.month) : null;
  // A month switch keeps the scroll position, so the frame holds the height of the body it replaced
  // and the page does not jump up while the frame is up. Tab switches scroll to the top anyway.
  const keepsScroll = pending !== null && pending.pathname === pathname;
  // The body was already replaced by the frame, so fading the committed page in would blank the
  // screen for the length of the transition. The attribute is read when the transition starts,
  // which happens before this effect removes it.
  useEffect(() => {
    const root = document.documentElement;
    if (skeleton === null) delete root.dataset.navFrame;
    else root.dataset.navFrame = '';
  }, [skeleton]);
  // Month switches keep the scroll position, so the frame keeps the height of the body it replaced
  // and the list below does not jump up while the frame is up.
  const content = useRef<HTMLDivElement>(null);
  const contentHeight = useRef(0);
  useLayoutEffect(() => {
    if (content.current !== null && !content.current.hidden) {
      contentHeight.current = content.current.offsetHeight;
    }
  });
  return (
    <>
      <div
        style={skeleton === null || !keepsScroll ? undefined : { minHeight: contentHeight.current }}
      >
        {skeleton}
      </div>
      <div ref={content} className={shellStyles.content} hidden={skeleton !== null}>
        {children}
      </div>
    </>
  );
}
