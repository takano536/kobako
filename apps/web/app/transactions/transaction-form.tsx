'use client';

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { useFormStatus } from 'react-dom';

import {
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
import { DatePickerField } from './date-picker-field';
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
const FIELD_ORDER: Array<keyof TransactionFormValues> = [
  'type',
  'amount',
  'occurredOn',
  'categoryId',
  'memo',
];

function errorMessages(errors: TransactionFieldErrors | undefined): string[] {
  return FIELD_ORDER.flatMap((field) => errors?.[field] ?? []);
}

function FieldError({
  id,
  message,
}: {
  field: keyof TransactionFormValues;
  id: string;
  message: string;
}) {
  return (
    <span className="field-error sr-only" id={id} role="alert" aria-live="polite">
      {message}
    </span>
  );
}

function FormErrorDialog({
  dialogRef,
  dialogId,
  messages,
  open,
  onClose,
}: {
  dialogRef: { current: HTMLDialogElement | null };
  dialogId: string;
  messages: readonly string[];
  open: boolean;
  onClose: () => void;
}) {
  if (messages.length === 0) {
    return null;
  }
  return (
    <dialog
      ref={dialogRef}
      className="form-error-dialog"
      open={open}
      aria-labelledby={`${dialogId}-title`}
      onClose={onClose}
    >
      <h2 id={`${dialogId}-title`}>入力内容を確認してください</h2>
      <ul>
        {messages.map((message, index) => (
          <li key={`${message}-${index}`}>{message}</li>
        ))}
      </ul>
      <form method="dialog">
        <button className="button button-primary" type="submit">
          閉じる
        </button>
      </form>
    </dialog>
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

const MEMO_MAX_LINES = 5;

function resizeMemo(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto';
  const computedStyle = window.getComputedStyle(textarea);
  const fontSize = Number.parseFloat(computedStyle.fontSize) || 16;
  const lineHeight =
    computedStyle.lineHeight === 'normal'
      ? fontSize * 1.2
      : Number.parseFloat(computedStyle.lineHeight) || fontSize * 1.5;
  const padding =
    (Number.parseFloat(computedStyle.paddingTop) || 0) +
    (Number.parseFloat(computedStyle.paddingBottom) || 0);
  const borders =
    (Number.parseFloat(computedStyle.borderTopWidth) || 0) +
    (Number.parseFloat(computedStyle.borderBottomWidth) || 0);
  const minHeight = Number.parseFloat(computedStyle.minHeight) || 0;
  const fieldValue = textarea.parentElement;
  if (fieldValue) {
    fieldValue.dataset.memoMultiline = String(textarea.scrollHeight > minHeight + 0.5);
  }
  const maxHeight = lineHeight * MEMO_MAX_LINES + padding + borders;

  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
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
  const [hasHydrated, setHasHydrated] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const memoRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const modalOpenRef = useRef(false);
  const convertingDialogRef = useRef(false);
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

  useEffect(() => {
    const memo = memoRef.current;
    if (!memo) {
      return;
    }
    memo.dataset.autosize = 'true';
    resizeMemo(memo);
  }, [formValues.memo]);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  function focusFirstInvalidField(): void {
    const firstInvalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    firstInvalid?.focus();
  }

  function handleDialogClose(): void {
    modalOpenRef.current = false;
    if (convertingDialogRef.current) {
      return;
    }
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(focusFirstInvalidField);
    } else {
      focusFirstInvalidField();
    }
  }

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

  function handleMemoChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    const memo = event.currentTarget;
    memo.dataset.autosize = 'true';
    updateValue('memo', memo.value);
    resizeMemo(memo);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    const formData = new FormData(event.currentTarget);
    const submittedValues: TransactionFormValues = {
      type: String(formData.get('type') ?? ''),
      amount: String(formData.get('amount') ?? ''),
      occurredOn: String(formData.get('occurredOn') ?? ''),
      categoryId: String(formData.get('categoryId') ?? ''),
      memo: String(formData.get('memo') ?? ''),
    };
    const result = transactionInputSchema.safeParse(submittedValues);
    if (result.success) {
      setClientErrors(undefined);
      return;
    }
    event.preventDefault();
    setIsDirty(true);
    setValues(submittedValues);
    setClientErrors(flattenTransactionError(result.error).fieldErrors as TransactionFieldErrors);
  }

  const errors = pending ? undefined : (clientErrors ?? state.errors);
  const typeError = fieldError(errors, 'type');
  const amountError = fieldError(errors, 'amount');
  const occurredOnError = fieldError(errors, 'occurredOn');
  const categoryError = fieldError(errors, 'categoryId');
  const memoError = fieldError(errors, 'memo');
  const messages = errorMessages(errors);
  const dialogMessages =
    messages.length > 0 ? messages : !pending && state.message ? [state.message] : [];
  const hasDialogContent = dialogMessages.length > 0;
  const dialogKey = dialogMessages.join('\\u0000');

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (!hasDialogContent) {
      if (modalOpenRef.current && dialog.open) {
        modalOpenRef.current = false;
        dialog.close();
      }
      return;
    }
    if (modalOpenRef.current && dialog.open) {
      return;
    }
    if (dialog.open) {
      convertingDialogRef.current = true;
      dialog.close();
      convertingDialogRef.current = false;
    }
    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal();
        modalOpenRef.current = true;
      } catch {
        dialog.setAttribute('open', '');
      }
    } else {
      dialog.setAttribute('open', '');
    }
  }, [clientErrors, dialogKey, hasDialogContent, hasHydrated, state]);

  return (
    <>
      <FormErrorDialog
        dialogRef={dialogRef}
        dialogId="transaction-error-dialog"
        messages={dialogMessages}
        open={!hasHydrated && hasDialogContent}
        onClose={handleDialogClose}
      />
      <form
        ref={formRef}
        className="ledger-form"
        action={formAction}
        onSubmit={handleSubmit}
        noValidate
        aria-busy={pending}
      >
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
                aria-invalid={typeError ? true : undefined}
                aria-describedby={typeError ? 'transaction-type-error' : undefined}
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
                aria-invalid={typeError ? true : undefined}
                aria-describedby={typeError ? 'transaction-type-error' : undefined}
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
            <label id="transaction-date-label" htmlFor="transaction-date">
              日付
            </label>
            <div className={`field-value${occurredOnError ? ' has-error' : ''}`}>
              <DatePickerField
                id="transaction-date"
                name="occurredOn"
                kind="date"
                value={formValues.occurredOn}
                labelId="transaction-date-label"
                required
                ariaInvalid={Boolean(occurredOnError)}
                ariaDescribedBy={occurredOnError ? 'transaction-date-error' : undefined}
                onChange={(value) => updateValue('occurredOn', value)}
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
                ref={memoRef}
                id="transaction-memo"
                name="memo"
                rows={1}
                maxLength={MEMO_MAX_LENGTH}
                value={formValues.memo}
                onChange={handleMemoChange}
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
    </>
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
  const [hasHydrated, setHasHydrated] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const modalOpenRef = useRef(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const hasMessage = !pending && Boolean(state.message);
  useEffect(() => {
    if (!hasHydrated || !hasMessage) {
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog || modalOpenRef.current) {
      return;
    }
    if (dialog.open) {
      dialog.close();
    }
    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal();
        modalOpenRef.current = true;
      } catch {
        dialog.setAttribute('open', '');
      }
    } else {
      dialog.setAttribute('open', '');
    }
  }, [hasHydrated, hasMessage, state]);

  return (
    <>
      <FormErrorDialog
        dialogRef={dialogRef}
        dialogId="delete-error-dialog"
        messages={state.message ? [state.message] : []}
        open={!hasHydrated && hasMessage}
        onClose={() => {
          modalOpenRef.current = false;
        }}
      />
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
      </div>
    </>
  );
}
