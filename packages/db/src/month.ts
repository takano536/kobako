const TOKYO_TIME_ZONE = 'Asia/Tokyo';
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const MIN_SUPPORTED_YEAR = 1900;
export const MAX_SUPPORTED_YEAR = 9998;

export interface MonthRange {
  month: string;
  start: string;
  endExclusive: string;
}

function isSupportedYear(year: number): boolean {
  return year >= MIN_SUPPORTED_YEAR && year <= MAX_SUPPORTED_YEAR;
}

export function isValidMonth(value: string): boolean {
  const match = MONTH_PATTERN.exec(value);
  return match ? isSupportedYear(Number(match[1])) : false;
}

export function currentTokyoMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TOKYO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) {
    throw new Error('Unable to determine the current Tokyo month');
  }
  return `${year}-${month}`;
}

export function currentTokyoDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TOKYO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error('Unable to determine the current Tokyo date');
  }
  return `${year}-${month}-${day}`;
}

export function parseMonth(value: unknown, fallback = currentTokyoMonth()): string {
  return typeof value === 'string' && isValidMonth(value) ? value : fallback;
}

export function monthRange(month: string): MonthRange {
  if (!isValidMonth(month)) {
    throw new Error('Invalid month; expected YYYY-MM within supported bounds');
  }

  const match = MONTH_PATTERN.exec(month);
  if (!match) {
    throw new Error('Invalid month; expected YYYY-MM within supported bounds');
  }
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const endExclusive = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;
  return { month, start: `${month}-01`, endExclusive };
}

export function shiftMonth(month: string, offset: number): string {
  if (!isValidMonth(month) || !Number.isInteger(offset)) {
    throw new Error('Invalid month or offset');
  }

  const match = MONTH_PATTERN.exec(month);
  if (!match) {
    throw new Error('Invalid month; expected YYYY-MM within supported bounds');
  }
  const absoluteMonth = Number(match[1]) * 12 + Number(match[2]) - 1 + offset;
  const year = Math.floor(absoluteMonth / 12);
  const monthNumber = ((absoluteMonth % 12) + 12) % 12;
  if (!isSupportedYear(year)) {
    throw new Error('Month shift exceeded supported bounds');
  }
  return `${String(year).padStart(4, '0')}-${String(monthNumber + 1).padStart(2, '0')}`;
}
