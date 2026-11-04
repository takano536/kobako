'use client';

import switchStyles from './switch.module.css';

/**
 * A switch built on a native checkbox, so keyboard and form submission keep working.
 * Pass `checked` for a controlled switch, or `defaultChecked` inside a form.
 */
export function Switch({
  name,
  value,
  defaultChecked,
  checked,
  onChange,
  ariaLabel,
  ariaLabelledBy,
}: {
  name?: string;
  value?: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
}) {
  const controlled = checked !== undefined;
  return (
    <span className={switchStyles.switch}>
      <input
        type="checkbox"
        role="switch"
        name={name}
        value={value}
        {...(controlled
          ? { checked, 'aria-checked': checked }
          : { defaultChecked, 'aria-checked': defaultChecked })}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        onChange={(event) => onChange?.(event.target.checked)}
      />
      <span className={switchStyles['switch-thumb']} aria-hidden="true" />
    </span>
  );
}
