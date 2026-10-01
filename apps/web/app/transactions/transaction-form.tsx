'use client';
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
} from 'react';
import { useFormStatus } from 'react-dom';

import {
  AMOUNT_FORMAT_MESSAGE,
  AMOUNT_TEXT_PATTERN_SOURCE,
  MEMO_MAX_LENGTH,
  flattenTransactionError,
  flattenTransferError,
  isAmountText,
  isAmountTextWhileEditing,
  transactionInputSchema,
  transferInputSchema,
} from '@kobako/db/validation';
import {
  emptyTransactionFormState,
  firstTransactionFieldError,
  switchTransactionType,
  transactionFormValuesFromFormData,
  type DeleteFormState,
  type TransactionFieldErrors,
  type TransactionFormState,
  type TransactionFormType,
  type TransactionFormValues,
} from '../../src/lib/transaction-form';
import { DatePickerField } from './date-picker-field';
import { deleteTransactionAction } from './actions';

type CategoryOption = {
  id: number;
  type: 'expense' | 'income';
  name: string;
};

type AccountOption = {
  id: number;
  name: string;
};

export interface TransactionFormProps {
  action: (
    previousState: TransactionFormState,
    formData: FormData,
  ) => Promise<TransactionFormState>;
  categories: CategoryOption[];
  accounts: AccountOption[];
  initialValues: TransactionFormValues;
  submitLabel: string;
}

const FIELD_ORDER: Array<keyof TransactionFormValues> = [
  'type',
  'amount',
  'fromAccountId',
  'toAccountId',
  'occurredOn',
  'categoryId',
  'memo',
];

function errorMessages(errors: TransactionFieldErrors | undefined): string[] {
  return FIELD_ORDER.flatMap((field) => errors?.[field] ?? []);
}

