import type { Metadata } from 'next';
import Link from 'next/link';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'kobako 家計簿',
    template: '%s | kobako 家計簿',
  },
  description: '収入と支出をかんたんに記録できる日本向け家計簿アプリ',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>
        <div className="app-shell">
          <header className="site-header">
            <div className="header-inner">
              <Link className="brand" href="/" aria-label="kobako 家計簿 ホーム">
                kobako
              </Link>
              <nav className="site-nav" aria-label="メインナビゲーション">
                <Link href="/">月次概要</Link>
                <Link href="/transactions">取引一覧</Link>
                <Link className="nav-add" href="/transactions/new">
                  ＋ 新規登録
                </Link>
              </nav>
            </div>
          </header>
          <main className="page-content">{children}</main>
        </div>
      </body>
    </html>
  );
}
