'use client';

import { useActionState, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useFormStatus } from 'react-dom';

import {
  AMOUNT_LIMIT,
  MEMO_MAX_LENGTH,
  flattenTransactionError,
  transactionInputSchema,
} from '@kobako/db/validation';

import { sanitizeAmountTextWithCaret } from '../../src/lib/transaction-form';
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

function shortFieldError(field: keyof TransactionFormValues, message: string): string {
  switch (field) {
    case 'type':
      return '種別を選択';
    case 'amount':
      if (message.includes('整数')) {
        return '整数で入力';
      }
      if (message.includes('以上')) {
        return `下限は-${AMOUNT_LIMIT.toLocaleString('ja-JP')}円`;
      }
      if (message.includes('以下')) {
        return `上限は${AMOUNT_LIMIT.toLocaleString('ja-JP')}円`;
      }
      return '入力してください';
    case 'occurredOn':
      return message.includes('入力') ? '入力してください' : '日付を確認';
    case 'categoryId':
      return message.includes('種別') ? 'カテゴリを確認' : 'カテゴリを選択';
    case 'memo':
      return message.includes('文字') ? `メモは${MEMO_MAX_LENGTH}文字以内` : 'メモを確認';
  }
}

function FieldError({
  field,
  id,
  message,
}: {
  field: keyof TransactionFormValues;
  id: string;
  message: string;
}) {
  return (
    <span className="field-error" id={id} role="alert" aria-live="polite" title={message}>
      <span aria-hidden="true">! {shortFieldError(field, message)}</span>
      <span className="sr-only">{message}</span>
    </span>
  );
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

  function handleAmountChange(event: ChangeEvent<HTMLInputElement>): void {
    const input = event.currentTarget;
    const caret = input.selectionStart ?? input.value.length;
    const sanitized = sanitizeAmountTextWithCaret(input.value, caret);
    updateValue('amount', sanitized.value);
    if (sanitized.value !== input.value && typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        const current = document.getElementById('transaction-amount') as HTMLInputElement | null;
        if (current && current === document.activeElement) {
          current.setSelectionRange(sanitized.caret, sanitized.caret);
        }
      });
    }
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
  const summaryMessage = clientErrors || state.errors ? undefined : state.message;

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
        className={`type-field${typeError ? ' has-error' : ''}`}
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
          {typeError ? (
            <FieldError field="type" id="transaction-type-error" message={typeError} />
          ) : null}
        </div>
      </fieldset>

      <div className={`field amount-field${amountError ? ' has-error' : ''}`}>
        <label htmlFor="transaction-amount">金額</label>
        <div className="amount-line">
          <span aria-hidden="true">¥</span>
          <div className={`field-value${amountError ? ' has-error' : ''}`}>
            <input
              id="transaction-amount"
              name="amount"
              type="text"
              inputMode="text"
              pattern="-?[0-9]+"
              placeholder="0"
              value={formValues.amount}
              onChange={handleAmountChange}
              aria-invalid={amountError ? true : undefined}
              aria-describedby={amountError ? 'transaction-amount-error' : undefined}
              required
            />
            {amountError ? (
              <FieldError field="amount" id="transaction-amount-error" message={amountError} />
            ) : null}
          </div>
        </div>
      </div>

      <div className="entry-detail-grid">
        <div className={`field category-field${categoryError ? ' has-error' : ''}`}>
          <label htmlFor="transaction-category">カテゴリ</label>
          <div className={`field-value${categoryError ? ' has-error' : ''}`}>
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
            {categoryError ? (
              <FieldError
                field="categoryId"
                id="transaction-category-error"
                message={categoryError}
              />
            ) : null}
          </div>
        </div>

        <div className={`field date-field${occurredOnError ? ' has-error' : ''}`}>
          <label htmlFor="transaction-date">日付</label>
          <div className={`field-value${occurredOnError ? ' has-error' : ''}`}>
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
            {occurredOnError ? (
              <FieldError
                field="occurredOn"
                id="transaction-date-error"
                message={occurredOnError}
              />
            ) : null}
          </div>
        </div>

        <div className={`field memo-field${memoError ? ' has-error' : ''}`}>
          <label htmlFor="transaction-memo">
            メモ（<span className="optional-label">任意</span>）
          </label>
          <div className={`field-value${memoError ? ' has-error' : ''}`}>
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
            {memoError ? (
              <FieldError field="memo" id="transaction-memo-error" message={memoError} />
            ) : null}
          </div>
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
