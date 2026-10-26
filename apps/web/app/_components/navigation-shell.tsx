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
  search: string;
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
  const [pending, setPending] = useState<{
    pathname: string;
    month: string | null;
    search: string;
  } | null>(null);
  // The month of the body that is on screen now. It only moves when a navigation commits.
  const [committedMonth, setCommittedMonth] = useState<string | null>(null);
  const [committedSearch, setCommittedSearch] = useState('');
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
      startTransition(() => {
        router.push(request.href, { scroll: request.scroll });
      });
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
  // suspense boundary around the whole shell. The mount pass runs even inside a transition, so a tap
  // on the page that is already open is never mistaken for a month switch.
  const syncCommitted = useCallback(() => {
    setCommittedMonth(monthOfLocation());
    setCommittedSearch(window.location.search);
  }, []);
  useEffect(syncCommitted, [syncCommitted]);
  useEffect(() => {
    if (isPending) return;
    syncCommitted();
  }, [isPending, pathname, syncCommitted]);

  const handles = useCallback(
    (href: string) => {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin || PAGE_PATHS[url.pathname] !== true) return false;
      if (url.pathname !== pathname) return true;
      // The same page on another month or with another filter is a real navigation too: the page
      // renders on the server, so it gets the destination frame like a month switch.
      const month = monthOf(url);
      if (month !== null && month !== monthOfLocation()) return true;
      return url.search !== window.location.search;
    },
    [pathname],
  );
  const navigate = useCallback(
    (href: string, { scroll }: { scroll: boolean }) => {
      const url = new URL(href, window.location.href);
      const pagePath = PAGE_PATHS[url.pathname] === true;
      const sameTarget = pagePath && url.href === window.location.href;
      if (!handles(href) && !sameTarget) {
        cancel();
        return false;
      }
      // Tapping the tab of the page that is already on screen asks for nothing: no fetch, no frame,
      // no busy state. Only scroll back to the top, which is what the tap can still mean.
      if (sameTarget && active.current === null) {
        if (scroll) window.scrollTo(0, 0);
        return true;
      }
      const request = {
        href: url.pathname + url.search + url.hash,
        pathname: url.pathname,
        month: monthOf(url),
        search: url.search,
        scroll,
      };
      latest.current = request;
      setPending({ pathname: request.pathname, month: request.month, search: url.search });
      if (scroll) window.scrollTo(0, 0);
      if (active.current === null) begin(request);
      return true;
    },
    [begin, cancel, handles],
  );
  const pendingMonth = pending?.month ?? null;
  const value = useMemo<NavigationShellValue>(
    () => ({
      pending,
      pendingMonth,
      committedMonth,
      committedSearch,
      navigate,
      handles,
      cancel,
      syncCommitted,
    }),
    [
      cancel,
      committedMonth,
      committedSearch,
      handles,
      navigate,
      pending,
      pendingMonth,
      syncCommitted,
    ],
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
  const committedSearch = shell?.committedSearch ?? '';
  // 別の画面・別の月・別の絞り込みは、どれもサーバー描画をやり直す本当の遷移です。
  const replaced =
    pending !== null &&
    (pending.pathname !== pathname ||
      (pending.month !== null && pending.month !== committedMonth) ||
      pending.search !== committedSearch);
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
  useEffect(() => {
    const element = content.current;
    if (element === null) return;
    // `.content` is `display: contents`, so measure the page shell inside it.
    const measure = (): void => {
      if (element.hidden) return;
      const shell = element.firstElementChild;
      const height =
        shell instanceof HTMLElement
          ? shell.getBoundingClientRect().height
          : element.getBoundingClientRect().height;
      if (height > 0) contentHeight.current = height;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const shell = element.firstElementChild;
    if (shell !== null) observer.observe(shell);
    return () => observer.disconnect();
  }, []);
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
