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
    <>
      <button
        className="button button-primary save-button"
        type="submit"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? '保存中…' : label}
      </button>
      <span className="sr-only" aria-live="polite">
        {pending ? '保存中…' : ''}
      </span>
    </>
  );
}

export function TransactionForm({
  action,
  categories,
  initialValues,
  submitLabel,
}: TransactionFormProps) {
  const [state, formAction, pending] = useActionState(action, emptyTransactionFormState);
  const [values, setValues] = useState(initialValues);
  const [isDirty, setIsDirty] = useState(false);
  const [clientErrors, setClientErrors] = useState<TransactionFieldErrors>();
  const formValues = state.values && !isDirty ? state.values : values;
  const selectedType: TransactionType = formValues.type === 'income' ? 'income' : 'expense';
  const matchingCategories = categories.filter((category) => category.type === selectedType);

  useEffect(() => {
    if (state.values) {
      setValues(state.values);
      setIsDirty(false);
      setClientErrors(undefined);
    }
  }, [state.values]);

  function updateValue(field: keyof TransactionFormValues, value: string): void {
    setIsDirty(true);
    setValues((current) => ({
      ...current,
      [field]: value,
      ...(field === 'type' ? { categoryId: '' } : {}),
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    const result = transactionInputSchema.safeParse(formValues);
    if (result.success) {
      setClientErrors(undefined);
      return;
    }
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setIsDirty(true);
    setValues({
      type: String(formData.get('type') ?? ''),
      amount: String(formData.get('amount') ?? ''),
      occurredOn: String(formData.get('occurredOn') ?? ''),
      categoryId: String(formData.get('categoryId') ?? ''),
      memo: String(formData.get('memo') ?? ''),
    });
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
    <form
      className="ledger-form"
      action={formAction}
      onSubmit={handleSubmit}
      noValidate
      aria-busy={pending}
    >
      {summaryMessage ? (
        <p className="form-message" role="alert">
          <span aria-hidden="true">!</span> {summaryMessage}
        </p>
      ) : null}

      <fieldset
        className="type-field"
        aria-invalid={typeError ? true : undefined}
        aria-describedby={typeError ? 'transaction-type-error' : undefined}
      >
        <legend>種別</legend>
        <div className="type-options">
          <label className={selectedType === 'expense' ? 'type-choice selected' : 'type-choice'}>
            <input
              type="radio"
              name="type"
              value="expense"
              checked={formValues.type === 'expense'}
              onChange={(event) => updateValue('type', event.currentTarget.value)}
              required
            />
            <span>支出</span>
          </label>
          <label className={selectedType === 'income' ? 'type-choice selected' : 'type-choice'}>
            <input
              type="radio"
              name="type"
              value="income"
              checked={formValues.type === 'income'}
              onChange={(event) => updateValue('type', event.currentTarget.value)}
            />
            <span>収入</span>
          </label>
        </div>
        {typeError ? (
          <p className="field-error" id="transaction-type-error" role="alert">
            <span aria-hidden="true">!</span> {typeError}
          </p>
        ) : null}
      </fieldset>

      <div className="field amount-field">
        <label htmlFor="transaction-amount">金額</label>
        <div className="amount-line">
          <span aria-hidden="true">¥</span>
          <input
            id="transaction-amount"
            name="amount"
            type="text"
            inputMode="numeric"
            placeholder="0"
            value={formValues.amount}
            onChange={(event) => updateValue('amount', event.currentTarget.value)}
            aria-invalid={amountError ? true : undefined}
            aria-describedby={amountError ? 'transaction-amount-error' : undefined}
            required
          />
        </div>
        <p
          className="field-error"
          id="transaction-amount-error"
          role={amountError ? 'alert' : undefined}
          aria-live="polite"
        >
          {amountError ? (
            <>
              <span aria-hidden="true">!</span> {amountError}
            </>
          ) : null}
        </p>
      </div>

      <div className="entry-detail-grid">
        <div className="field category-field">
          <label htmlFor="transaction-category">カテゴリ</label>
          <select
            id="transaction-category"
            name="categoryId"
            value={formValues.categoryId}
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
          <p
            className="field-error"
            id="transaction-category-error"
            role={categoryError ? 'alert' : undefined}
            aria-live="polite"
          >
            {categoryError ? (
              <>
                <span aria-hidden="true">!</span> {categoryError}
              </>
            ) : null}
          </p>
        </div>

        <div className="field date-field">
          <label htmlFor="transaction-date">日付</label>
          <input
            id="transaction-date"
            name="occurredOn"
            type="date"
            value={formValues.occurredOn}
            onChange={(event) => updateValue('occurredOn', event.currentTarget.value)}
            aria-invalid={occurredOnError ? true : undefined}
            aria-describedby={occurredOnError ? 'transaction-date-error' : undefined}
            required
          />
          <p
            className="field-error"
            id="transaction-date-error"
            role={occurredOnError ? 'alert' : undefined}
            aria-live="polite"
          >
            {occurredOnError ? (
              <>
                <span aria-hidden="true">!</span> {occurredOnError}
              </>
            ) : null}
          </p>
        </div>

        <div className="field memo-field">
          <label htmlFor="transaction-memo">
            メモ（<span className="optional-label">任意</span>）
          </label>
          <textarea
            id="transaction-memo"
            name="memo"
            rows={1}
            maxLength={MEMO_MAX_LENGTH}
            value={formValues.memo}
            onChange={(event) => updateValue('memo', event.currentTarget.value)}
            aria-invalid={memoError ? true : undefined}
            aria-describedby={memoError ? 'transaction-memo-error' : undefined}
          />
          <p
            className="field-error"
            id="transaction-memo-error"
            role={memoError ? 'alert' : undefined}
            aria-live="polite"
          >
            {memoError ? (
              <>
                <span aria-hidden="true">!</span> {memoError}
              </>
            ) : null}
          </p>
        </div>
      </div>

      <SubmitButton label={submitLabel} />
    </form>
  );
}

export interface DeleteTransactionFormProps {
  transactionId: number;
  formId?: string;
}

export function DeleteTransactionForm({
  transactionId,
  formId = 'delete-transaction-form',
}: DeleteTransactionFormProps) {
  const [state, formAction, pending] = useActionState<DeleteFormState, FormData>(
    deleteTransactionAction,
    {},
  );
  return (
    <>
      <form id={formId} className="delete-form" action={formAction}>
        <input type="hidden" name="id" value={transactionId} />
      </form>
      <div className="delete-action">
        <button
          className="button button-danger"
          type="submit"
          form={formId}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? '削除中…' : '削除する'}
        </button>
        {state.message ? (
          <p className="field-error" role="alert">
            <span aria-hidden="true">!</span> {state.message}
          </p>
        ) : null}
      </div>
    </>
  );
}
