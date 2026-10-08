import { isValidMonth } from './transaction-query';

export function isValidDisplayMonth(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && isValidMonth(value);
}

export function withSelectedMonth(path: string, month: string | null | undefined): string {
  if (!isValidDisplayMonth(month)) return path;
  return `${path}${path.includes('?') ? '&' : '?'}month=${encodeURIComponent(month)}`;
}
