'use client';

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
  kind: string;
  expectedKind: string;
  confirmKindChange: boolean;
  closingDay: string;
  paymentDay: string;
  paymentMonthOffset: string;
  debitAccountId: string;
}

export interface AccountFormState {
  values?: AccountFormValues;
  fieldErrors?: Record<string, string[]>;
  message?: string;
  requiresKindConfirmation?: boolean;
}

interface AccountOption {
  id: number;
  name: string;
  kind: string;
  status: 'active' | 'closed';
  deletedAt: Date | null;
}

export interface AccountFormProps {
  action: (previousState: AccountFormState, formData: FormData) => Promise<AccountFormState>;
  initialValues: AccountFormValues;
  accounts?: readonly AccountOption[];
  accountId?: number;
  submitLabel: string;
  returnTo?: string;
}

const KINDS = [
  ['cash', '現金'],
  ['bank', '銀行'],
  ['credit_card', 'クレジットカード'],
  ['debit_card', 'デビットカード'],
  ['electronic_money', '電子マネー'],
  ['other', 'その他'],
] as const;

const dayOptions = Array.from({ length: 31 }, (_, index) => String(index + 1));

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

function FieldError({ id, messages }: { id: string; messages?: readonly string[] }) {
  return messages?.length ? (
    <span id={id} className="field-error" role="alert">
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
  submitLabel,
  returnTo,
  accountId,
}: AccountFormProps) {
  const [state, formAction] = useActionState(action, {});
  const [values, setValues] = useState(initialValues);
  const current = state.values ?? values;
  const nameError = state.fieldErrors?.name;
  const kindError = state.fieldErrors?.kind;
  useEffect(() => {
    if (state.values) setValues(state.values);
  }, [state.values]);

  function updateValue<K extends keyof AccountFormValues>(key: K, value: AccountFormValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  const card = cardConditionValues(current);
  const setCardValue = (key: keyof CardConditionValues, value: string) => {
    setValues((previous) => ({ ...previous, [key]: value }));
  };

  return (
    <form className="ledger-form account-form" action={formAction} noValidate>
      {returnTo ? <input type="hidden" name="return" value={returnTo} /> : null}
      <div className="entry-detail-grid">
        <div className="field">
          <label htmlFor="account-name">名前</label>
          <div className="field-value">
            <input
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
        </div>
        <div className="field">
          <label htmlFor="account-kind">種別</label>
          <div className="field-value">
            <select
              className="field-select"
              id="account-kind"
              name="kind"
              required
              value={current.kind}
              onChange={(event) => updateValue('kind', event.currentTarget.value)}
              aria-invalid={kindError?.length ? true : undefined}
              aria-describedby={kindError?.length ? 'account-kind-error' : undefined}
            >
              {KINDS.map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
            <FieldError id="account-kind-error" messages={kindError} />
          </div>
        </div>
      </div>

      {current.kind === 'credit_card' ? (
        <section className="account-card-fields" aria-labelledby="account-card-fields-title">
          <SectionHeading id="account-card-fields-title" title="カード条件" />
          <div className="entry-detail-grid">
            <div className="field">
              <label htmlFor="closing-day">締め日</label>
              <div className="field-value">
                <select
                  className="field-select"
                  id="closing-day"
                  name="closingDay"
                  value={card.closingDay}
                  onChange={(event) => setCardValue('closingDay', event.currentTarget.value)}
                >
                  <option value="">未設定</option>
                  {dayOptions.map((day) => (
                    <option value={day} key={day}>
                      {day}日
                    </option>
                  ))}
                  <option value="last">月末</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="payment-day">支払日</label>
              <div className="field-value">
                <select
                  className="field-select"
                  id="payment-day"
                  name="paymentDay"
                  value={card.paymentDay}
                  onChange={(event) => setCardValue('paymentDay', event.currentTarget.value)}
                >
                  <option value="">未設定</option>
                  {dayOptions.map((day) => (
                    <option value={day} key={day}>
                      {day}日
                    </option>
                  ))}
                  <option value="last">月末</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="payment-month-offset">支払月</label>
              <div className="field-value">
                <select
                  className="field-select"
                  id="payment-month-offset"
                  name="paymentMonthOffset"
                  value={card.paymentMonthOffset}
                  onChange={(event) =>
                    setCardValue('paymentMonthOffset', event.currentTarget.value)
                  }
                >
                  <option value="">未設定</option>
                  <option value="same_month">当月</option>
                  <option value="next_month">翌月</option>
                  <option value="two_months_later">翌々月</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="debit-account">引落口座</label>
              <div className="field-value">
                <select
                  className="field-select"
                  id="debit-account"
                  name="debitAccountId"
                  value={card.debitAccountId}
                  onChange={(event) => setCardValue('debitAccountId', event.currentTarget.value)}
                >
                  <option value="">未設定</option>
                  {accounts
                    .filter(
                      (account) =>
                        (account.deletedAt === null ||
                          account.id === Number(card.debitAccountId)) &&
                        account.id !== accountId &&
                        account.kind !== 'credit_card',
                    )
                    .map((account) => (
                      <option value={account.id} key={account.id}>
                        {account.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {state.requiresKindConfirmation ? (
        <label className="checkbox-field">
          <input
            type="checkbox"
            name="confirmKindChange"
            checked={current.confirmKindChange}
            onChange={(event) => updateValue('confirmKindChange', event.currentTarget.checked)}
          />
          種別を変更することを確認しました
        </label>
      ) : null}
      <input type="hidden" name="expectedKind" value={current.expectedKind} />
      {state.message ? (
        <p className="form-message" role="alert">
          {state.message}
        </p>
      ) : null}
      <div className="form-actions">
        <SubmitButton label={submitLabel} />
      </div>
    </form>
  );
}
