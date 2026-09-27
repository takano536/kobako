import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { KobakoMark } from '../src/lib/category';
import { SiteNav, SiteNavFallback } from './site-nav';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'kobako 家計ノート',
    template: '%s | kobako 家計ノート',
  },
  description: '収入と支出を静かに記録できる小さな家計ノート',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>
        <div className="app-shell">
          <header className="site-header">
            <div className="header-inner">
              <Link className="brand" href="/" aria-label="kobako 家計ノート ホーム">
                <KobakoMark />
                <span>kobako</span>
              </Link>
              <Suspense fallback={<SiteNavFallback />}>
                <SiteNav />
              </Suspense>
            </div>
          </header>
          <main className="page-content">{children}</main>
        </div>
      </body>
    </html>
  );
}
