'use client';

import { usePathname, useSearchParams } from 'next/navigation';

import { useNavigationShell } from './_components/navigation-shell-context';
import { PrefetchLink } from './_components/prefetch-link';

import { KobakoMark } from '../src/lib/category';
import { withSelectedMonth } from '../src/lib/month-navigation';
import { siteNavigationSection, type SiteNavigationSection } from '../src/lib/site-navigation';
import { SettingsIcon } from './_components/ui';
import navStyles from './site-nav.module.css';

function SiteNavIcon({ section }: { section: SiteNavigationSection }) {
  if (section === 'overview') {
    return (
      <svg
        className={navStyles['site-nav-icon']}
        viewBox="0 0 24 24"
        focusable="false"
        aria-hidden="true"
      >
        <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
      </svg>
    );
  }
  if (section === 'transactions') {
    return (
      <svg
        className={navStyles['site-nav-icon']}
        viewBox="0 0 24 24"
        focusable="false"
        aria-hidden="true"
      >
        <path d="M5 5h14M5 12h14M5 19h14" />
        <path d="M3 5h.01M3 12h.01M3 19h.01" />
      </svg>
    );
  }
  if (section === 'fixed-costs') {
    return (
      <svg
        className={navStyles['site-nav-icon']}
        viewBox="0 0 24 24"
        focusable="false"
        aria-hidden="true"
      >
        <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />
      </svg>
    );
  }
  return (
    <svg className={navStyles['site-nav-icon']} focusable="false" aria-hidden="true">
      <path d="M4 20V5M4 20h16M8 16v-4M12 16V8M16 16V4" />
    </svg>
  );
}

const navigationLinks = [
  { section: 'overview', label: '概要', href: '/' },
  { section: 'transactions', label: '取引', href: '/transactions' },
  { section: 'fixed-costs', label: '固定費', href: '/fixed-costs' },
  { section: 'balances', label: '残高', href: '/balances' },
] as const satisfies ReadonlyArray<{
  section: Exclude<SiteNavigationSection, 'settings'>;
  label: string;
  href: string;
}>;

export function SiteBrand() {
  const searchParams = useSearchParams();
  return (
    <PrefetchLink
      data-slot="brand"
      className={navStyles.brand}
      href={withSelectedMonth('/', searchParams.get('month'))}
      aria-label="kobako 家計ノート ホーム"
    >
      <KobakoMark />
      <span>kobako</span>
    </PrefetchLink>
  );
}

/**
 * 現在地の区分です。引き受けた遷移の間はタップした遷移先を現在地とし、押した反応を
 * 本文の到着を待たずに示します。`aria-current` は遷移の前後で途切れずに移ります。
 */
function useCurrentSection(): SiteNavigationSection | undefined {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pendingTo = useNavigationShell()?.pending?.pathname ?? null;
  return pendingTo
    ? siteNavigationSection(pendingTo)
    : siteNavigationSection(pathname, searchParams.get('return'));
}

export function SiteNav() {
  const month = useSearchParams().get('month');
  const currentSection = useCurrentSection();
  const pendingTo = useNavigationShell()?.pending?.pathname ?? null;
  return (
    <nav data-slot="site-nav" className={navStyles['site-nav']} aria-label="メインナビゲーション">
      {navigationLinks.map(({ section, label, href }) => (
        <PrefetchLink
          key={section}
          href={withSelectedMonth(href, month)}
          aria-current={currentSection === section ? 'page' : undefined}
          data-pending={pendingTo === href ? 'true' : undefined}
          aria-busy={pendingTo === href || undefined}
        >
          <SiteNavIcon section={section} />
          <span>{label}</span>
        </PrefetchLink>
      ))}
    </nav>
  );
}

export function SiteNavFallback() {
  return (
    <nav data-slot="site-nav" className={navStyles['site-nav']} aria-label="メインナビゲーション">
      {navigationLinks.map(({ section, label, href }) => (
        <PrefetchLink key={section} href={href}>
          <SiteNavIcon section={section} />
          <span>{label}</span>
        </PrefetchLink>
      ))}
    </nav>
  );
}

export function SiteSettings() {
  const settingsCurrent = useCurrentSection() === 'settings';
  const pending = useNavigationShell()?.pending?.pathname === '/settings';
  return (
    <PrefetchLink
      data-slot="site-settings"
      className={navStyles['site-settings']}
      href="/settings"
      aria-label="設定"
      title="設定"
      aria-current={settingsCurrent ? 'page' : undefined}
      data-pending={pending ? 'true' : undefined}
      aria-busy={pending || undefined}
    >
      <SettingsIcon />
    </PrefetchLink>
  );
}

export function SiteSettingsFallback() {
  return (
    <PrefetchLink
      data-slot="site-settings"
      className={navStyles['site-settings']}
      href="/settings"
      title="設定"
    >
      <SettingsIcon />
    </PrefetchLink>
  );
}
