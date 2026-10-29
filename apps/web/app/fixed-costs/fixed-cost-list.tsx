'use client';

import { PrefetchLink } from '../_components/prefetch-link';
import { useEffect, useMemo, useState } from 'react';
import type { ListedFixedCost } from '@kobako/db';
import { formatYen } from '../../src/lib/format';
import styles from './fixed-costs.module.css';

type FilterKey = 'category' | 'frequency' | 'account' | 'group';
type GroupKey = 'categoryName' | 'frequency' | 'accountName' | 'day' | 'none';
const groupOptions: readonly [GroupKey, string][] = [
  ['categoryName', 'カテゴリ別'],
  ['frequency', '頻度別'],
  ['accountName', '資産別'],
  ['day', '日付別'],
  ['none', 'なし'],
];

function frequencyValue(row: Pick<ListedFixedCost, 'intervalCount' | 'intervalUnit'>): string {
  return `${row.intervalUnit}-${row.intervalCount}`;
}
function frequencyLabel(
  row: Pick<ListedFixedCost, 'intervalCount' | 'intervalUnit' | 'day' | 'startMonth'>,
): string {
  const month = new Date(row.startMonth).getUTCMonth() + 1;
  if (row.intervalUnit === 'month' && row.intervalCount === 1) {
    return `毎月${row.day}日`;
  }
  if (row.intervalUnit === 'year' && row.intervalCount === 1) {
    return `毎年${month}月${row.day}日`;
  }
  const unit = row.intervalUnit === 'year' ? '年' : 'か月';
  return `${row.intervalCount}${unit}ごと・${month}月${row.day}日`;
}

