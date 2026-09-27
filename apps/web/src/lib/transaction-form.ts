export type TransactionFormField = 'type' | 'amount' | 'occurredOn' | 'categoryId' | 'memo';

export interface TransactionFormValues {
  type: string;
  amount: string;
  occurredOn: string;
  categoryId: string;
  memo: string;
}

export type TransactionFieldErrors = Partial<Record<TransactionFormField, string[]>>;

export interface TransactionFormState {
  values?: TransactionFormValues;
  errors?: TransactionFieldErrors;
  message?: string;
}

export const emptyTransactionFormState: TransactionFormState = {};

export interface DeleteFormState {
  message?: string;
}
