'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface FitAmountProps {
  children: ReactNode;
  className: string;
  ariaLabel?: string;
}

function sameFontSize(current: number | null, next: number | null): boolean {
  if (current === null || next === null) return current === next;
  return Math.abs(current - next) < 0.01;
}

export function FitAmount({ children, className, ariaLabel }: FitAmountProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState<number | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const fit = () => {
      const availableWidth = container.clientWidth;
      const originalFontSize = content.style.fontSize;
      const originalWidth = content.style.width;
      content.style.fontSize = '';
      content.style.width = 'max-content';
      const naturalWidth = content.getBoundingClientRect().width;
      const baseFontSize = Number.parseFloat(getComputedStyle(content).fontSize);
      content.style.fontSize = originalFontSize;
      content.style.width = originalWidth;
      const targetWidth = Math.max(0.01, availableWidth - 0.01);
      const nextFontSize =
        availableWidth > 0 && naturalWidth > availableWidth + 0.5 && baseFontSize > 0
          ? Math.max(0.01, (baseFontSize * targetWidth) / naturalWidth)
          : null;
      setFontSize((current) => (sameFontSize(current, nextFontSize) ? current : nextFontSize));
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [children]);

  return (
    <span ref={containerRef} className={className} aria-label={ariaLabel}>
      <span
        ref={contentRef}
        className="balance-amount-content"
        style={fontSize === null ? undefined : { fontSize: `${fontSize}px` }}
      >
        {children}
      </span>
    </span>
  );
}
