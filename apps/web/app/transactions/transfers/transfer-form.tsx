'use client';

import { useActionState, useEffect, useRef, useState, type FormEvent } from 'react';
import { useFormStatus } from 'react-dom';

import {
  AMOUNT_FORMAT_MESSAGE,
  AMOUNT_TEXT_PATTERN_SOURCE,
  MEMO_MAX_LENGTH,
  flattenTransferError,
  isAmountText,
  isAmountTextWhileEditing,
  transferInputSchema,
} from '@kobako/db/validation';

import { formatJapaneseDateWithYear, formatYen } from '../../../src/lib/format';
import {
  emptyTransferFormState,
  type DeleteTransferFormState,
  type TransferFieldErrors,
  type TransferFormState,
  type TransferFormValues,
} from '../../../src/lib/transfer-form';
import { DatePickerField } from '../date-picker-field';
import { deleteTransferAction } from './actions';

interface AccountOption {
  id: number;
  name: string;
}

export interface TransferFormProps {
  action: (previousState: TransferFormState, formData: FormData) => Promise<TransferFormState>;
  accounts: AccountOption[];
  initialValues: TransferFormValues;
  submitLabel: string;
}

function fieldError(
  errors: TransferFieldErrors | undefined,
  field: keyof TransferFormValues,
): string | undefined {
  return errors?.[field]?.[0];
}

const FIELD_ORDER: Array<keyof TransferFormValues> = [
  'fromAccountId',
  'toAccountId',
  'amount',
  'occurredOn',
  'memo',
];

function errorMessages(errors: TransferFieldErrors | undefined): string[] {
  return FIELD_ORDER.flatMap((field) => errors?.[field] ?? []);
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="button button-primary save-button"
      type="submit"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? '保存中…' : label}
    </button>
  );
}

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <span className="field-error sr-only" id={id} role="alert" aria-live="polite">
      {message}
    </span>
  );
}

