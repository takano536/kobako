'use client';

import { useSyncExternalStore } from 'react';

import {
  ORIGIN_BADGE_ATTRIBUTE,
  ORIGIN_BADGE_HIDDEN_VALUE,
  ORIGIN_BADGE_STORAGE_KEY,
} from '../../src/lib/origin-badge';
import settingsStyles from './settings.module.css';

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [ORIGIN_BADGE_ATTRIBUTE],
  });
  return () => observer.disconnect();
}

function readVisible(): boolean {
  return (
    document.documentElement.getAttribute(ORIGIN_BADGE_ATTRIBUTE) !== ORIGIN_BADGE_HIDDEN_VALUE
  );
}

// Matches the markup the server renders; the inline script corrects it on the client.
function readServerVisible(): boolean {
  return true;
}

function setVisible(visible: boolean): void {
  try {
    if (visible) window.localStorage.removeItem(ORIGIN_BADGE_STORAGE_KEY);
    else window.localStorage.setItem(ORIGIN_BADGE_STORAGE_KEY, ORIGIN_BADGE_HIDDEN_VALUE);
  } catch {
    // Storage can be unavailable; the choice still applies to this page.
  }
  if (visible) document.documentElement.removeAttribute(ORIGIN_BADGE_ATTRIBUTE);
  else document.documentElement.setAttribute(ORIGIN_BADGE_ATTRIBUTE, ORIGIN_BADGE_HIDDEN_VALUE);
}

export function OriginBadgeSetting() {
  const visible = useSyncExternalStore(subscribe, readVisible, readServerVisible);
  return (
    <label className={settingsStyles['switch-row']}>
      <span>APIの印を表示</span>
      <span className={settingsStyles.switch}>
        <input
          type="checkbox"
          role="switch"
          aria-checked={visible}
          checked={visible}
          onChange={(event) => setVisible(event.target.checked)}
        />
        <span className={settingsStyles['switch-thumb']} aria-hidden="true" />
      </span>
    </label>
  );
}
