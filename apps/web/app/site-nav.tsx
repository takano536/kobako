'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { KobakoMark } from '../src/lib/category';
import { withSelectedMonth } from '../src/lib/month-navigation';

export function SiteBrand() {
  const searchParams = useSearchParams();
  return (
    <Link
      className="brand"
      href={withSelectedMonth('/', searchParams.get('month'))}
      aria-label="kobako 家計ノート ホーム"
    >
      <KobakoMark />
      <span>kobako</span>
    </Link>
  );
}

export function SiteNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const month = searchParams.get('month');
  const overviewHref = withSelectedMonth('/', month);
  const transactionsHref = withSelectedMonth('/transactions', month);
  const balancesHref = withSelectedMonth('/balances', month);
  const addHref = withSelectedMonth('/transactions/new', month);
  const overviewCurrent = pathname === '/';
  const transactionsCurrent = pathname.startsWith('/transactions');
  const balancesCurrent = pathname.startsWith('/balances');
  return (
    <nav className="site-nav" aria-label="メインナビゲーション">
      <Link href={overviewHref} aria-current={overviewCurrent ? 'page' : undefined}>
        概要
      </Link>
      <Link href={transactionsHref} aria-current={transactionsCurrent ? 'page' : undefined}>
        取引
      </Link>
      <Link href={balancesHref} aria-current={balancesCurrent ? 'page' : undefined}>
        残高
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
      <Link href="/balances">残高</Link>
      <Link className="nav-add" href="/transactions/new" aria-label="取引を登録" title="取引を登録">
        <span aria-hidden="true">＋</span>
      </Link>
    </nav>
  );
}
