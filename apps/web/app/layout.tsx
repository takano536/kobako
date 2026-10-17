import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import navStyles from './site-nav.module.css';
import layoutStyles from './_components/layout.module.css';
import { Suspense } from 'react';

import '@fontsource-variable/noto-sans-jp/index.css';

import { KobakoMark } from '../src/lib/category';
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
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>
        <div data-slot="app-shell" className={layoutStyles['app-shell']}>
          <header data-slot="site-header" className={layoutStyles['site-header']}>
            <div data-slot="header-inner" className={layoutStyles['header-inner']}>
              <Suspense
                fallback={
                  <Link className={navStyles.brand} href="/" aria-label="kobako 家計ノート ホーム">
                    <KobakoMark />
                    <span>kobako</span>
                  </Link>
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
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
