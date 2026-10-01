import type { TransferValidationCode } from '@kobako/db';

export type TransactionFormType = 'expense' | 'income' | 'transfer';
export type TransactionFormField =
  'type' | 'amount' | 'occurredOn' | 'categoryId' | 'fromAccountId' | 'toAccountId' | 'memo';

export interface TransactionFormValues {
  type: string;
  amount: string;
  occurredOn: string;
  categoryId: string;
  fromAccountId: string;
  toAccountId: string;
  memo: string;
}

export type TransactionFieldErrors = Partial<Record<TransactionFormField, string[]>>;

export interface TransactionFormState {
  values?: TransactionFormValues;
  errors?: TransactionFieldErrors;
  message?: string;
}

export const emptyTransactionFormState: TransactionFormState = {};

export function transferValidationErrors(code: TransferValidationCode): TransactionFieldErrors {
  if (code === 'same_account') {
    return { toAccountId: ['振替元と振替先は別の口座を選択してください。'] };
  }
  const unavailable = ['選択した口座は利用できません。'];
  if (code === 'from_account_unavailable') {
    return { fromAccountId: unavailable };
  }
  if (code === 'to_account_unavailable') {
    return { toAccountId: unavailable };
  }
  return { fromAccountId: unavailable, toAccountId: unavailable };
}

export function firstTransactionFieldError(
  errors: TransactionFieldErrors | undefined,
  field: TransactionFormField,
): string | undefined {
  return errors?.[field]?.[0];
}

export function switchTransactionType(
  values: TransactionFormValues,
  type: TransactionFormType,
  categories: ReadonlyArray<{ id: number; type: 'expense' | 'income' }>,
): TransactionFormValues {
  const categoryId =
    type === 'transfer'
      ? ''
      : String(categories.find((category) => category.type === type)?.id ?? '');
  return {
    ...values,
    type,
    categoryId,
    fromAccountId: type === 'transfer' ? values.fromAccountId : '',
    toAccountId: type === 'transfer' ? values.toAccountId : '',
  };
}

export interface DeleteFormState {
  message?: string;
}

function categoryIdFromFormData(formData: FormData): unknown {
  const type = formData.get('type');
  const values = formData.getAll('categoryId');
  const index = type === 'income' ? 1 : 0;
  return values[index] ?? values[0] ?? null;
}
function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export function transactionFormValuesFromFormData(formData: FormData): TransactionFormValues {
  const type = textField(formData, 'type');
  const isTransfer = type === 'transfer';
  return {
    type,
    amount: textField(formData, 'amount'),
    occurredOn: textField(formData, 'occurredOn'),
    categoryId: isTransfer ? '' : String(categoryIdFromFormData(formData) ?? ''),
    fromAccountId: isTransfer ? textField(formData, 'fromAccountId') : '',
    toAccountId: isTransfer ? textField(formData, 'toAccountId') : '',
    memo: textField(formData, 'memo'),
  };
}
