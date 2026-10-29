'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import formsStyles from '../forms.module.css';
import { Button } from '../_components/button';
import { Field, Input, Select } from '../_components/field';
import type { FixedCostFormState } from './actions';

interface Option { id: number; name: string }
export interface FixedCostFormValues {
  name: string;
  amount: string;
  categoryId: string;
  accountId: string;
  intervalCount: string;
  intervalUnit: string;
  startMonth: string;
  day: string;
}

export function FixedCostForm({
  action,
  initialValues,
  categories,
  accounts,
  submitLabel,
}: {
  action: (state: FixedCostFormState, formData: FormData) => Promise<FixedCostFormState>;
  initialValues: FixedCostFormValues;
  categories: readonly Option[];
  accounts: readonly Option[];
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const values = { ...initialValues, ...state.values };
  const errors = state.fieldErrors ?? {};
  return (
    <form action={formAction} className={formsStyles['ledger-form']} noValidate>
      <Field className={formsStyles.field}>
        <label htmlFor="fixed-cost-name">名称</label>
        <Input id="fixed-cost-name" name="name" value={values.name} maxLength={120} required />
        <Error messages={errors.name} />
      </Field>
      <Field className={formsStyles.field}>
        <label htmlFor="fixed-cost-amount">金額（円）</label>
        <Input id="fixed-cost-amount" name="amount" inputMode="numeric" value={values.amount} required />
        <Error messages={errors.amount} />
      </Field>
      <Field className={formsStyles.field}>
        <label htmlFor="fixed-cost-category">カテゴリ</label>
        <Select id="fixed-cost-category" name="categoryId" value={values.categoryId} required>
          <option value="">選択してください</option>
          {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
        </Select>
        <Error messages={errors.categoryId} />
      </Field>
      <Field className={formsStyles.field}>
        <label htmlFor="fixed-cost-account">資産</label>
        <Select id="fixed-cost-account" name="accountId" value={values.accountId} required>
          <option value="">選択してください</option>
          {accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}
        </Select>
        <Error messages={errors.accountId} />
      </Field>
      <div className={formsStyles['entry-detail-grid']}>
        <Field className={formsStyles.field}>
          <label htmlFor="fixed-cost-interval-unit">頻度</label>
          <Select id="fixed-cost-interval-unit" name="intervalUnit" value={values.intervalUnit}>
            <option value="month">毎月</option>
            <option value="year">毎年</option>
          </Select>
        </Field>
        <Field className={formsStyles.field}>
          <label htmlFor="fixed-cost-interval-count">間隔</label>
          <div>
            <Input id="fixed-cost-interval-count" name="intervalCount" type="number" min={1} max={120} value={values.intervalCount} required />
            <span> {values.intervalUnit === 'year' ? '年ごと' : 'か月ごと'}</span>
          </div>
          <Error messages={errors.intervalCount} />
        </Field>
      </div>
      <div className={formsStyles['entry-detail-grid']}>
        <Field className={formsStyles.field}>
          <label htmlFor="fixed-cost-start-month">開始月</label>
          <Input id="fixed-cost-start-month" name="startMonth" type="month" value={values.startMonth} required />
          <Error messages={errors.startMonth} />
        </Field>
        <Field className={formsStyles.field}>
          <label htmlFor="fixed-cost-day">発生日</label>
          <Input id="fixed-cost-day" name="day" type="number" min={1} max={31} value={values.day} required />
          <Error messages={errors.day} />
        </Field>
      </div>
      {state.message ? <p role="alert">{state.message}</p> : null}
      <Submit label={submitLabel} />
    </form>
  );
}

function Error({ messages }: { messages?: readonly string[] }) {
  return messages?.[0] ? <span className={formsStyles['field-error']} role="alert">{messages[0]}</span> : null;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? '保存中…' : label}</Button>;
}
