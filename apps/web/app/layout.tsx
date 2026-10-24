import type { Metadata, Viewport } from 'next';
import navStyles from './site-nav.module.css';
import layoutStyles from './_components/layout.module.css';
import { Suspense } from 'react';

import '@fontsource-variable/noto-sans-jp/index.css';

import { KobakoMark } from '../src/lib/category';
import { THEME_COLORS } from '../src/lib/theme';
import { PrefetchLink } from './_components/prefetch-link';
import { NavigationShell, NavigationShellProvider } from './_components/navigation-shell';
import { SelectDismissTapGuard } from './_components/select-dismiss-tap-guard';
import { TapDebugLog } from './_components/tap-debug-log';
import { ThemeScript } from './_components/theme-script';
import { OriginBadgeScript } from './_components/origin-badge-script';
import {
  SiteBrand,
  SiteNav,
  SiteNavFallback,
  SiteSettings,
  SiteSettingsFallback,
} from './site-nav';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'kobako 家計ノート',
    template: '%s | kobako 家計ノート',
  },
  description: '家計の収入と支出を記録できます。',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLORS.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLORS.dark },
  ],
};

export default function RootLayout({
  children,
  modal,
}: Readonly<{ children: React.ReactNode; modal: React.ReactNode }>) {
  return (
    // The inline script sets the theme attributes on <html> before hydration.
    <html lang="ja" suppressHydrationWarning>
      <head>
        <ThemeScript />
        <OriginBadgeScript />
      </head>
      <body>
        <SelectDismissTapGuard />
        <TapDebugLog />
        <NavigationShellProvider>
          <div data-slot="app-shell" className={layoutStyles['app-shell']}>
            <header data-slot="site-header" className={layoutStyles['site-header']}>
              <div data-slot="header-inner" className={layoutStyles['header-inner']}>
                <Suspense
                  fallback={
                    <PrefetchLink
                      className={navStyles.brand}
                      href="/"
                      aria-label="kobako 家計ノート ホーム"
                    >
                      <KobakoMark />
                      <span>kobako</span>
                    </PrefetchLink>
                  }
                >
                  <SiteBrand />
                </Suspense>
                <Suspense fallback={<SiteNavFallback />}>
                  <SiteNav />
                </Suspense>
                <Suspense fallback={<SiteSettingsFallback />}>
                  <SiteSettings />
                </Suspense>
              </div>
            </header>
            <main data-slot="page-content" className={layoutStyles['page-content']}>
              <NavigationShell>{children}</NavigationShell>
            </main>
            {modal}
          </div>
        </NavigationShellProvider>
      </body>
    </html>
  );
}
