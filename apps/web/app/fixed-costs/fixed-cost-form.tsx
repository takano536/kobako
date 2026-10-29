'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormStatus } from 'react-dom';

import formsStyles from '../forms.module.css';
import { Button } from '../_components/button';
import { Field, Input, Select } from '../_components/field';
import type { FixedCostFormState } from './actions';

interface Option {
  id: number;
  name: string;
}
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

function frequencyFor(values: FixedCostFormValues): 'monthly' | 'yearly' | 'custom' {
  if (values.intervalCount === '1' && values.intervalUnit === 'year') return 'yearly';
  if (values.intervalCount === '1' && values.intervalUnit === 'month') return 'monthly';
  return 'custom';
}

export function FixedCostForm({
  action,
  initialValues,
  categories,
  accounts,
  submitLabel,
  showCancel = false,
  deleteAction,
}: {
  action: (state: FixedCostFormState, formData: FormData) => Promise<FixedCostFormState>;
  initialValues: FixedCostFormValues;
  categories: readonly Option[];
  accounts: readonly Option[];
  submitLabel: string;
  showCancel?: boolean;
  deleteAction?: () => Promise<void>;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, {});
  const [values, setValues] = useState(initialValues);
  const frequency = frequencyFor(values);
  useEffect(() => {
    if (state.values) setValues({ ...initialValues, ...state.values });
  }, [state.values, initialValues]);
  function update<K extends keyof FixedCostFormValues>(key: K, value: FixedCostFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }
  function updateFrequency(next: string) {
    update(
      'intervalCount',
      next === 'custom' ? (values.intervalCount === '1' ? '2' : values.intervalCount) : '1',
    );
    update('intervalUnit', next === 'yearly' ? 'year' : 'month');
  }
  const [year, month] = values.startMonth.slice(0, 7).split('-');
  const note =
    frequency === 'yearly'
      ? `毎年、${Number(month)}月${values.day}日に支出として記録します。`
      : frequency === 'custom'
        ? `${values.intervalCount}${values.intervalUnit === 'year' ? '年' : 'か月'}ごと、${values.day}日に支出として記録します。`
        : `毎月、${values.day}日に支出として記録します。`;
  const currentMonth = `${year || new Date().getFullYear()}-${month || String(new Date().getMonth() + 1).padStart(2, '0')}`;
  return (
    <>
      <form action={formAction} className={formsStyles['ledger-form']} noValidate>
        <input type="hidden" name="startMonth" value={currentMonth} />
        <div className={formsStyles['entry-detail-grid']}>
          <Field className={formsStyles['amount-field']}>
            <label htmlFor="fixed-cost-name">名称</label>
            <div className={formsStyles['field-value']}>
              <Input
                id="fixed-cost-name"
                name="name"
                value={values.name}
                onChange={(event) => update('name', event.currentTarget.value)}
                maxLength={120}
                required
              />
            </div>
          </Field>
          <Field className={formsStyles['amount-field']}>
            <label htmlFor="fixed-cost-amount">金額</label>
            <div className={formsStyles['field-value']}>
              <div className={formsStyles['amount-line']}>
                <span aria-hidden="true">¥</span>
                <Input
                  id="fixed-cost-amount"
                  name="amount"
                  inputMode="numeric"
                  value={values.amount}
                  onChange={(event) => update('amount', event.currentTarget.value)}
                  required
                />
              </div>
            </div>
          </Field>
          <Field className={formsStyles.field}>
            <label htmlFor="fixed-cost-category">カテゴリ</label>
            <div className={formsStyles['field-value']}>
              <Select
                className={formsStyles['field-select']}
                id="fixed-cost-category"
                name="categoryId"
                value={values.categoryId}
                onChange={(event) => update('categoryId', event.currentTarget.value)}
                required
              >
                <option value="">選択してください</option>
                {categories.map((category) => (
                  <option value={category.id} key={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
          <Field className={formsStyles.field}>
            <label htmlFor="fixed-cost-account">資産</label>
            <div className={formsStyles['field-value']}>
              <Select
                className={formsStyles['field-select']}
                id="fixed-cost-account"
                name="accountId"
                value={values.accountId}
                onChange={(event) => update('accountId', event.currentTarget.value)}
                required
              >
                <option value="">選択してください</option>
                {accounts.map((account) => (
                  <option value={account.id} key={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
          <Field className={formsStyles.field}>
            <label htmlFor="fixed-cost-frequency">頻度</label>
            <div className={formsStyles['field-value']}>
              <Select
                className={formsStyles['field-select']}
                id="fixed-cost-frequency"
                value={frequency}
                onChange={(event) => updateFrequency(event.currentTarget.value)}
              >
                <option value="monthly">毎月</option>
                <option value="yearly">毎年</option>
                <option value="custom">間隔を指定</option>
              </Select>
              {frequency === 'custom' ? (
                <>
                  <input type="hidden" name="intervalCount" value={values.intervalCount} />
                  <input type="hidden" name="intervalUnit" value={values.intervalUnit} />
                </>
              ) : (
                <>
                  <input type="hidden" name="intervalCount" value={values.intervalCount} />
                  <input type="hidden" name="intervalUnit" value={values.intervalUnit} />
                </>
              )}
            </div>
          </Field>
          {frequency === 'custom' ? (
            <Field className={formsStyles.field}>
              <label htmlFor="fixed-cost-interval-count">間隔</label>
              <div className={formsStyles['field-value']}>
                <div className={formsStyles['amount-line']}>
                  <Input
                    id="fixed-cost-interval-count"
                    type="number"
                    min={1}
                    max={120}
                    value={values.intervalCount}
                    onChange={(event) => update('intervalCount', event.currentTarget.value)}
                  />
                  <Select
                    aria-label="間隔の単位"
                    value={values.intervalUnit}
                    onChange={(event) => update('intervalUnit', event.currentTarget.value)}
                  >
                    <option value="month">か月ごと</option>
                    <option value="year">年ごと</option>
                  </Select>
                </div>
              </div>
            </Field>
          ) : null}
          {frequency !== 'monthly' ? (
            <Field className={formsStyles.field}>
              <label htmlFor="fixed-cost-month">月</label>
              <div className={formsStyles['field-value']}>
                <Select
                  className={formsStyles['field-select']}
                  id="fixed-cost-month"
                  aria-label="月"
                  value={month}
                  onChange={(event) => update('startMonth', `${year}-${event.currentTarget.value}`)}
                >
                  {Array.from({ length: 12 }, (_, index) => (
                    <option value={String(index + 1).padStart(2, '0')} key={index + 1}>
                      {index + 1}月
                    </option>
                  ))}
                </Select>
              </div>
            </Field>
          ) : null}
          <Field className={formsStyles.field}>
            <label htmlFor="fixed-cost-day">日付</label>
            <div className={formsStyles['field-value']}>
              <Select
                className={formsStyles['field-select']}
                id="fixed-cost-day"
                name="day"
                value={values.day}
                onChange={(event) => update('day', event.currentTarget.value)}
              >
                {Array.from({ length: 31 }, (_, index) => (
                  <option value={String(index + 1)} key={index + 1}>
                    {index + 1}日
                  </option>
                ))}
              </Select>
            </div>
          </Field>
        </div>
        <p className={formsStyles['form-note']}>{note}</p>
        {state.message ? (
          <p className={formsStyles['form-message']} role="alert">
            {state.message}
          </p>
        ) : null}
        {state.fieldErrors ? (
          <p className={formsStyles['form-message']} role="alert">
            入力内容を確認してください。
          </p>
        ) : null}
        <div
          className={`${formsStyles['form-actions']} ${formsStyles['form-actions-with-cancel']}`}
        >
          {showCancel ? (
            <Button variant="secondary" type="button" onClick={() => router.back()}>
              キャンセル
            </Button>
          ) : (
            <span />
          )}
          <Submit label={submitLabel} />
        </div>
      </form>
      {deleteAction ? (
        <form
          action={deleteAction}
          className={formsStyles['delete-action']}
          onSubmit={(event) => {
            if (!window.confirm('この固定費を削除しますか？')) event.preventDefault();
          }}
        >
          <Button variant="danger" type="submit">
            固定費を削除
          </Button>
        </form>
      ) : null}
    </>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? '保存中…' : label}
    </Button>
  );
}
