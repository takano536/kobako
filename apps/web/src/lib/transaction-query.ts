import { parseInt4Id } from './ids';

export type TransactionListType = 'expense' | 'income' | 'transfer';
export type TransactionQueryValue = string | string[] | undefined;
export interface FilterCategory {
  id: number;
  name: string;
  type: 'expense' | 'income';
}

export interface TransactionListFilters {
  type?: TransactionListType;
  categoryId?: number;
  accountId?: number;
  page?: number;
}

export function firstQueryValue(value: TransactionQueryValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseTransactionType(
  value: TransactionQueryValue,
): TransactionListType | undefined {
  const firstValue = firstQueryValue(value);
  return firstValue === 'expense' || firstValue === 'income' || firstValue === 'transfer'
    ? firstValue
    : undefined;
}

export function parseTransactionCategoryId(value: TransactionQueryValue): number | undefined {
  const firstValue = firstQueryValue(value);
  return firstValue ? parseInt4Id(firstValue) : undefined;
}

export function parseTransactionAccountId(value: TransactionQueryValue): number | undefined {
  const firstValue = firstQueryValue(value);
  return firstValue ? parseInt4Id(firstValue) : undefined;
}

export function parseTransactionPage(value: TransactionQueryValue): number {
  const firstValue = firstQueryValue(value);
  if (!firstValue) return 1;
  const parsed = parseInt4Id(firstValue);
  return parsed ?? 1;
}

export function parseTransactionListFilters(
  query: Record<string, TransactionQueryValue>,
): TransactionListFilters {
  const type = parseTransactionType(query.type);
  return {
    type,
    categoryId: type === 'transfer' ? undefined : parseTransactionCategoryId(query.category),
    accountId: parseTransactionAccountId(query.account),
    page: parseTransactionPage(query.page),
  };
}

export function validatedTransactionReturn(
  value: string | undefined,
  accountId: number,
): string | undefined {
  if (!value || !value.startsWith('/transactions')) return undefined;
  let url: URL;
  try {
    url = new URL(value, 'http://kobako.local');
  } catch {
    return undefined;
  }
  if (url.pathname !== '/transactions') return undefined;
  const month = url.searchParams.get('month');
  if (!month || (month !== 'all' && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))) {
    return undefined;
  }
  const account = parseTransactionAccountId(url.searchParams.get('account') ?? undefined);
  if (account !== accountId) return undefined;
  const rawType = url.searchParams.get('type');
  const type = parseTransactionType(rawType ?? undefined);
  if (rawType && !type) return undefined;
  const rawCategory = url.searchParams.get('category');
  const category = parseTransactionCategoryId(rawCategory ?? undefined);
  if (rawCategory && category === undefined) return undefined;
  const pageValue = url.searchParams.get('page');
  if (pageValue && !/^\d+$/.test(pageValue)) return undefined;
  const page = pageValue ? parseTransactionPage(pageValue) : 1;
  if (pageValue && page < 1) return undefined;
  const params = new URLSearchParams({ account: String(accountId), month });
  if (type) params.set('type', type);
  if (category !== undefined && type !== 'transfer') params.set('category', String(category));
  params.set('account', String(accountId));
  if (page > 1) params.set('page', String(page));
  return `/transactions?${params.toString()}`;
}

export function transactionReturnWithSaved(path: string): string {
  const url = new URL(path, 'http://kobako.local');
  url.searchParams.set('saved', '1');
  return `${url.pathname}?${url.searchParams.toString()}`;
}
