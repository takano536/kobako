export type TransferFormField = 'fromAccountId' | 'toAccountId' | 'amount' | 'occurredOn' | 'memo';

export interface TransferFormValues {
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  occurredOn: string;
  memo: string;
}

export type TransferFieldErrors = Partial<Record<TransferFormField, string[]>>;

export interface TransferFormState {
  values?: TransferFormValues;
  errors?: TransferFieldErrors;
  message?: string;
}

export const emptyTransferFormState: TransferFormState = {};

export interface DeleteTransferFormState {
  message?: string;
}
