'use client';

import { useActionState, useEffect, useState, type FormEvent } from 'react';
import { useFormStatus } from 'react-dom';

import {
  MEMO_MAX_LENGTH,
  flattenTransactionError,
  transactionInputSchema,
} from '@kobako/db/validation';

import { CategoryIcon } from '../../src/lib/category';
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
    <div className="form-submit">
      <button
        className="button button-primary"
        type="submit"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? '保存中…' : label}
      </button>
      <span className="sr-only" aria-live="polite">
        {pending ? '保存中…' : ''}
      </span>
    </div>
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
  const [clientErrors, setClientErrors] = useState<TransactionFieldErrors>();
  const selectedType: TransactionType = values.type === 'income' ? 'income' : 'expense';
  const matchingCategories = categories.filter((category) => category.type === selectedType);
  const selectedCategory = matchingCategories.find(
    (category) => String(category.id) === values.categoryId,
  );

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
        className="field-group type-fieldset"
        aria-invalid={typeError ? true : undefined}
        aria-describedby={typeError ? 'transaction-type-error' : undefined}
      >
        <legend>種別</legend>
        <div className="type-options">
          <label className={selectedType === 'expense' ? 'type-option selected' : 'type-option'}>
            <input
              type="radio"
              name="type"
              value="expense"
              checked={values.type === 'expense'}
              onChange={(event) => updateValue('type', event.currentTarget.value)}
              required
            />
            <span>支出</span>
          </label>
          <label className={selectedType === 'income' ? 'type-option selected' : 'type-option'}>
            <input
              type="radio"
              name="type"
              value="income"
              checked={values.type === 'income'}
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

      <div className="field-group amount-field">
        <label htmlFor="transaction-amount">金額（円）</label>
        <div className="amount-input">
          <span aria-hidden="true">¥</span>
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
        </div>
        {amountError ? (
          <p className="field-error" id="transaction-amount-error" role="alert">
            <span aria-hidden="true">!</span> {amountError}
          </p>
        ) : null}
      </div>

      <div className="field-group category-field">
        <label htmlFor="transaction-category">カテゴリ</label>
        <div className="category-select-wrap">
          {selectedCategory ? (
            <CategoryIcon type={selectedCategory.type} name={selectedCategory.name} size="medium" />
          ) : null}
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
        </div>
        {categoryError ? (
          <p className="field-error" id="transaction-category-error" role="alert">
            <span aria-hidden="true">!</span> {categoryError}
          </p>
        ) : null}
      </div>

      <div className="field-group date-field">
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
          <p className="field-error" id="transaction-date-error" role="alert">
            <span aria-hidden="true">!</span> {occurredOnError}
          </p>
        ) : null}
      </div>

      <div className="field-group memo-field">
        <label htmlFor="transaction-memo">
          メモ（<span className="optional-label">任意</span>）
        </label>
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
          <p className="field-error" id="transaction-memo-error" role="alert">
            <span aria-hidden="true">!</span> {memoError}
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
      <button className="button button-danger" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? '削除中…' : '削除する'}
      </button>
      {state.message ? (
        <p className="field-error" role="alert">
          <span aria-hidden="true">!</span> {state.message}
        </p>
      ) : null}
    </form>
  );
}
