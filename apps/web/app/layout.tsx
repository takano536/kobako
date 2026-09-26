import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'kobako',
  description: '家計簿アプリ kobako の開発基盤',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
