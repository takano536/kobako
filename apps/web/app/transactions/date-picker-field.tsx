'use client';

import formsStyles from '../forms.module.css';
import { handlePickerDisplayClick, handlePickerDisplayKeyDown } from '../_components/native-picker';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';

type PickerKind = 'date' | 'month';

interface DatePickerFieldProps {
  id: string;
  name: string;
  value: string;
  kind: PickerKind;
  labelId?: string;
  required?: boolean;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  onChange?: (value: string) => void;
  className?: string;
  /**
   * 呼び出し側の `<label htmlFor={id}>` がこの欄を包んでいるとき真。表示部を `<label>` にすると
   * ラベルの入れ子になるため、`<span>` にして外側のラベルの既定動作で input を起動します。
   */
  wrappedByLabel?: boolean;
}

function formatPickerValue(value: string, kind: PickerKind): string {
  if (kind === 'date') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return match ? `${match[1]}/${match[2]}/${match[3]}` : value;
  }
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match ? `${match[1]}/${match[2]}` : value;
}

function pickerValue(value: string, kind: PickerKind): string {
  return kind === 'date'
    ? /^(\d{4})-(\d{2})-(\d{2})$/.test(value)
      ? value
      : ''
    : /^(\d{4})-(\d{2})$/.test(value)
      ? value
      : '';
}

export function DatePickerField({
  id,
  name,
  value,
  kind,
  labelId,
  required = false,
  ariaInvalid,
  ariaDescribedBy,
  onChange,
  className,
  wrappedByLabel = false,
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
      type={kind}
      value={pickerValue(currentValue, kind)}
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

  const displayProps = {
    'data-slot': kind === 'month' ? 'month-picker-display' : 'date-picker-display',
    className: [
      formsStyles['date-picker-display'],
      kind === 'month' && formsStyles['month-picker-display'],
    ]
      .filter(Boolean)
      .join(' '),
    role: 'button',
    tabIndex: 0,
    'aria-labelledby': labelId,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid ? true : undefined,
    // Android のタッチ端末ではラベルから input への既定の起動に任せ、ほかは showPicker() で開きます。
    onClick: (event: { target: EventTarget | null; preventDefault(): void }) =>
      handlePickerDisplayClick(event, inputRef.current),
    onKeyDown: (event: { key: string; target: EventTarget | null; preventDefault(): void }) =>
      handlePickerDisplayKeyDown(event, inputRef.current),
  } as const;
  const displayContent = (
    <>
      <span>{formatPickerValue(currentValue, kind)}</span>
      <span className={formsStyles['date-picker-icon']} aria-hidden="true" />
    </>
  );

  return (
    <div className={[formsStyles['date-picker-control'], className].filter(Boolean).join(' ')}>
      {wrappedByLabel ? (
        <span {...displayProps}>{displayContent}</span>
      ) : (
        <label htmlFor={id} {...displayProps}>
          {displayContent}
        </label>
      )}
      {input}
    </div>
  );
}

export function MonthPickerField(props: Omit<DatePickerFieldProps, 'kind'>) {
  return <DatePickerField {...props} kind="month" />;
}