export function TransferForm({ action, accounts, initialValues, submitLabel }: TransferFormProps) {
  const [state, formAction, pending] = useActionState(action, emptyTransferFormState);
  const [values, setValues] = useState(initialValues);
  const [isDirty, setIsDirty] = useState(false);
  const [clientErrors, setClientErrors] = useState<TransferFieldErrors>();
  const [amountInputError, setAmountInputError] = useState<string>();
  const formRef = useRef<HTMLFormElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const formValues = state.values && !isDirty ? state.values : values;
  const errors = pending ? undefined : (clientErrors ?? state.errors);

  useEffect(() => {
    if (!state.values) {
      return;
    }
    setValues(state.values);
    setIsDirty(false);
    setClientErrors(undefined);
    setAmountInputError(undefined);
  }, [state.values]);

  useEffect(() => {
    if (pending || (!clientErrors && !state.errors && !state.message)) {
      return;
    }
    const firstInvalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    (firstInvalid ?? errorSummaryRef.current)?.focus();
  }, [clientErrors, pending, state.errors, state.message]);

  function updateValue(field: keyof TransferFormValues, value: string): void {
    setIsDirty(true);
    setValues((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    const formData = new FormData(event.currentTarget);
    const submittedValues: TransferFormValues = {
      fromAccountId: String(formData.get('fromAccountId') ?? ''),
      toAccountId: String(formData.get('toAccountId') ?? ''),
      amount: String(formData.get('amount') ?? ''),
      occurredOn: String(formData.get('occurredOn') ?? ''),
      memo: String(formData.get('memo') ?? ''),
    };
    setAmountInputError(isAmountText(submittedValues.amount) ? undefined : AMOUNT_FORMAT_MESSAGE);
    const result = transferInputSchema.safeParse(submittedValues);
    if (result.success) {
      setClientErrors(undefined);
      return;
    }
    event.preventDefault();
    setIsDirty(true);
    setValues(submittedValues);
    setClientErrors(flattenTransferError(result.error).fieldErrors as TransferFieldErrors);
  }

  const fromError = fieldError(errors, 'fromAccountId');
  const toError = fieldError(errors, 'toAccountId');
  const amountError = fieldError(errors, 'amount');
  const occurredOnError = fieldError(errors, 'occurredOn');
  const memoError = fieldError(errors, 'memo');
  const amountInvalid = Boolean(amountInputError || amountError);
  const messages = errorMessages(errors);

  return (
    <>
      {messages.length > 0 || (!pending && state.message) ? (
        <div
          ref={errorSummaryRef}
          className="transfer-form-errors"
          role="alert"
          aria-live="polite"
          tabIndex={-1}
        >
          <p>{state.message ?? '入力内容を確認してください。'}</p>
          {messages.length > 0 ? (
            <ul>
              {messages.map((message, index) => (
                <li key={`${message}-${index}`}>{message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <form
        ref={formRef}
        className="ledger-form transfer-form"
        action={formAction}
        onSubmit={handleSubmit}
        noValidate
        aria-busy={pending}
      >
        <div className={`entry-detail-grid${fromError ? ' has-error' : ''}`}>
          <div className={`field transfer-account-field${fromError ? ' has-error' : ''}`}>
            <label htmlFor="transfer-from-account">振替元</label>
            <div className="field-value">
              <select
                id="transfer-from-account"
                name="fromAccountId"
                value={formValues.fromAccountId}
                onChange={(event) => updateValue('fromAccountId', event.currentTarget.value)}
                aria-invalid={fromError ? true : undefined}
                aria-describedby={fromError ? 'transfer-from-account-error' : undefined}
                required
              >
                <option value="">選択してください</option>
                {accounts.map((account) => (
                  <option value={account.id} key={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
              {fromError ? (
                <FieldError id="transfer-from-account-error" message={fromError} />
              ) : null}
            </div>
          </div>
          <div className={`field transfer-account-field${toError ? ' has-error' : ''}`}>
            <label htmlFor="transfer-to-account">振替先</label>
            <div className="field-value">
              <select
                id="transfer-to-account"
                name="toAccountId"
                value={formValues.toAccountId}
                onChange={(event) => updateValue('toAccountId', event.currentTarget.value)}
                aria-invalid={toError ? true : undefined}
                aria-describedby={toError ? 'transfer-to-account-error' : undefined}
                required
              >
                <option value="">選択してください</option>
                {accounts.map((account) => (
                  <option value={account.id} key={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
              {toError ? <FieldError id="transfer-to-account-error" message={toError} /> : null}
            </div>
          </div>
        </div>

        <div className={`field amount-field${amountInvalid ? ' has-error' : ''}`}>
          <label htmlFor="transfer-amount">金額</label>
          <div className="amount-line">
            <span aria-hidden="true">¥</span>
            <div className="field-value">
              <input
                id="transfer-amount"
                name="amount"
                type="text"
                inputMode="text"
                pattern={AMOUNT_TEXT_PATTERN_SOURCE}
                placeholder="0"
                value={formValues.amount}
                onChange={(event) => {
                  const nextValue = event.currentTarget.value;
                  if (!isAmountTextWhileEditing(nextValue)) {
                    setAmountInputError(AMOUNT_FORMAT_MESSAGE);
                    return;
                  }
                  setAmountInputError(undefined);
                  updateValue('amount', nextValue);
                }}
                aria-invalid={amountInvalid ? true : undefined}
                aria-describedby={
                  [
                    amountError ? 'transfer-amount-error' : '',
                    amountInputError ? 'transfer-amount-format-error' : '',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                required
              />
              {amountInputError ? (
                <span
                  className="field-error amount-input-error"
                  id="transfer-amount-format-error"
                  role="alert"
                >
                  {amountInputError}
                </span>
              ) : null}
              {amountError ? <FieldError id="transfer-amount-error" message={amountError} /> : null}
            </div>
          </div>
        </div>

        <div className="entry-detail-grid">
          <div className={`field date-field${occurredOnError ? ' has-error' : ''}`}>
            <label id="transfer-date-label" htmlFor="transfer-date">
              日付
            </label>
            <div className="field-value">
              <DatePickerField
                id="transfer-date"
                name="occurredOn"
                kind="date"
                value={formValues.occurredOn}
                labelId="transfer-date-label"
                required
                ariaInvalid={Boolean(occurredOnError)}
                ariaDescribedBy={occurredOnError ? 'transfer-date-error' : undefined}
                onChange={(value) => updateValue('occurredOn', value)}
              />
              {occurredOnError ? (
                <FieldError id="transfer-date-error" message={occurredOnError} />
              ) : null}
            </div>
          </div>
          <div className={`field memo-field${memoError ? ' has-error' : ''}`}>
            <label htmlFor="transfer-memo">
              メモ（<span className="optional-label">任意</span>）
            </label>
            <div className="field-value">
              <textarea
                id="transfer-memo"
                name="memo"
                rows={1}
                maxLength={MEMO_MAX_LENGTH}
                value={formValues.memo}
                onChange={(event) => updateValue('memo', event.currentTarget.value)}
                aria-invalid={memoError ? true : undefined}
                aria-describedby={memoError ? 'transfer-memo-error' : undefined}
              />
              {memoError ? <FieldError id="transfer-memo-error" message={memoError} /> : null}
            </div>
          </div>
        </div>

        <SubmitButton label={submitLabel} />
      </form>
    </>
  );
}

export interface DeleteTransferFormProps {
  transferId: number;
  fromAccountName: string;
  toAccountName: string;
  amount: number;
  occurredOn: string;
}

function DeleteTransferSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button button-danger" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? '削除中…' : '削除を確定'}
    </button>
  );
}

export function DeleteTransferForm({
  transferId,
  fromAccountName,
  toAccountName,
  amount,
  occurredOn,
}: DeleteTransferFormProps) {
  const [state, formAction, pending] = useActionState<DeleteTransferFormState, FormData>(
    deleteTransferAction,
    {},
  );
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!pending && state.message) {
      errorRef.current?.focus();
    }
  }, [pending, state.message]);
  return (
    <div className="delete-action">
      {state.message && !pending ? (
        <p ref={errorRef} className="field-error" role="alert" tabIndex={-1}>
          {state.message}
        </p>
      ) : null}
      <details className="delete-confirm">
        <summary className="button button-danger">削除する</summary>
        <div className="delete-confirmation">
          <p>次の振替を削除しますか？</p>
          <p>
            {fromAccountName} → {toAccountName}
            <br />
            {formatJapaneseDateWithYear(occurredOn)}・{formatYen(amount)}
          </p>
          <form className="delete-form delete-confirm-form" action={formAction}>
            <input type="hidden" name="id" value={transferId} />
            <input type="hidden" name="confirm" value="delete" />
            <DeleteTransferSubmitButton />
            <a className="delete-cancel" href={`/transactions/transfers/${transferId}/edit`}>
              キャンセル
            </a>
          </form>
        </div>
      </details>
    </div>
  );
}
