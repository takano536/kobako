export type SiteNavigationSection =
  'overview' | 'transactions' | 'balances' | 'fixed-costs' | 'settings';

export const SITE_NAVIGATION_LINKS = [
  { section: 'overview', label: '概要', href: '/' },
  { section: 'transactions', label: '取引', href: '/transactions' },
  { section: 'fixed-costs', label: '固定費', href: '/fixed-costs' },
  { section: 'balances', label: '残高', href: '/balances' },
] as const satisfies ReadonlyArray<{
  section: Exclude<SiteNavigationSection, 'settings'>;
  label: string;
  href: string;
}>;

function isPathOrDescendant(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function sectionForKnownPath(pathname: string): SiteNavigationSection | undefined {
  if (pathname === '/') return 'overview';
  if (isPathOrDescendant(pathname, '/transactions')) return 'transactions';
  if (isPathOrDescendant(pathname, '/balances')) return 'balances';
  if (isPathOrDescendant(pathname, '/fixed-costs')) return 'fixed-costs';
  if (isPathOrDescendant(pathname, '/settings')) return 'settings';
  return undefined;
}

function pathnameFromReturnPath(returnPath: string | null | undefined): string | undefined {
  if (!returnPath || !returnPath.startsWith('/') || returnPath.startsWith('//')) return undefined;
  try {
    return new URL(returnPath, 'http://kobako.local').pathname;
  } catch {
    return undefined;
  }
}

/** Resolve the global navigation parent for a pathname, including account form returns. */
export function siteNavigationSection(
  pathname: string,
  accountReturnPath?: string | null,
): SiteNavigationSection | undefined {
  const directSection = sectionForKnownPath(pathname);
  if (directSection) return directSection;
  if (pathname === '/accounts/new') return 'balances';
  if (/^\/accounts\/[^/]+\/edit$/.test(pathname)) {
    const returnSection = sectionForKnownPath(pathnameFromReturnPath(accountReturnPath) ?? '');
    return returnSection === 'overview' ||
      returnSection === 'transactions' ||
      returnSection === 'balances' ||
      returnSection === 'fixed-costs' ||
      returnSection === 'settings'
      ? returnSection
      : 'transactions';
  }
  return undefined;
}
