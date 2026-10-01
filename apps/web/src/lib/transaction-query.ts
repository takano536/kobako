import { parseInt4Id } from './ids';

export type TransactionListType = 'expense' | 'income' | 'transfer';
export type TransactionQueryValue = string | string[] | undefined;

export interface TransactionListFilters {
  type?: TransactionListType;
  categoryId?: number;
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

export function parseTransactionListFilters(
  query: Record<string, TransactionQueryValue>,
): TransactionListFilters {
  const type = parseTransactionType(query.type);
  return {
    type,
    categoryId: type === 'transfer' ? undefined : parseTransactionCategoryId(query.category),
  };
}
