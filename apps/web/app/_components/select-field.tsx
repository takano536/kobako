'use client';

import { createPortal } from 'react-dom';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

import styles from './select-field.module.css';

export interface SelectFieldOption {
  value: string;
  label: ReactNode;
  meta?: ReactNode;
}

export interface SelectFieldProps {
  id: string;
  name: string;
  value: string;
  options: readonly SelectFieldOption[];
  className?: string;
  required?: boolean;
  disabled?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  onValueChange: (value: string) => void;
}

const MENU_GAP = 6;
const VIEWPORT_MARGIN = 8;
const MIN_MENU_HEIGHT = 120;
const MENU_WIDTH = 240;

function optionLabel(option: SelectFieldOption | undefined): ReactNode {
  return option?.label ?? '';
}

export function SelectField({
  id,
  name,
  value,
  options,
  className,
  required,
  disabled,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  onValueChange,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [enhanced, setEnhanced] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = `${useId()}-menu`;
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    setEnhanced(true);
  }, []);

  function close(returnFocus: boolean): void {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function choose(nextValue: string): void {
    close(true);
    if (nextValue !== value) onValueChange(nextValue);
  }

  useLayoutEffect(() => {
    if (!open) return;
    const place = (event?: Event) => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      if (event?.target instanceof Node && menu.contains(event.target)) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, MENU_WIDTH), window.innerWidth - VIEWPORT_MARGIN * 2);
      const left = Math.min(
        Math.max(VIEWPORT_MARGIN, rect.left),
        window.innerWidth - VIEWPORT_MARGIN - width,
      );
      const bottom = window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN;
      const above = rect.top - MENU_GAP - VIEWPORT_MARGIN;
      const natural = Math.min(menu.scrollHeight, menu.getBoundingClientRect().height);
      const placement = natural > bottom && above > bottom;
      const available = Math.max(placement ? above : bottom, MIN_MENU_HEIGHT);
      menu.style.width = `${width}px`;
      menu.style.left = `${left}px`;
      menu.style.top = placement ? '' : `${rect.bottom + MENU_GAP}px`;
      menu.style.bottom = placement ? `${window.innerHeight - rect.top + MENU_GAP}px` : '';
      menu.dataset.placement = placement ? 'top' : 'bottom';
      menu.style.maxHeight = natural > available ? `${available}px` : '';
    };
    place();
    window.addEventListener('scroll', place, { capture: true, passive: true });
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, { capture: true });
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const target =
      menu?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      menu?.querySelector<HTMLElement>('[role="menuitemradio"]');
    target?.focus({ preventScroll: true });
    if (target && menu) {
      const top = target.offsetTop - menu.clientHeight / 2 + target.offsetHeight / 2;
      menu.scrollTop = Math.max(0, top);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = index <= 0 ? items.length - 1 : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Tab') {
      event.preventDefault();
      close(true);
      return;
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const active = items[index];
      if (active) choose(active.dataset.value ?? '');
      return;
    }
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  }

  const menu = enhanced && open ? (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={name}
      data-slot="select-field-menu"
      className={styles.menu}
      onKeyDown={handleMenuKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="menuitemradio"
            aria-checked={checked}
            tabIndex={-1}
            data-value={option.value}
            className={styles['menu-item']}
            onClick={() => choose(option.value)}
          >
            <span className={styles['menu-label']}>{optionLabel(option)}</span>
            {option.meta ? <span className={styles['menu-meta']}>{option.meta}</span> : null}
          </button>
        );
      })}
    </div>
  ) : null;

  if (!enhanced) {
    return (
      <select
        id={id}
        name={name}
        className={[styles.fallback, className].filter(Boolean).join(' ')}
        value={value}
        required={required}
        disabled={disabled}
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => onValueChange(event.currentTarget.value)}
      >
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        data-slot="select-field-trigger"
        className={[styles.trigger, className].filter(Boolean).join(' ')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-required={required || undefined}
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (
            event.key !== 'Enter' &&
            event.key !== ' ' &&
            event.key !== 'ArrowDown' &&
            event.key !== 'ArrowUp'
          ) {
            return;
          }
          event.preventDefault();
          setOpen(true);
        }}
      >
        <span className={styles.value}>{optionLabel(selected)}</span>
      </button>
      <input type="hidden" name={name} value={value} required={required} />
      {typeof document === 'undefined' || !menu ? null : createPortal(menu, document.body)}
    </>
  );
}
