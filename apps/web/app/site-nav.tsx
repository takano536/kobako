'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

export function SiteNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const month = searchParams.get('month');
  const addHref = month
    ? `/transactions/new?month=${encodeURIComponent(month)}`
    : '/transactions/new';
  const overviewCurrent = pathname === '/';
  const transactionsCurrent = pathname.startsWith('/transactions');

  return (
    <nav className="site-nav" aria-label="メインナビゲーション">
      <Link href="/" aria-current={overviewCurrent ? 'page' : undefined}>
        概要
      </Link>
      <Link href="/transactions" aria-current={transactionsCurrent ? 'page' : undefined}>
        取引
      </Link>
      <Link className="nav-add" href={addHref} aria-label="取引を登録" title="取引を登録">
        <span aria-hidden="true">＋</span>
      </Link>
    </nav>
  );
}

export function SiteNavFallback() {
  return (
    <nav className="site-nav" aria-label="メインナビゲーション">
      <Link href="/">概要</Link>
      <Link href="/transactions">取引</Link>
      <Link className="nav-add" href="/transactions/new" aria-label="取引を登録" title="取引を登録">
        <span aria-hidden="true">＋</span>
      </Link>
    </nav>
  );
}
