'use client';

import { useLayoutEffect } from 'react';

import { THEME_INIT_SCRIPT, THEME_SCRIPT_CONFIG, initTheme } from '../../src/lib/theme';

/**
 * Server HTML runs the inline script before the first paint. React never executes scripts it
 * renders on the client, so the effect starts the same sync when the head was client-rendered;
 * `initTheme` ignores the call once the inline script has run. On the client the script is
 * `text/plain` so React does not warn about rendering a script tag.
 */
export function ThemeScript() {
  useLayoutEffect(() => {
    initTheme(THEME_SCRIPT_CONFIG);
  }, []);
  return (
    <script
      type={typeof window === 'undefined' ? undefined : 'text/plain'}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
    />
  );
}
