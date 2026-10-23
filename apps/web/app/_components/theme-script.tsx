'use client';

import { useLayoutEffect } from 'react';

import { THEME_INIT_SCRIPT } from '../../src/lib/theme';

/**
 * Server HTML runs the inline script before the first paint. React never executes scripts it
 * renders on the client, so the effect runs the same source through a fresh script element when
 * the head was client-rendered; the script itself ignores a second run. On the client the rendered
 * script is `text/plain` so React does not warn about rendering a script tag.
 */
export function ThemeScript() {
  useLayoutEffect(() => {
    const script = document.createElement('script');
    script.textContent = THEME_INIT_SCRIPT;
    document.head.appendChild(script);
    script.remove();
  }, []);
  return (
    <script
      type={typeof window === 'undefined' ? undefined : 'text/plain'}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
    />
  );
}
