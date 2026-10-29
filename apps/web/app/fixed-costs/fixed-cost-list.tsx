'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ListedFixedCost } from '@kobako/db';
import { formatYen } from '../../src/lib/format';
import styles from './fixed-costs.module.css';

type FilterKey = 'category' | 'frequency' | 'account' | 'group';
type GroupKey = 'categoryName' | 'frequency' | 'accountName' | 'day' | 'none';
const groupOptions: readonly [GroupKey, string][] = [['categoryName', 'カテゴリ別'], ['frequency', '頻度別'], ['accountName', '資産別'], ['day', '日付別'], ['none', 'なし']];

function frequencyValue(row: Pick<ListedFixedCost, 'intervalCount' | 'intervalUnit'>): string {
  return `${row.intervalUnit}-${row.intervalCount}`;
}
function frequencyLabel(row: Pick<ListedFixedCost, 'intervalCount' | 'intervalUnit' | 'day' | 'startMonth'>): string {
  const interval = row.intervalUnit === 'year' ? `${row.intervalCount === 1 ? '毎年' : `${row.intervalCount}年ごと`}` : `${row.intervalCount === 1 ? '毎月' : `${row.intervalCount}か月ごと`}`;
  return row.intervalUnit === 'year' ? `${interval}${new Date(row.startMonth).getUTCMonth() + 1}月${row.day}日` : `${interval}${row.day}日`;
}

export function FixedCostList({ rows }: { rows: readonly ListedFixedCost[] }) {
  const [filters, setFilters] = useState<Record<FilterKey, string>>({ category: '', frequency: '', account: '', group: 'categoryName' });
  const [open, setOpen] = useState<FilterKey | null>(null);
  useEffect(() => {
    const saved = window.localStorage.getItem('kobako-fixed-cost-group');
    if (groupOptions.some(([key]) => key === saved)) setFilters((current) => ({ ...current, group: saved ?? 'categoryName' }));
  }, []);
  function choose(key: FilterKey, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setOpen(null);
    if (key === 'group') window.localStorage.setItem('kobako-fixed-cost-group', value);
  }
  const categories = [...new Set(rows.map((row) => row.categoryName))];
  const accounts = [...new Set(rows.map((row) => row.accountName))];
  const frequencies = [...new Set(rows.map(frequencyValue))];
  const filtered = useMemo(() => rows.filter((row) => (!filters.category || row.categoryName === filters.category) && (!filters.account || row.accountName === filters.account) && (!filters.frequency || frequencyValue(row) === filters.frequency)), [rows, filters]);
  const groups = new Map<string, ListedFixedCost[]>();
  for (const row of filtered) {
    const key = filters.group === 'none' ? '固定費' : filters.group === 'categoryName' ? row.categoryName : filters.group === 'accountName' ? row.accountName : filters.group === 'day' ? `${row.day}日` : frequencyLabel(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const active = Object.entries(filters).filter(([key, value]) => key !== 'group' && value);
  if (rows.length === 0) return <Empty message="まだ固定費がありません" />;
  return <>
    <div className={styles.filters} aria-label="固定費の絞り込み">
      <FilterChip label="カテゴリ" value={filters.category} options={categories} open={open === 'category'} onToggle={() => setOpen(open === 'category' ? null : 'category')} onChoose={(value) => choose('category', value)} />
      <FilterChip label="頻度" value={filters.frequency} options={frequencies} optionLabels={frequencies.map((value) => { const [unit, count] = value.split('-'); return unit === 'year' ? `${count}年ごと` : count === '1' ? '毎月' : `${count}か月ごと`; })} open={open === 'frequency'} onToggle={() => setOpen(open === 'frequency' ? null : 'frequency')} onChoose={(value) => choose('frequency', value)} />
      <FilterChip label="資産" value={filters.account} options={accounts} open={open === 'account'} onToggle={() => setOpen(open === 'account' ? null : 'account')} onChoose={(value) => choose('account', value)} />
      <FilterChip label="グループ" value={filters.group} options={groupOptions.map(([key]) => key)} optionLabels={groupOptions.map(([, label]) => label)} open={open === 'group'} onToggle={() => setOpen(open === 'group' ? null : 'group')} onChoose={(value) => choose('group', value)} />
      {active.length > 0 ? <button type="button" className={styles.clear} onClick={() => setFilters((current) => ({ ...current, category: '', frequency: '', account: '' }))}>条件をクリア</button> : null}
    </div>
    {filtered.length === 0 ? <Empty message="条件に合う固定費がありません" onClear={() => setFilters((current) => ({ ...current, category: '', frequency: '', account: '' }))} /> : [...groups.entries()].map(([name, items]) => <section className={styles.group} key={name}><h2><span>{name}</span><span className={styles.groupLabel}>金額</span></h2><ul>{items.map((row) => <li key={row.id} className={styles.row}><Link href={`/fixed-costs/${row.id}/edit`}><span className={styles.name}>{row.name}</span><span className={styles.meta}>{frequencyLabel(row)}・{row.accountName}</span></Link><strong>{formatYen(row.amount)}</strong></li>)}</ul></section>)}
  </>;
}

function FilterChip({ label, value, options, optionLabels, open, onToggle, onChoose }: { label: string; value: string; options: readonly string[]; optionLabels?: readonly string[]; open: boolean; onToggle: () => void; onChoose: (value: string) => void }) {
  const selectedLabel = value ? optionLabels?.[options.indexOf(value)] ?? value : '';
  return <div className={styles.chipWrap}><button type="button" className={`${styles.chip} ${value ? styles.chipActive : ''}`} aria-expanded={open} onClick={onToggle}>{value ? `${label}: ${selectedLabel}` : label}{value ? <span aria-hidden="true">×</span> : null}</button>{open ? <div className={styles.menu} role="menu">{!value || label === 'グループ' ? null : <button role="menuitemradio" aria-checked="false" onClick={() => onChoose('')}>すべて</button>}{options.map((option, index) => <button role="menuitemradio" aria-checked={option === value} key={option} onClick={() => onChoose(option)}>{optionLabels?.[index] ?? option}</button>)}</div> : null}</div>;
}
function Empty({ message, onClear }: { message: string; onClear?: () => void }) { return <div className={styles.empty} role="status"><span aria-hidden="true">○</span><p>{message}</p>{onClear ? <button type="button" onClick={onClear}>条件をクリア</button> : null}</div>; }