export function FixedCostList({ rows }: { rows: readonly ListedFixedCost[] }) {
  const [filters, setFilters] = useState<Record<FilterKey, string>>({
    category: '',
    frequency: '',
    account: '',
    group: 'categoryName',
  });
  const [open, setOpen] = useState<FilterKey | null>(null);
  useEffect(() => {
    const saved = window.localStorage.getItem('kobako-fixed-cost-group');
    if (groupOptions.some(([key]) => key === saved))
      setFilters((current) => ({ ...current, group: saved ?? 'categoryName' }));
  }, []);
  function choose(key: FilterKey, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setOpen(null);
    if (key === 'group') window.localStorage.setItem('kobako-fixed-cost-group', value);
  }
  const categories = [...new Set(rows.map((row) => row.categoryName))];
  const accounts = [...new Set(rows.map((row) => row.accountName))];
  const frequencies = [...new Set([...rows.map(frequencyValue), 'month-1', 'year-1'])];
  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          (!filters.category || row.categoryName === filters.category) &&
          (!filters.account || row.accountName === filters.account) &&
          (!filters.frequency || frequencyValue(row) === filters.frequency),
      ),
    [rows, filters],
  );
  const groups = new Map<string, ListedFixedCost[]>();
  for (const row of filtered) {
    const key =
      filters.group === 'none'
        ? '固定費'
        : filters.group === 'categoryName'
          ? row.categoryName
          : filters.group === 'accountName'
            ? row.accountName
            : filters.group === 'day'
              ? `${row.day}日`
              : frequencyLabel(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const active = Object.entries(filters).filter(([key, value]) => key !== 'group' && value);
  if (rows.length === 0) return <Empty message="まだ固定費がありません" />;
  return (
    <>
      <div className={styles.filters} aria-label="固定費の表示条件">
        <FilterChip
          label="グループ"
          value={filters.group}
          options={groupOptions.map(([key]) => key)}
          optionLabels={groupOptions.map(([, label]) => label)}
          open={open === 'group'}
          onToggle={() => setOpen(open === 'group' ? null : 'group')}
          onChoose={(value) => choose('group', value)}
          removable={false}
        />
        <FilterChip
          label="カテゴリ"
          value={filters.category}
          options={categories}
          open={open === 'category'}
          onToggle={() => setOpen(open === 'category' ? null : 'category')}
          onChoose={(value) => choose('category', value)}
        />
        <FilterChip
          label="頻度"
          value={filters.frequency}
          options={frequencies}
          optionLabels={frequencies.map((value) => {
            const [unit, count] = value.split('-');
            return unit === 'year' ? `${count}年ごと` : count === '1' ? '毎月' : `${count}か月ごと`;
          })}
          open={open === 'frequency'}
          onToggle={() => setOpen(open === 'frequency' ? null : 'frequency')}
          onChoose={(value) => choose('frequency', value)}
        />
        <FilterChip
          label="資産"
          value={filters.account}
          options={accounts}
          open={open === 'account'}
          onToggle={() => setOpen(open === 'account' ? null : 'account')}
          onChoose={(value) => choose('account', value)}
        />
        {active.length > 0 ? (
          <button
            type="button"
            className={styles.clear}
            onClick={() =>
              setFilters((current) => ({ ...current, category: '', frequency: '', account: '' }))
            }
          >
            条件をクリア
          </button>
        ) : null}
      </div>
      {filtered.length === 0 ? (
        <Empty
          message="条件に合う固定費がありません"
          onClear={() =>
            setFilters((current) => ({ ...current, category: '', frequency: '', account: '' }))
          }
        />
      ) : filters.group === 'none' ? (
        <ul className={styles.flatList}>
          {filtered.map((row) => (
            <FixedCostRow row={row} key={row.id} />
          ))}
        </ul>
      ) : (
        <div className={styles.groups}>
          {[...groups.entries()].map(([name, items], index) => (
            <section
              className={styles.group}
              key={name}
              aria-labelledby={`fixed-cost-group-${index}`}
            >
              <div className={styles.groupHeading}>
                <h3 id={`fixed-cost-group-${index}`}>{name}</h3>
                <div className={styles.groupHeadingColumns}>
                  <span className={styles.groupLabel}>金額</span>
                </div>
              </div>
              <ul className={styles.list} aria-labelledby={`fixed-cost-group-${index}`}>
                {items.map((row) => (
                  <FixedCostRow row={row} key={row.id} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function FixedCostRow({ row }: { row: ListedFixedCost }) {
  return (
    <li className={styles.row}>
      <PrefetchLink className={styles.rowLink} href={`/fixed-costs/${row.id}/edit`} scroll={false}>
        <span className={styles.nameCell}>
          <span className={styles.name}>{row.name}</span>
          <span className={styles.meta}>
            {frequencyLabel(row)}・{row.accountName}
          </span>
        </span>
        <strong className={styles.amount}>{formatYen(row.amount)}</strong>
      </PrefetchLink>
    </li>
  );
}

function FilterChip({
  label,
  value,
  options,
  optionLabels,
  open,
  onToggle,
  onChoose,
  removable = true,
}: {
  label: string;
  value: string;
  options: readonly string[];
  optionLabels?: readonly string[];
  open: boolean;
  onToggle: () => void;
  onChoose: (value: string) => void;
  removable?: boolean;
}) {
  const selectedLabel = value ? (optionLabels?.[options.indexOf(value)] ?? value) : '';
  const active = removable && Boolean(value);
  return (
    <div
      className={styles.chipWrap}
      data-active={active ? 'true' : 'false'}
      data-open={open ? 'true' : 'false'}
    >
      <div
        className={styles.chip}
        data-active={active ? 'true' : 'false'}
        data-open={open ? 'true' : 'false'}
      >
        <button
          type="button"
          className={styles.trigger}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={onToggle}
        >
          <span className={styles.label}>{label}</span>
          {value ? <span className={styles.value}>{selectedLabel}</span> : null}
          <svg className={styles.arrow} viewBox="0 0 10 10" aria-hidden="true">
            <path d="m2 3.5 3 3 3-3" />
          </svg>
        </button>
        {removable && value ? (
          <button
            type="button"
            className={styles.remove}
            aria-label="絞り込みを外す"
            onClick={() => onChoose('')}
          >
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
      </div>
      {open ? (
        <div className={styles.menu} role="menu" aria-label={label}>
          {removable && value ? (
            <button
              type="button"
              role="menuitemradio"
              aria-checked="false"
              onClick={() => onChoose('')}
            >
              すべて
              <span className={styles.menuCheck} aria-hidden="true">
                ✓
              </span>
            </button>
          ) : null}
          {options.map((option, index) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={option === value}
              data-filter-value={option}
              key={option}
              onClick={() => onChoose(option)}
            >
              {optionLabels?.[index] ?? option}
              <span className={styles.menuCheck} aria-hidden="true">
                ✓
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
function Empty({ message, onClear }: { message: string; onClear?: () => void }) {
  return (
    <div className={styles.empty} role="status">
      <span aria-hidden="true">○</span>
      <p>{message}</p>
      {onClear ? (
        <button type="button" onClick={onClear}>
          条件をクリア
        </button>
      ) : null}
    </div>
  );
}
