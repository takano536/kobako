'use client';

import { useActionState, useEffect, useState, type FormEvent } from 'react';
import { useFormStatus } from 'react-dom';

import {
  MEMO_MAX_LENGTH,
  flattenTransactionError,
  transactionInputSchema,
} from '@kobako/db/validation';

import {
  emptyTransactionFormState,
  type DeleteFormState,
  type TransactionFieldErrors,
  type TransactionFormState,
  type TransactionFormValues,
} from '../../src/lib/transaction-form';
import { deleteTransactionAction } from './actions';

type TransactionType = 'expense' | 'income';

type CategoryOption = {
  id: number;
  type: TransactionType;
  name: string;
};

export interface TransactionFormProps {
  action: (
    previousState: TransactionFormState,
    formData: FormData,
  ) => Promise<TransactionFormState>;
  categories: CategoryOption[];
  initialValues: TransactionFormValues;
  submitLabel: string;
}

function fieldError(
  errors: TransactionFieldErrors | undefined,
  field: keyof TransactionFormValues,
): string | undefined {
  return errors?.[field]?.[0];
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="button button-primary" type="submit" disabled={pending}>
      {pending ? '保存中…' : label}
    </button>
  );
}

export function TransactionForm({
  action,
  categories,
  initialValues,
  submitLabel,
}: TransactionFormProps) {
  const [state, formAction] = useActionState(action, emptyTransactionFormState);
  const [values, setValues] = useState(initialValues);
  const [clientErrors, setClientErrors] = useState<TransactionFieldErrors>();
  const matchingCategories = categories.filter((category) => category.type === values.type);

  useEffect(() => {
    if (state.values) {
      setValues(state.values);
      setClientErrors(undefined);
    }
  }, [state.values]);

  function updateValue(field: keyof TransactionFormValues, value: string): void {
    setValues((current) => ({
      ...current,
      [field]: value,
      ...(field === 'type' ? { categoryId: '' } : {}),
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    const result = transactionInputSchema.safeParse(values);
    if (result.success) {
      setClientErrors(undefined);
      return;
    }
    event.preventDefault();
    setClientErrors(flattenTransactionError(result.error).fieldErrors as TransactionFieldErrors);
  }

  const errors = clientErrors ?? state.errors;
  const typeError = fieldError(errors, 'type');
  const amountError = fieldError(errors, 'amount');
  const occurredOnError = fieldError(errors, 'occurredOn');
  const categoryError = fieldError(errors, 'categoryId');
  const memoError = fieldError(errors, 'memo');
  const summaryMessage = clientErrors ? '入力内容を確認してください。' : state.message;

  return (
    <form className="ledger-form" action={formAction} onSubmit={handleSubmit} noValidate>
      {summaryMessage ? (
        <p className="form-message" role="alert">
          {summaryMessage}
        </p>
      ) : null}
      <div className="field-group">
        <label htmlFor="transaction-type">種別</label>
        <select
          id="transaction-type"
          name="type"
          value={values.type}
          onChange={(event) => updateValue('type', event.currentTarget.value)}
          aria-invalid={typeError ? true : undefined}
          aria-describedby={typeError ? 'transaction-type-error' : undefined}
          required
        >
          <option value="expense">支出</option>
          <option value="income">収入</option>
        </select>
        {typeError ? (
          <p className="field-error" id="transaction-type-error">
            {typeError}
          </p>
        ) : null}
      </div>
      <div className="field-group">
        <label htmlFor="transaction-amount">金額（円）</label>
        <input
          id="transaction-amount"
          name="amount"
          type="text"
          inputMode="numeric"
          value={values.amount}
          onChange={(event) => updateValue('amount', event.currentTarget.value)}
          aria-invalid={amountError ? true : undefined}
          aria-describedby={amountError ? 'transaction-amount-error' : undefined}
          required
        />
        {amountError ? (
          <p className="field-error" id="transaction-amount-error">
            {amountError}
          </p>
        ) : null}
      </div>
      <div className="field-group">
        <label htmlFor="transaction-date">日付</label>
        <input
          id="transaction-date"
          name="occurredOn"
          type="date"
          value={values.occurredOn}
          onChange={(event) => updateValue('occurredOn', event.currentTarget.value)}
          aria-invalid={occurredOnError ? true : undefined}
          aria-describedby={occurredOnError ? 'transaction-date-error' : undefined}
          required
        />
        {occurredOnError ? (
          <p className="field-error" id="transaction-date-error">
            {occurredOnError}
          </p>
        ) : null}
      </div>
      <div className="field-group">
        <label htmlFor="transaction-category">カテゴリ</label>
        <select
          id="transaction-category"
          name="categoryId"
          value={values.categoryId}
          onChange={(event) => updateValue('categoryId', event.currentTarget.value)}
          aria-invalid={categoryError ? true : undefined}
          aria-describedby={categoryError ? 'transaction-category-error' : undefined}
          required
        >
          <option value="">選択してください</option>
          {matchingCategories.map((category) => (
            <option value={category.id} key={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {categoryError ? (
          <p className="field-error" id="transaction-category-error">
            {categoryError}
          </p>
        ) : null}
      </div>
      <div className="field-group">
        <label htmlFor="transaction-memo">メモ（任意）</label>
        <textarea
          id="transaction-memo"
          name="memo"
          rows={3}
          maxLength={MEMO_MAX_LENGTH}
          value={values.memo}
          onChange={(event) => updateValue('memo', event.currentTarget.value)}
          aria-invalid={memoError ? true : undefined}
          aria-describedby={memoError ? 'transaction-memo-error' : undefined}
        />
        {memoError ? (
          <p className="field-error" id="transaction-memo-error">
            {memoError}
          </p>
        ) : null}
      </div>
      <SubmitButton label={submitLabel} />
    </form>
  );
}

export interface DeleteTransactionFormProps {
  transactionId: number;
}

export function DeleteTransactionForm({ transactionId }: DeleteTransactionFormProps) {
  const [state, formAction, pending] = useActionState<DeleteFormState, FormData>(
    deleteTransactionAction,
    {},
  );
  return (
    <form className="delete-form" action={formAction}>
      <input type="hidden" name="id" value={transactionId} />
      <label className="confirm-label">
        <input type="checkbox" name="confirm" value="yes" required />
        この取引を削除することを確認しました
      </label>
      <button className="button button-danger" type="submit" disabled={pending}>
        {pending ? '削除中…' : '削除する'}
      </button>
      {state.message ? (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
