function integerText(value: string | number): string {
  const source =
    typeof value === 'number'
      ? Number.isFinite(value)
        ? Math.trunc(value).toString()
        : '0'
      : value.trim().replace(/^−/, '-');
  if (!/^-?\d+$/.test(source)) {
    return '0';
  }
  const negative = source.startsWith('-');
  const digits = (negative ? source.slice(1) : source).replace(/^0+(?=\d)/, '');
  return digits === '0' ? '0' : `${negative ? '-' : ''}${digits}`;
}

export function formatYen(value: string | number): string {
  const text = integerText(value);
  const negative = text.startsWith('-');
  const digits = negative ? text.slice(1) : text;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '−' : ''}${grouped}円`;
}

export function formatTransactionAmount(
  type: 'expense' | 'income',
  value: string | number,
): string {
  const text = integerText(value);
  const negativeAmount = text.startsWith('-');
  const magnitude = negativeAmount ? text.slice(1) : text;
  if (magnitude === '0') {
    return '0円';
  }
  const isNegativeCashflow = type === 'expense' ? !negativeAmount : negativeAmount;
  return `${isNegativeCashflow ? '−' : '＋'}${formatYen(magnitude)}`;
}

export function transactionAmountTone(
  type: 'expense' | 'income',
  value: string | number,
): 'positive' | 'negative' | 'neutral' {
  const text = integerText(value);
  const negativeAmount = text.startsWith('-');
  const magnitude = negativeAmount ? text.slice(1) : text;
  if (magnitude === '0') {
    return 'neutral';
  }
  const isNegativeCashflow = type === 'expense' ? !negativeAmount : negativeAmount;
  return isNegativeCashflow ? 'negative' : 'positive';
}

export function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-');
  return `${year}年${Number(monthNumber)}月`;
}

export function formatExpenseShare(categoryTotal: string, expenseTotal: string): string {
  const category = BigInt(categoryTotal);
  const expense = BigInt(expenseTotal);
  if (expense <= 0n || category < 0n) {
    return '—';
  }
  if (category === 0n) {
    return '0%';
  }
  if (category * 100n < expense) {
    return '<1%';
  }
  const rounded = (category * 100n + expense / 2n) / expense;
  return `${rounded > 100n ? 100n : rounded}%`;
}

export function expenseBarWidth(categoryTotal: string, expenseTotal: string): number {
  const category = BigInt(categoryTotal);
  const expense = BigInt(expenseTotal);
  if (expense <= 0n || category <= 0n) {
    return 0;
  }
  const percentage = Number((category * 10000n) / expense) / 100;
  return Math.min(100, Math.max(0, percentage));
}

const JAPANESE_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

function calendarDateParts(value: string): [year: number, month: number, day: number] | undefined {
  const match = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return [year, month, day];
}

export function formatJapaneseDate(value: string): string {
  const parts = calendarDateParts(value);
  if (!parts) {
    return value;
  }
  const [year, month, day] = parts;
  const weekday = JAPANESE_WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}月${day}日（${weekday}）`;
}
export function formatJapaneseDateWithYear(value: string): string {
  const parts = calendarDateParts(value);
  if (!parts) {
    return value;
  }
  const [year, month, day] = parts;
  const weekday = JAPANESE_WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${year}年${month}月${day}日（${weekday}）`;
}

export function formatJapaneseDateShort(value: string): string {
  const parts = calendarDateParts(value);
  if (!parts) {
    return value;
  }
  const [year, month, day] = parts;
  const weekday = JAPANESE_WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}/${day} ${weekday}`;
}

export function groupTransactionsByDate<T extends { occurredOn: string }>(
  transactions: readonly T[],
): Array<{ occurredOn: string; transactions: T[] }> {
  const groups = new Map<string, T[]>();
  for (const transaction of transactions) {
    const group = groups.get(transaction.occurredOn);
    if (group) {
      group.push(transaction);
    } else {
      groups.set(transaction.occurredOn, [transaction]);
    }
  }
  return Array.from(groups, ([occurredOn, groupedTransactions]) => ({
    occurredOn,
    transactions: groupedTransactions,
  }));
}
