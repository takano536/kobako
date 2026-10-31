'use client';

import { useRouter } from 'next/navigation';

import formsStyles from '../forms.module.css';
import { Button } from '../_components/button';
import { SelectField } from '../_components/select-field';
import { Field, Input } from '../_components/field';
import { Section } from '../_components/section';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { SectionHeading } from '../_components/ui';

export interface CardConditionValues {
  closingDay: string;
  paymentDay: string;
  paymentMonthOffset: string;
  debitAccountId: string;
}

export interface AccountFormValues {
  name: string;
  assetCategoryId: string;
  expectedAssetCategoryId: string;
  closingDay: string;
  paymentDay: string;
  paymentMonthOffset: string;
  debitAccountId: string;
}

export interface AccountFormState {
  values?: AccountFormValues;
  fieldErrors?: Record<string, string[]>;
  message?: string;
}

interface AccountOption {
  id: number;
  name: string;
  kind: string;
  assetCategoryName: string;
  status: 'active' | 'closed';
  deletedAt: Date | null;
}
interface AssetCategoryOption {
  id: number;
  name: string;
  systemKey: string | null;
}

export interface AccountFormProps {
  action: (previousState: AccountFormState, formData: FormData) => Promise<AccountFormState>;
  initialValues: AccountFormValues;
  accounts?: readonly AccountOption[];
  assetCategories: readonly AssetCategoryOption[];
  accountId?: number;
  submitLabel: string;
  returnTo?: string;
  showCancel?: boolean;
}

const dayOptions = Array.from({ length: 31 }, (_, index) => String(index + 1));

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      className={formsStyles['save-button']}
      type="submit"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? '保存中…' : label}
    </Button>
  );
}

function FieldError({ id, messages }: { id: string; messages?: readonly string[] }) {
  return messages?.length ? (
    <span id={id} className={formsStyles['field-error']} role="alert">
      {messages[0]}
    </span>
  ) : null;
}

function cardConditionValues(condition?: Partial<CardConditionValues>): CardConditionValues {
  return {
    closingDay: condition?.closingDay ?? '',
    paymentDay: condition?.paymentDay ?? '',
    paymentMonthOffset: condition?.paymentMonthOffset ?? '',
    debitAccountId: condition?.debitAccountId ?? '',
  };
}

