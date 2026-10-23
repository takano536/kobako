'use client';

import settingsStyles from './settings.module.css';
import { useId, useRef, useSyncExternalStore, type KeyboardEvent } from 'react';

import {
  THEME_PREFERENCE_ATTRIBUTE,
  THEME_STORAGE_KEY,
  parseThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from '../../src/lib/theme';

const THEME_OPTIONS: ReadonlyArray<{
  value: ThemePreference;
  label: string;
  hint?: string;
  sheets: ReadonlyArray<ResolvedTheme>;
}> = [
  { value: 'light', label: 'ライト', sheets: ['light'] },
  { value: 'dark', label: 'ダーク', sheets: ['dark'] },
  {
    value: 'system',
    label: 'システムに合わせる',
    hint: '端末の設定に従います',
    sheets: ['light', 'dark'],
  },
];

// The inline theme script owns `<html data-theme-preference>`; this component only reads and writes it.
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [THEME_PREFERENCE_ATTRIBUTE],
  });
  return () => observer.disconnect();
}

function readPreference(): ThemePreference | null {
  const value = document.documentElement.getAttribute(THEME_PREFERENCE_ATTRIBUTE);
  return value === null ? null : parseThemePreference(value);
}

// The server cannot know the device's choice, so nothing is checked until hydration.
function readServerPreference(): ThemePreference | null {
  return null;
}

function choosePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable (private browsing, quota); the choice still applies to this page.
  }
  document.documentElement.setAttribute(THEME_PREFERENCE_ATTRIBUTE, preference);
}

const NEXT_KEYS: Readonly<Record<string, 1 | -1>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

export function AppearanceSettings({ labelledBy }: { labelledBy: string }) {
  const preference = useSyncExternalStore(subscribe, readPreference, readServerPreference);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const idPrefix = useId();
  const focusableIndex = Math.max(
    0,
    THEME_OPTIONS.findIndex((option) => option.value === preference),
  );

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = optionRefs.current.findIndex((option) => option === document.activeElement);
    const step = NEXT_KEYS[event.key];
    if (current === -1) return;
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = THEME_OPTIONS.length - 1;
    else if (step !== undefined)
      next = (current + step + THEME_OPTIONS.length) % THEME_OPTIONS.length;
    else return;
    event.preventDefault();
    optionRefs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className={settingsStyles['theme-options']}
      onKeyDown={handleKeyDown}
    >
      {THEME_OPTIONS.map((option, index) => {
        const labelId = `${idPrefix}-${option.value}-label`;
        const hintId = `${idPrefix}-${option.value}-hint`;
        return (
          <button
            key={option.value}
            ref={(element) => {
              optionRefs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={option.value === preference}
            aria-labelledby={labelId}
            aria-describedby={option.hint ? hintId : undefined}
            tabIndex={index === focusableIndex ? 0 : -1}
            data-value={option.value}
            className={settingsStyles['theme-option']}
            onClick={() => choosePreference(option.value)}
          >
            <span className={settingsStyles['theme-preview']} aria-hidden="true">
              {option.sheets.map((sheet) => (
                <span key={sheet} data-theme={sheet} className={settingsStyles['theme-sheet']}>
                  <span className={settingsStyles['theme-sheet-title']} />
                  <span className={settingsStyles['theme-sheet-rule']} />
                  <span className={settingsStyles['theme-sheet-text']} />
                  <span className={settingsStyles['theme-sheet-accent']} />
                </span>
              ))}
            </span>
            <span className={settingsStyles['theme-option-text']}>
              <span className={settingsStyles['theme-option-indicator']} aria-hidden="true" />
              <span id={labelId}>{option.label}</span>
              {option.hint ? (
                <span id={hintId} className={settingsStyles['theme-option-hint']}>
                  {option.hint}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
