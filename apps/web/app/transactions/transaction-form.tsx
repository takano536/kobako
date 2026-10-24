'use client';

import formsStyles from '../forms.module.css';
import primitiveStyles from '../_components/button.module.css';
import {
  useActionState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useFormStatus } from 'react-dom';

import { useRouter } from 'next/navigation';

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
import { Button } from '../_components/button';
import { prefersTouchInput } from '../_components/overlay-card';
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
  status: 'active' | 'closed';
  deletedAt: Date | null;
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
  showCancel?: boolean;
}

const FIELD_ORDER: Array<keyof TransactionFormValues> = [
  'type',
  'amount',
  'accountId',
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
    <span
      className={[formsStyles['field-error'], 'sr-only'].join(' ')}
      id={id}
      role="alert"
      aria-live="polite"
    >
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
      className={formsStyles['form-error-dialog']}
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
        <Button variant="primary" type="submit">
          閉じる
        </Button>
      </form>
    </dialog>
  );
}

function SubmitButton({ label, disabled = false }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <>
      <Button
        variant="primary"
        className={formsStyles['save-button']}
        type="submit"
        disabled={pending || disabled}
        aria-busy={pending}
      >
        {pending ? '保存中…' : label}
      </Button>
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
  showCancel = false,
}: TransactionFormProps) {
  const router = useRouter();
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
  const submitGuardRef = useRef(false);
  const formValues = state.values && !isDirty ? state.values : values;
  const selectedType: TransactionFormType =
    formValues.type === 'income' || formValues.type === 'transfer' ? formValues.type : 'expense';
  const linkedFromAccountId = Number(formValues.fromAccountId);
  const linkedToAccountId = Number(formValues.toAccountId);
  const transferAccounts = accounts.filter(
    (account) =>
      account.deletedAt === null ||
      account.id === linkedFromAccountId ||
      account.id === linkedToAccountId,
  );
  const normalAccounts = accounts.filter(
    (account) => account.deletedAt === null || account.id === Number(formValues.accountId),
  );

  useEffect(() => {
    if (state.values) {
      setValues(state.values);
      setIsDirty(false);
      setClientErrors(undefined);
      setAmountInputError(undefined);
    }
  }, [state.values]);

  useEffect(() => {
    if (!pending) {
      submitGuardRef.current = false;
    }
  }, [pending]);

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

  useLayoutEffect(() => {
    if (!hasHydrated) return;
    // タッチ端末ではソフトキーボードを開かないよう、カード表示時に金額欄へフォーカスしません。
    if (prefersTouchInput()) return;
    const overlay = formRef.current?.closest('[data-card-pattern="overlay-card"]');
    overlay?.querySelector<HTMLElement>('#transaction-amount')?.focus();
  }, [hasHydrated]);

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
    if (pending || submitGuardRef.current) {
      event.preventDefault();
      return;
    }
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
        submitGuardRef.current = true;
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
      accountId: submittedValues.accountId,
      memo: submittedValues.memo,
    });
    if (result.success) {
      setClientErrors(undefined);
      submitGuardRef.current = true;
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
  const accountError = firstTransactionFieldError(errors, 'accountId');
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
        className={formsStyles['ledger-form']}
        action={formAction}
        onSubmit={handleSubmit}
        noValidate
        aria-busy={pending}
      >
        <fieldset
          className={[formsStyles['type-field'], typeError && formsStyles['has-error']]
            .filter(Boolean)
            .join(' ')}
          aria-invalid={typeError ? true : undefined}
          aria-describedby={typeError ? 'transaction-type-error' : undefined}
        >
          <legend>種別</legend>
          <div className={formsStyles['type-options']}>
            {(['expense', 'income', 'transfer'] as const).map((type) => (
              <label
                data-slot="type-choice"
                className={[
                  formsStyles['type-choice'],
                  selectedType === type ? formsStyles.selected : undefined,
                ]
                  .filter(Boolean)
                  .join(' ')}
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

        <div
          data-slot="amount-field"
          className={[
            formsStyles.field,
            formsStyles['amount-field'],
            amountInvalid && formsStyles['has-error'],
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <label htmlFor="transaction-amount">金額</label>
          <div className={formsStyles['amount-line']}>
            <span aria-hidden="true">¥</span>
            <div
              data-slot="amount-field-value"
              className={[formsStyles['field-value'], amountInvalid && formsStyles['has-error']]
                .filter(Boolean)
                .join(' ')}
            >
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
                  className={[formsStyles['field-error'], formsStyles['amount-input-error']].join(
                    ' ',
                  )}
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

        <div
          className={[formsStyles['entry-detail-grid'], formsStyles['category-detail-grid']].join(
            ' ',
          )}
        >
          {(['expense', 'income'] as const).map((categoryType) => {
            const categoryErrorId = `transaction-category-${categoryType}-error`;
            return (
              <div
                data-slot={`category-field-${categoryType}`}
                className={[
                  formsStyles.field,
                  formsStyles['category-field'],
                  formsStyles[`category-field-${categoryType}`],
                  categoryError && formsStyles['has-error'],
                ]
                  .filter(Boolean)
                  .join(' ')}
                key={categoryType}
              >
                <label htmlFor={`transaction-category-${categoryType}`}>カテゴリ</label>
                <div
                  data-slot={`category-field-value-${categoryType}`}
                  className={[formsStyles['field-value'], categoryError && formsStyles['has-error']]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <select
                    className={formsStyles['field-select']}
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

        <div
          id="transaction-transfer-accounts"
          data-slot="transfer-account-detail"
          className={[
            formsStyles['entry-detail-grid'],
            formsStyles['account-detail-grid'],
            formsStyles['transfer-account-detail-grid'],
          ].join(' ')}
        >
          <div
            className={[
              formsStyles.field,
              formsStyles['account-field'],
              fromAccountError && formsStyles['has-error'],
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <label htmlFor="transaction-from-account">振替元</label>
            <div
              className={[formsStyles['field-value'], fromAccountError && formsStyles['has-error']]
                .filter(Boolean)
                .join(' ')}
            >
              <select
                className={formsStyles['field-select']}
                id="transaction-from-account"
                name="fromAccountId"
                value={formValues.fromAccountId}
                onChange={(event) => updateValue('fromAccountId', event.currentTarget.value)}
                aria-invalid={fromAccountError ? true : undefined}
                aria-describedby={fromAccountError ? 'transaction-from-account-error' : undefined}
                required
              >
                <option value="">選択してください</option>
                {transferAccounts.map((account) => (
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
          <div
            className={[
              formsStyles.field,
              formsStyles['account-field'],
              toAccountError && formsStyles['has-error'],
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <label htmlFor="transaction-to-account">振替先</label>
            <div
              className={[formsStyles['field-value'], toAccountError && formsStyles['has-error']]
                .filter(Boolean)
                .join(' ')}
            >
              <select
                className={formsStyles['field-select']}
                id="transaction-to-account"
                name="toAccountId"
                value={formValues.toAccountId}
                onChange={(event) => updateValue('toAccountId', event.currentTarget.value)}
                aria-invalid={toAccountError ? true : undefined}
                aria-describedby={toAccountError ? 'transaction-to-account-error' : undefined}
                required
              >
                <option value="">選択してください</option>
                {transferAccounts.map((account) => (
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
        <div
          data-slot="ordinary-account-detail"
          className={[
            formsStyles['entry-detail-grid'],
            formsStyles['ordinary-account-detail-grid'],
          ].join(' ')}
        >
          <div
            className={[
              formsStyles.field,
              formsStyles['account-field'],
              accountError && formsStyles['has-error'],
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <label htmlFor="transaction-account">資産</label>
            <div
              className={[formsStyles['field-value'], accountError && formsStyles['has-error']]
                .filter(Boolean)
                .join(' ')}
            >
              <select
                className={formsStyles['field-select']}
                id="transaction-account"
                name="accountId"
                value={formValues.accountId}
                onChange={(event) => updateValue('accountId', event.currentTarget.value)}
                aria-invalid={accountError ? true : undefined}
                aria-describedby={accountError ? 'transaction-account-error' : undefined}
              >
                <option value="">選択してください</option>
                {normalAccounts.map((account) => (
                  <option value={account.id} key={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
              {accountError ? (
                <FieldError id="transaction-account-error" message={accountError} />
              ) : null}
            </div>
          </div>
        </div>

        <div className={formsStyles['entry-detail-grid']}>
          <div
            className={[
              formsStyles.field,
              formsStyles['date-field'],
              occurredOnError && formsStyles['has-error'],
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <label id="transaction-date-label" htmlFor="transaction-date">
              日付
            </label>
            <div
              data-slot="date-field-value"
              className={[formsStyles['field-value'], occurredOnError && formsStyles['has-error']]
                .filter(Boolean)
                .join(' ')}
            >
              <DatePickerField
                id="transaction-date"
                name="occurredOn"
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

          <div
            data-slot="memo-field"
            className={[
              formsStyles.field,
              formsStyles['memo-field'],
              memoError && formsStyles['has-error'],
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <label htmlFor="transaction-memo">
              メモ（<span className={formsStyles['optional-label']}>任意</span>）
            </label>
            <div
              data-slot="memo-field-value"
              className={[formsStyles['field-value'], memoError && formsStyles['has-error']]
                .filter(Boolean)
                .join(' ')}
            >
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

        <div
          className={[
            formsStyles['save-button-options'],
            showCancel && formsStyles['save-button-options-with-cancel'],
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {showCancel ? (
            <Button
              variant="secondary"
              className={formsStyles['save-button-cancel']}
              type="button"
              onClick={() => router.back()}
            >
              キャンセル
            </Button>
          ) : null}
          <span className={formsStyles['save-button-ordinary']}>
            <SubmitButton label={submitLabel} />
          </span>
          <span className={formsStyles['save-button-transfer']}>
            <SubmitButton label={submitLabel} />
          </span>
        </div>
      </form>
    </>
  );
}

export type DeleteAction = (
  previousState: DeleteFormState,
  formData: FormData,
) => Promise<DeleteFormState>;

export interface DeleteTransactionFormProps {
  transactionId: number;
  entryType?: 'transaction' | 'transfer';
  formId?: string;
  action?: DeleteAction;
  targetLabel?: string;
  idFieldName?: string;
  cancelHref?: string;
}

export function DeleteTransactionForm({
  transactionId,
  entryType = 'transaction',
  formId = 'delete-transaction-form',
  action,
  targetLabel = '取引',
  idFieldName = 'id',
  cancelHref,
}: DeleteTransactionFormProps) {
  const deleteAction = action ?? deleteTransactionAction.bind(null, entryType);
  const [state, formAction, pending] = useActionState<DeleteFormState, FormData>(deleteAction, {});
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
    window.requestAnimationFrame(() => summaryRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!hasHydrated || !isDeleteConfirmOpen) {
      if (hasHydrated && wasDeleteConfirmOpenRef.current) {
        wasDeleteConfirmOpenRef.current = false;
        window.requestAnimationFrame(() => summaryRef.current?.focus());
      }
      return;
    }

    wasDeleteConfirmOpenRef.current = true;
    bodyOverflowRef.current = document.body.style.overflow;
    htmlOverflowRef.current = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    const dialog = detailsRef.current?.querySelector<HTMLElement>(
      '[data-slot="delete-confirmation"]',
    );
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
          'button:not([disabled]):not([aria-label="戻る"]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
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
    cancelHref ??
    (entryType === 'transfer'
      ? `/transactions/transfers/${transactionId}/edit`
      : `/transactions/${transactionId}/edit`);

  function handleCancel(event: MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault();
    closeDeleteConfirm();
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([aria-label="戻る"]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ),
    ).filter((element) => element.getClientRects().length > 0);
    const first = focusable.at(0);
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
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
      <div className={formsStyles['delete-action']}>
        <details
          data-slot="delete-confirm"
          ref={detailsRef}
          className={formsStyles['delete-confirm']}
        >
          <summary
            ref={summaryRef}
            className={[primitiveStyles.button, primitiveStyles.buttonDangerQuiet].join(' ')}
          >
            削除する
          </summary>
          <button
            data-slot="delete-modal-backdrop"
            className={formsStyles['delete-modal-backdrop']}
            type="button"
            tabIndex={-1}
            aria-label="削除確認を閉じる"
            onClick={closeDeleteConfirm}
          />
          <div
            id={`${formId}-dialog`}
            data-card-pattern="overlay-card"
            data-card-kind={targetLabel === '資産' ? 'asset' : 'transaction'}
            data-slot="delete-confirmation"
            className={formsStyles['delete-confirmation']}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${formId}-title`}
            onKeyDown={handleDialogKeyDown}
          >
            <header
              className={formsStyles['dialog-head']}
              data-card-kind={targetLabel === '資産' ? 'asset' : 'transaction'}
            >
              <h2 id={`${formId}-title`}>この{targetLabel}を削除しますか？</h2>
            </header>
            <p className={formsStyles['delete-description']}>削除すると元に戻せません。</p>
            <form
              id={formId}
              className={[formsStyles['delete-form'], formsStyles['delete-confirm-form']].join(' ')}
              action={formAction}
            >
              <input type="hidden" name={idFieldName} value={transactionId} />

              <input type="hidden" name="confirm" value="delete" />
              <button
                ref={confirmButtonRef}
                className={[primitiveStyles.button, primitiveStyles.buttonDanger].join(' ')}
                type="submit"
                disabled={pending}
                aria-busy={pending}
              >
                {pending ? '削除中…' : '削除を確定'}
              </button>
              <a className={formsStyles['delete-cancel']} href={editPath} onClick={handleCancel}>
                キャンセル
              </a>
            </form>
          </div>
        </details>
      </div>
    </>
  );
}