export function AccountForm({
  action,
  initialValues,
  accounts = [],
  assetCategories,
  submitLabel,
  returnTo,
  accountId,
  showCancel = false,
}: AccountFormProps) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, {});
  const [values, setValues] = useState(initialValues);
  const [isDirty, setIsDirty] = useState(false);
  const current = state.values && !isDirty ? state.values : values;
  const nameError = state.fieldErrors?.name;
  const assetCategoryError = state.fieldErrors?.assetCategoryId;
  const closingDayError = state.fieldErrors?.closingDay;
  const paymentDayError = state.fieldErrors?.paymentDay;
  const paymentMonthOffsetError = state.fieldErrors?.paymentMonthOffset;
  const debitAccountError = state.fieldErrors?.debitAccountId;
  useEffect(() => {
    if (state.values) {
      setValues(state.values);
      setIsDirty(false);
    }
  }, [state.values]);

  function updateValue<K extends keyof AccountFormValues>(key: K, value: AccountFormValues[K]) {
    setIsDirty(true);
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  const card = cardConditionValues(current);
  function setCardValue<K extends keyof CardConditionValues>(
    key: K,
    value: CardConditionValues[K],
  ) {
    setIsDirty(true);
    setValues((previous) => ({ ...previous, [key]: value }));
  }
  const selectedCategory = assetCategories.find(
    (category) => category.id === Number(current.assetCategoryId),
  );
  const selectedKind = selectedCategory?.systemKey ?? 'other';

  return (
    <form
      className={[formsStyles['ledger-form'], formsStyles['account-form']].join(' ')}
      action={formAction}
      noValidate
    >
      {returnTo ? <input type="hidden" name="return" value={returnTo} /> : null}
      <div className={formsStyles['entry-detail-grid']}>
        <Field className={formsStyles.field}>
          <label htmlFor="account-name">名前</label>
          <div className={formsStyles['field-value']}>
            <Input
              id="account-name"
              name="name"
              required
              maxLength={120}
              value={current.name}
              onChange={(event) => updateValue('name', event.currentTarget.value)}
              aria-invalid={nameError?.length ? true : undefined}
              aria-describedby={nameError?.length ? 'account-name-error' : undefined}
            />
            <FieldError id="account-name-error" messages={nameError} />
          </div>
        </Field>
        <Field className={formsStyles.field}>
          <label htmlFor="asset-category">資産カテゴリ</label>
          <div className={formsStyles['field-value']}>
            <SelectField
              id="asset-category"
              name="assetCategoryId"
              required
              value={current.assetCategoryId}
              options={assetCategories.map((category) => ({
                value: String(category.id),
                label: category.name,
              }))}
              onValueChange={(value) => updateValue('assetCategoryId', value)}
              aria-invalid={assetCategoryError?.length ? true : undefined}
              aria-describedby={assetCategoryError?.length ? 'asset-category-error' : undefined}
            />
            <FieldError id="asset-category-error" messages={assetCategoryError} />
          </div>
        </Field>
      </div>

      {selectedKind === 'credit_card' ? (
        <Section aria-labelledby="account-card-fields-title">
          <SectionHeading id="account-card-fields-title" title="カード条件" />
          <div className={formsStyles['entry-detail-grid']}>
            <div className={formsStyles.field}>
              <label htmlFor="closing-day">締め日</label>
              <div className={formsStyles['field-value']}>
                <SelectField
                  id="closing-day"
                  name="closingDay"
                  value={card.closingDay}
                  options={[
                    { value: '', label: '未設定' },
                    ...dayOptions.map((day) => ({ value: day, label: `${day}日` })),
                    { value: 'last', label: '月末' },
                  ]}
                  onValueChange={(value) => setCardValue('closingDay', value)}
                  aria-invalid={closingDayError?.length ? true : undefined}
                  aria-describedby={closingDayError?.length ? 'closing-day-error' : undefined}
                />
                <FieldError id="closing-day-error" messages={closingDayError} />
              </div>
            </div>
            <div className={formsStyles.field}>
              <label htmlFor="payment-day">支払日</label>
              <div className={formsStyles['field-value']}>
                <SelectField
                  id="payment-day"
                  name="paymentDay"
                  value={card.paymentDay}
                  options={[
                    { value: '', label: '未設定' },
                    ...dayOptions.map((day) => ({ value: day, label: `${day}日` })),
                    { value: 'last', label: '月末' },
                  ]}
                  onValueChange={(value) => setCardValue('paymentDay', value)}
                  aria-invalid={paymentDayError?.length ? true : undefined}
                  aria-describedby={paymentDayError?.length ? 'payment-day-error' : undefined}
                />
                <FieldError id="payment-day-error" messages={paymentDayError} />
              </div>
            </div>
            <div className={formsStyles.field}>
              <label htmlFor="payment-month-offset">支払月</label>
              <div className={formsStyles['field-value']}>
                <SelectField
                  id="payment-month-offset"
                  name="paymentMonthOffset"
                  value={card.paymentMonthOffset}
                  options={[
                    { value: '', label: '未設定' },
                    { value: 'same_month', label: '当月' },
                    { value: 'next_month', label: '翌月' },
                    { value: 'two_months_later', label: '翌々月' },
                  ]}
                  onValueChange={(value) => setCardValue('paymentMonthOffset', value)}
                  aria-invalid={paymentMonthOffsetError?.length ? true : undefined}
                  aria-describedby={
                    paymentMonthOffsetError?.length ? 'payment-month-offset-error' : undefined
                  }
                />
                <FieldError id="payment-month-offset-error" messages={paymentMonthOffsetError} />
              </div>
            </div>
            <div className={formsStyles.field}>
              <label htmlFor="debit-account">引落口座</label>
              <div className={formsStyles['field-value']}>
                <SelectField
                  id="debit-account"
                  name="debitAccountId"
                  value={card.debitAccountId}
                  options={[
                    { value: '', label: '未設定' },
                    ...accounts
                      .filter(
                        (account) =>
                          (account.deletedAt === null ||
                            account.id === Number(card.debitAccountId)) &&
                          account.id !== accountId &&
                          account.kind === 'bank',
                      )
                      .map((account) => ({
                        value: String(account.id),
                        label: account.name,
                        meta: account.assetCategoryName,
                      })),
                  ]}
                  onValueChange={(value) => setCardValue('debitAccountId', value)}
                  aria-invalid={debitAccountError?.length ? true : undefined}
                  aria-describedby={debitAccountError?.length ? 'debit-account-error' : undefined}
                />
                <FieldError id="debit-account-error" messages={debitAccountError} />
              </div>
            </div>
          </div>
        </Section>
      ) : null}

      <input type="hidden" name="expectedAssetCategoryId" value={current.expectedAssetCategoryId} />
      {state.message ? (
        <p className={formsStyles['form-message']} role="alert">
          {state.message}
        </p>
      ) : null}
      <div
        className={[
          formsStyles['form-actions'],
          showCancel && formsStyles['form-actions-with-cancel'],
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
        <SubmitButton label={submitLabel} />
      </div>
    </form>
  );
}
