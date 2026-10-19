'use client';

import { useEffect, useLayoutEffect } from 'react';

let activeLocks = 0;
let previousStyles: { htmlOverflow: string; bodyPaddingRight: string } | null = null;

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function acquireBackgroundScrollLock(): () => void {
  if (typeof document === 'undefined' || !document.body) {
    return () => undefined;
  }

  if (activeLocks === 0) {
    const html = document.documentElement;
    const body = document.body;
    previousStyles = {
      htmlOverflow: html.style.overflow,
      bodyPaddingRight: body.style.paddingRight,
    };

    const scrollbarWidth = Math.max(0, window.innerWidth - html.clientWidth);
    html.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      const currentPaddingRight = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${currentPaddingRight + scrollbarWidth}px`;
    }
  }
  activeLocks += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeLocks -= 1;
    if (activeLocks !== 0 || !previousStyles) return;

    document.documentElement.style.overflow = previousStyles.htmlOverflow;
    document.body.style.paddingRight = previousStyles.bodyPaddingRight;
    previousStyles = null;
  };
}

export function useBackgroundScrollLock(locked = true): void {
  useIsomorphicLayoutEffect(() => {
    if (!locked) return;
    return acquireBackgroundScrollLock();
  }, [locked]);
}
