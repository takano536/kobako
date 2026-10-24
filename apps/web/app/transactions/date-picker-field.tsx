'use client';

import formsStyles from '../forms.module.css';
import { MonthPicker } from '../_components/month-picker';
import { handlePickerDisplayClick, handlePickerDisplayKeyDown } from '../_components/native-picker';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';

interface DatePickerFieldProps {
  id: string;
  name: string;
  value: string;
  labelId?: string;
  required?: boolean;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  onChange?: (value: string) => void;
  className?: string;
}

function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : value;
}

function formatMonth(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match ? `${match[1]}/${match[2]}` : value;
}

/** 日付欄。ブラウザのネイティブの日付ピッカーで選びます。 */
export function DatePickerField({
  id,
  name,
  value,
  labelId,
  required = false,
  ariaInvalid,
  ariaDescribedBy,
  onChange,
  className,
}: DatePickerFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [enhanced, setEnhanced] = useState(false);
  const [currentValue, setCurrentValue] = useState(value);

  useEffect(() => {
    setCurrentValue(value);
  }, [value]);

  useEffect(() => {
    setEnhanced(true);
  }, []);

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const nextValue = event.currentTarget.value;
    setCurrentValue(nextValue);
    onChange?.(nextValue);
  }

  const input = (
    <input
      ref={inputRef}
      id={id}
      className={enhanced ? formsStyles['date-picker-input'] : className}
      name={name}
      type="date"
      value={/^(\d{4})-(\d{2})-(\d{2})$/.test(currentValue) ? currentValue : ''}
      onChange={handleChange}
      aria-invalid={ariaInvalid ? true : undefined}
      aria-describedby={ariaDescribedBy}
      required={required}
      tabIndex={enhanced ? -1 : undefined}
    />
  );

  if (!enhanced) {
    return input;
  }

  return (
    <div className={[formsStyles['date-picker-control'], className].filter(Boolean).join(' ')}>
      <label
        htmlFor={id}
        data-slot="date-picker-display"
        className={formsStyles['date-picker-display']}
        role="button"
        tabIndex={0}
        aria-labelledby={labelId}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid ? true : undefined}
        // Android のタッチ端末ではラベルから input への既定の起動に任せ、ほかは showPicker() で開きます。
        onClick={(event) => handlePickerDisplayClick(event, inputRef.current)}
        onKeyDown={(event) => handlePickerDisplayKeyDown(event, inputRef.current)}
      >
        <span>{formatDate(currentValue)}</span>
        <span className={formsStyles['date-picker-icon']} aria-hidden="true" />
      </label>
      {input}
    </div>
  );
}

/**
 * フィルタの月欄。アプリ内の月グリッド（{@link MonthPicker}）で選び、GET フォームへは隠し input で
 * 送ります。JavaScript が動く前（と無効なとき）は、ネイティブの `input[type=month]` をそのまま出します。
 */
export function MonthPickerField({
  id,
  name,
  value,
  labelId,
}: {
  id: string;
  name: string;
  value: string;
  labelId?: string;
}) {
  const [enhanced, setEnhanced] = useState(false);
  const [currentValue, setCurrentValue] = useState(value);

  useEffect(() => {
    setCurrentValue(value);
  }, [value]);

  useEffect(() => {
    setEnhanced(true);
  }, []);

  if (!enhanced) {
    return (
      <input
        id={id}
        name={name}
        type="month"
        defaultValue={/^(\d{4})-(\d{2})$/.test(value) ? value : ''}
      />
    );
  }

  return (
    <div className={formsStyles['date-picker-control']}>
      <MonthPicker
        id={id}
        value={currentValue}
        onSelect={setCurrentValue}
        displaySlot="month-picker-display"
        displayClassName={[
          formsStyles['date-picker-display'],
          formsStyles['month-picker-display'],
        ].join(' ')}
        ariaLabelledBy={labelId}
      >
        <span>{formatMonth(currentValue)}</span>
        <span className={formsStyles['date-picker-icon']} aria-hidden="true" />
      </MonthPicker>
      <input type="hidden" name={name} value={currentValue} />
    </div>
  );
}
