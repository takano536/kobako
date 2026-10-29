'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ListedFixedCost } from '@kobako/db';
import { formatYen } from '../../src/lib/format';
import styles from './fixed-costs.module.css';

const groupOptions = [
  ['categoryName', 'カテゴリ別'], ['intervalUnit', '頻度別'], ['accountName', '資産別'], ['day', '日付別'], ['none', 'なし'],
] as const;
type GroupKey = (typeof groupOptions)[number][0];

export function FixedCostList({ rows }: { rows: readonly ListedFixedCost[] }) {
  const [category, setCategory] = useState('all');
  const [frequency, setFrequency] = useState('all');
  const [account, setAccount] = useState('all');
  const [group, setGroup] = useState<GroupKey>('categoryName');
  useEffect(() => {
    const saved = window.localStorage.getItem('kobako-fixed-cost-group');
    if (groupOptions.some(([key]) => key === saved)) setGroup(saved as GroupKey);
  }, []);
  function updateGroup(next: GroupKey) { setGroup(next); window.localStorage.setItem('kobako-fixed-cost-group', next); }
  const filtered = useMemo(() => rows.filter((row) => (category === 'all' || row.categoryName === category) && (frequency === 'all' || row.intervalUnit === frequency) && (account === 'all' || row.accountName === account)), [rows, category, frequency, account]);
  const groups = new Map<string, ListedFixedCost[]>();
  for (const row of filtered) {
    const key = group === 'none' ? '固定費' : group === 'categoryName' ? row.categoryName : group === 'accountName' ? row.accountName : group === 'day' ? `${row.day}日` : row.intervalUnit === 'month' ? `${row.intervalCount}か月ごと` : `${row.intervalCount}年ごと`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return <>
    <div className={styles.filters} aria-label="固定費の絞り込み">
      <label>カテゴリ<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">すべて</option>{[...new Set(rows.map((row) => row.categoryName))].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>頻度<select value={frequency} onChange={(event) => setFrequency(event.target.value)}><option value="all">すべて</option><option value="month">毎月・か月</option><option value="year">毎年・年</option></select></label>
      <label>資産<select value={account} onChange={(event) => setAccount(event.target.value)}><option value="all">すべて</option>{[...new Set(rows.map((row) => row.accountName))].map((value) => <option key={value}>{value}</option>)}</select></label>
    </div>
    <div className={styles.groupSwitch} aria-label="グルーピング">{groupOptions.map(([key, label]) => <button type="button" key={key} className={group === key ? styles.active : ''} aria-pressed={group === key} onClick={() => updateGroup(key)}>{label}</button>)}</div>
    {filtered.length === 0 ? <p className={styles.empty}>条件に一致する固定費はありません。</p> : [...groups.entries()].map(([name, items]) => <section className={styles.group} key={name}><h2><span>{name}</span><strong>{formatYen(items.reduce((sum, item) => sum + item.amount, 0))}円</strong></h2><ul>{items.map((row) => <li key={row.id} className={styles.row}><Link href={`/fixed-costs/${row.id}/edit`}><span className={styles.name}>{row.name}</span><span className={styles.meta}>{row.intervalUnit === 'month' ? `${row.intervalCount === 1 ? '毎月' : `${row.intervalCount}か月ごと`}` : `${row.intervalCount === 1 ? '毎年' : `${row.intervalCount}年ごと`}`}・毎月{row.day}日・{row.accountName}</span></Link><strong>{formatYen(row.amount)}円</strong></li>)}</ul></section>)}
  </>;
}
