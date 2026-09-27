'use client';

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

function openNativePicker(input: HTMLInputElement): void {
  const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
  if (typeof pickerInput.showPicker === 'function') {
    try {
      pickerInput.showPicker();
      return;
    } catch {
      // Some browsers reject showPicker unless the input is focused first.
    }
  }
  input.focus();
  input.click();
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
      className={enhanced ? 'date-picker-input' : className}
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

  return (
    <div className={`date-picker-control${className ? ` ${className}` : ''}`}>
      <button
        className={`date-picker-display${kind === 'month' ? ' month-picker-display' : ''}`}
        type="button"
        aria-labelledby={labelId}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid ? true : undefined}
        onClick={() => {
          if (inputRef.current) {
            openNativePicker(inputRef.current);
          }
        }}
      >
        <span>{formatPickerValue(currentValue, kind)}</span>
        <span className="date-picker-icon" aria-hidden="true" />
      </button>
      {input}
    </div>
  );
}

export function MonthPickerField(props: Omit<DatePickerFieldProps, 'kind'>) {
  return <DatePickerField {...props} kind="month" />;
}
