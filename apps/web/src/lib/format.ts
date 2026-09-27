export function formatYen(value: string | number): string {
  const text = typeof value === 'number' ? String(value) : value;
  const negative = text.startsWith('-');
  const digits = negative ? text.slice(1) : text;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}円`;
}

export function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-');
  return `${year}年${Number(monthNumber)}月`;
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
