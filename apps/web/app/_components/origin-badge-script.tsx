'use client';

import { useLayoutEffect } from 'react';

import { ORIGIN_BADGE_INIT_SCRIPT } from '../../src/lib/origin-badge';

/** Same contract as ThemeScript: the attribute exists before paint, including after hydration. */
export function OriginBadgeScript() {
  useLayoutEffect(() => {
    const script = document.createElement('script');
    script.textContent = ORIGIN_BADGE_INIT_SCRIPT;
    document.head.appendChild(script);
    script.remove();
  }, []);
  return (
    <script
      type={typeof window === 'undefined' ? undefined : 'text/plain'}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: ORIGIN_BADGE_INIT_SCRIPT }}
    />
  );
}