function FieldError({ id, message }: { id: string; message: string }) {
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

function SubmitButton({ label, disabled = false }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <>
      <button
        className="button button-primary save-button"
        type="submit"
        disabled={pending || disabled}
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

function typeLabel(type: TransactionFormType): string {
  if (type === 'income') {
    return '収入';
  }
  if (type === 'transfer') {
    return '振替';
  }
  return '支出';
}

export function TransactionForm({
  action,
  categories,
  accounts,
  initialValues,
  submitLabel,
}: TransactionFormProps) {
  const [state, formAction, pending] = useActionState(action, emptyTransactionFormState);
  const [values, setValues] = useState(initialValues);
  const [isDirty, setIsDirty] = useState(false);
  const [clientErrors, setClientErrors] = useState<TransactionFieldErrors>();
  const [amountInputError, setAmountInputError] = useState<string>();
  const [amountInputErrorKey, setAmountInputErrorKey] = useState(0);
  const [hasHydrated, setHasHydrated] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const memoRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const modalOpenRef = useRef(false);
  const convertingDialogRef = useRef(false);
  const formValues = state.values && !isDirty ? state.values : values;
  const selectedType: TransactionFormType =
    formValues.type === 'income' || formValues.type === 'transfer' ? formValues.type : 'expense';

  useEffect(() => {
    if (state.values) {
      setValues(state.values);
      setIsDirty(false);
      setClientErrors(undefined);
      setAmountInputError(undefined);
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
    setValues((current) => {
      if (field !== 'type') {
        return { ...current, [field]: value };
      }
      return switchTransactionType(current, value as TransactionFormType, categories);
    });
  }

  function handleAmountChange(event: ChangeEvent<HTMLInputElement>): void {
    const nextValue = event.currentTarget.value;
    if (!isAmountTextWhileEditing(nextValue)) {
      setAmountInputError(AMOUNT_FORMAT_MESSAGE);
      setAmountInputErrorKey((current) => current + 1);
      return;
    }
    setAmountInputError(undefined);
    updateValue('amount', nextValue);
  }

  function handleMemoChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    const memo = event.currentTarget;
    memo.dataset.autosize = 'true';
    updateValue('memo', memo.value);
    resizeMemo(memo);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    const submittedValues = transactionFormValuesFromFormData(new FormData(event.currentTarget));
    const completeAmount = isAmountText(submittedValues.amount);
    setAmountInputError(completeAmount ? undefined : AMOUNT_FORMAT_MESSAGE);
    if (submittedValues.type === 'transfer') {
      const result = transferInputSchema.safeParse({
        fromAccountId: submittedValues.fromAccountId,
        toAccountId: submittedValues.toAccountId,
        amount: submittedValues.amount,
        occurredOn: submittedValues.occurredOn,
        memo: submittedValues.memo,
      });
      if (result.success) {
        setClientErrors(undefined);
        return;
      }
      event.preventDefault();
      setIsDirty(true);
      setValues(submittedValues);
      setClientErrors(flattenTransferError(result.error).fieldErrors as TransactionFieldErrors);
      return;
    }
    const result = transactionInputSchema.safeParse({
      type: submittedValues.type,
      amount: submittedValues.amount,
      occurredOn: submittedValues.occurredOn,
      categoryId: submittedValues.categoryId,
      memo: submittedValues.memo,
    });
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
  const typeError = firstTransactionFieldError(errors, 'type');
  const amountError = firstTransactionFieldError(errors, 'amount');
  const amountInvalid = Boolean(amountError || amountInputError);
  const amountDescribedBy =
    [
      amountError ? 'transaction-amount-error' : '',
      amountInputError ? 'transaction-amount-format-error' : '',
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  const fromAccountError = firstTransactionFieldError(errors, 'fromAccountId');
  const toAccountError = firstTransactionFieldError(errors, 'toAccountId');
  const occurredOnError = firstTransactionFieldError(errors, 'occurredOn');
  const categoryError = firstTransactionFieldError(errors, 'categoryId');
  const memoError = firstTransactionFieldError(errors, 'memo');
  const messages = errorMessages(errors);
  const dialogMessages =
    messages.length > 0 ? messages : !pending && state.message ? [state.message] : [];
  const hasDialogContent = dialogMessages.length > 0;
  const dialogKey = dialogMessages.join('\u0000');

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
            {(['expense', 'income', 'transfer'] as const).map((type) => (
              <label
                className={selectedType === type ? 'type-choice selected' : 'type-choice'}
                key={type}
              >
                <input
                  type="radio"
                  name="type"
                  value={type}
                  checked={formValues.type === type}
                  onChange={(event) => updateValue('type', event.currentTarget.value)}
                  aria-invalid={typeError ? true : undefined}
                  aria-describedby={typeError ? 'transaction-type-error' : undefined}
                  required={type === 'expense'}
                />
                <span>{typeLabel(type)}</span>
              </label>
            ))}
            {typeError ? <FieldError id="transaction-type-error" message={typeError} /> : null}
          </div>
        </fieldset>

        <div className={`field amount-field${amountInvalid ? ' has-error' : ''}`}>
          <label htmlFor="transaction-amount">金額</label>
          <div className="amount-line">
            <span aria-hidden="true">¥</span>
            <div className={`field-value${amountInvalid ? ' has-error' : ''}`}>
              <input
                id="transaction-amount"
                name="amount"
                type="text"
                inputMode="text"
                pattern={AMOUNT_TEXT_PATTERN_SOURCE}
                placeholder="0"
                value={formValues.amount}
                onChange={handleAmountChange}
                aria-invalid={amountInvalid ? true : undefined}
                aria-describedby={amountDescribedBy}
                required
              />
              {amountInputError ? (
                <span
                  key={amountInputErrorKey}
                  className="field-error amount-input-error"
                  id="transaction-amount-format-error"
                  role="alert"
                >
                  {amountInputError}
                </span>
              ) : null}
              {amountError ? (
                <FieldError id="transaction-amount-error" message={amountError} />
              ) : null}
            </div>
          </div>
        </div>

        <div className="entry-detail-grid category-detail-grid">
          {(['expense', 'income'] as const).map((categoryType) => {
            const categoryErrorId = `transaction-category-${categoryType}-error`;
            return (
              <div
                className={`field category-field category-field-${categoryType}${
                  categoryError ? ' has-error' : ''
                }`}
                key={categoryType}
              >
                <label htmlFor={`transaction-category-${categoryType}`}>カテゴリ</label>
                <div className={`field-value${categoryError ? ' has-error' : ''}`}>
                  <select
                    className="field-select"
                    id={`transaction-category-${categoryType}`}
                    name="categoryId"
                    value={formValues.categoryId}
                    onChange={(event) => updateValue('categoryId', event.currentTarget.value)}
                    aria-invalid={categoryError ? true : undefined}
                    aria-describedby={categoryError ? categoryErrorId : undefined}
                    required
                  >
                    <option value="">選択してください</option>
                    {categories
                      .filter((category) => category.type === categoryType)
                      .map((category) => (
                        <option value={category.id} key={category.id}>
                          {category.name}
                        </option>
                      ))}
                  </select>
                  {categoryError ? (
                    <FieldError id={categoryErrorId} message={categoryError} />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="entry-detail-grid account-detail-grid">
          <div className={`field account-field${fromAccountError ? ' has-error' : ''}`}>
            <label htmlFor="transaction-from-account">振替元</label>
            <div className={`field-value${fromAccountError ? ' has-error' : ''}`}>
              <select
                className="field-select"
                id="transaction-from-account"
                name="fromAccountId"
                value={formValues.fromAccountId}
                onChange={(event) => updateValue('fromAccountId', event.currentTarget.value)}
                aria-invalid={fromAccountError ? true : undefined}
                aria-describedby={fromAccountError ? 'transaction-from-account-error' : undefined}
                required
              >
                <option value="">選択してください</option>
                {accounts.map((account) => (
                  <option value={account.id} key={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
              {fromAccountError ? (
                <FieldError id="transaction-from-account-error" message={fromAccountError} />
              ) : null}
            </div>
          </div>
          <div className={`field account-field${toAccountError ? ' has-error' : ''}`}>
            <label htmlFor="transaction-to-account">振替先</label>
            <div className={`field-value${toAccountError ? ' has-error' : ''}`}>
              <select
                className="field-select"
                id="transaction-to-account"
                name="toAccountId"
                value={formValues.toAccountId}
                onChange={(event) => updateValue('toAccountId', event.currentTarget.value)}
                aria-invalid={toAccountError ? true : undefined}
                aria-describedby={toAccountError ? 'transaction-to-account-error' : undefined}
                required
              >
                <option value="">選択してください</option>
                {accounts.map((account) => (
                  <option value={account.id} key={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
              {toAccountError ? (
                <FieldError id="transaction-to-account-error" message={toAccountError} />
              ) : null}
            </div>
          </div>
        </div>

        <div className="entry-detail-grid">
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
                <FieldError id="transaction-date-error" message={occurredOnError} />
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
              {memoError ? <FieldError id="transaction-memo-error" message={memoError} /> : null}
            </div>
          </div>
        </div>

        <div className="save-button-options">
          <span className="save-button-ordinary">
            <SubmitButton label={submitLabel} />
          </span>
          <span className="save-button-transfer">
            <SubmitButton label={submitLabel} />
          </span>
        </div>
      </form>
    </>
  );
}

export interface DeleteTransactionFormProps {
  transactionId: number;
  entryType?: 'transaction' | 'transfer';
  formId?: string;
}

export function DeleteTransactionForm({
  transactionId,
  entryType = 'transaction',
  formId = 'delete-transaction-form',
}: DeleteTransactionFormProps) {
  const [state, formAction, pending] = useActionState<DeleteFormState, FormData>(
    deleteTransactionAction.bind(null, entryType),
    {},
  );
  const [hasHydrated, setHasHydrated] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const modalOpenRef = useRef(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const wasDeleteConfirmOpenRef = useRef(false);
  const bodyOverflowRef = useRef<string | null>(null);
  const htmlOverflowRef = useRef<string | null>(null);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    const details = detailsRef.current;
    if (!details) {
      return;
    }
    const handleToggle = () => {
      setIsDeleteConfirmOpen(details.open);
    };
    handleToggle();
    details.addEventListener('toggle', handleToggle);
    return () => details.removeEventListener('toggle', handleToggle);
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

  const closeDeleteConfirm = useCallback(() => {
    detailsRef.current?.removeAttribute('open');
    setIsDeleteConfirmOpen(false);
    summaryRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!hasHydrated || !isDeleteConfirmOpen) {
      if (hasHydrated && wasDeleteConfirmOpenRef.current) {
        wasDeleteConfirmOpenRef.current = false;
        summaryRef.current?.focus();
      }
      return;
    }

    wasDeleteConfirmOpenRef.current = true;
    bodyOverflowRef.current = document.body.style.overflow;
    htmlOverflowRef.current = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    const dialog = detailsRef.current?.querySelector<HTMLElement>('.delete-confirmation');
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDeleteConfirm();
        return;
      }
      if (event.key !== 'Tab' || !dialog) {
        return;
      }

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable.at(0);
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    confirmButtonRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = bodyOverflowRef.current ?? '';
      document.documentElement.style.overflow = htmlOverflowRef.current ?? '';
      bodyOverflowRef.current = null;
      htmlOverflowRef.current = null;
    };
  }, [closeDeleteConfirm, hasHydrated, isDeleteConfirmOpen]);

  const editPath =
    entryType === 'transfer'
      ? `/transactions/transfers/${transactionId}/edit`
      : `/transactions/${transactionId}/edit`;

  function handleCancel(event: MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault();
    closeDeleteConfirm();
  }

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
      <div className="delete-action">
        <details ref={detailsRef} className="delete-confirm">
          <summary ref={summaryRef} className="button button-danger">
            削除する
          </summary>
          <button
            className="delete-modal-backdrop"
            type="button"
            tabIndex={-1}
            aria-label="削除確認を閉じる"
            onClick={closeDeleteConfirm}
          />
          <div
            className="delete-confirmation"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${formId}-title`}
          >
            <p id={`${formId}-title`}>この取引を削除しますか？</p>
            <form id={formId} className="delete-form delete-confirm-form" action={formAction}>
              <input type="hidden" name="id" value={transactionId} />

              <input type="hidden" name="confirm" value="delete" />
              <button
                ref={confirmButtonRef}
                className="button button-danger"
                type="submit"
                disabled={pending}
                aria-busy={pending}
              >
                {pending ? '削除中…' : '削除を確定'}
              </button>
              <a className="delete-cancel" href={editPath} onClick={handleCancel}>
                キャンセル
              </a>
            </form>
          </div>
        </details>
      </div>
    </>
  );
}
