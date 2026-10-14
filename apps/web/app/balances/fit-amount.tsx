'use client';

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface FitAmountProps {
  children: ReactNode;
  className: string;
  ariaLabel?: string;
}

interface BalanceAmountContextValue {
  fontSize: number | null;
  setMeasurement: (key: symbol, requiredFontSize: number) => void;
  unregisterMeasurement: (key: symbol) => void;
}

const BalanceAmountContext = createContext<BalanceAmountContextValue | null>(null);

function useBalanceAmountContext(): BalanceAmountContextValue {
  const context = useContext(BalanceAmountContext);
  if (context === null) {
    throw new Error('FitAmount must be used within BalanceAmountProvider');
  }
  return context;
}

function sameFontSize(current: number | null, next: number | null): boolean {
  if (current === null || next === null) return current === next;
  return Math.abs(current - next) < 0.01;
}

function minimumFontSize(measurements: Map<symbol, number>): number | null {
  let minimum: number | null = null;
  for (const measurement of measurements.values()) {
    if (!Number.isFinite(measurement) || measurement <= 0) continue;
    minimum = minimum === null ? measurement : Math.min(minimum, measurement);
  }
  return minimum;
}

export function BalanceAmountProvider({ children }: { children: ReactNode }) {
  const measurementsRef = useRef(new Map<symbol, number>());
  const [fontSize, setFontSize] = useState<number | null>(null);
  const setMeasurement = useCallback((key: symbol, requiredFontSize: number) => {
    const measurements = measurementsRef.current;
    const current = measurements.get(key);
    if (current !== undefined && sameFontSize(current, requiredFontSize)) return;
    measurements.set(key, requiredFontSize);
    const nextFontSize = minimumFontSize(measurements);
    setFontSize((currentFontSize) =>
      sameFontSize(currentFontSize, nextFontSize) ? currentFontSize : nextFontSize,
    );
  }, []);

  const unregisterMeasurement = useCallback((key: symbol) => {
    const measurements = measurementsRef.current;
    if (!measurements.delete(key)) return;
    const nextFontSize = minimumFontSize(measurements);
    setFontSize((currentFontSize) =>
      sameFontSize(currentFontSize, nextFontSize) ? currentFontSize : nextFontSize,
    );
  }, []);

  return (
    <BalanceAmountContext.Provider value={{ fontSize, setMeasurement, unregisterMeasurement }}>
      {children}
    </BalanceAmountContext.Provider>
  );
}

function measureRequiredFontSize(container: HTMLElement, content: HTMLElement): number | null {
  const originalFontSize = content.style.fontSize;
  const originalWidth = content.style.width;
  content.style.fontSize = '';
  content.style.width = 'max-content';
  const availableWidth = container.clientWidth;
  const naturalWidth = content.getBoundingClientRect().width;
  const baseFontSize = Number.parseFloat(getComputedStyle(content).fontSize);
  content.style.fontSize = originalFontSize;
  content.style.width = originalWidth;

  if (!Number.isFinite(baseFontSize) || baseFontSize <= 0) return null;
  if (availableWidth <= 0 || naturalWidth <= availableWidth) return baseFontSize;
  return Math.max(0.01, (baseFontSize * Math.max(0.01, availableWidth - 0.01)) / naturalWidth);
}

export function FitAmount({ children, className, ariaLabel }: FitAmountProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const measurementKey = useRef(Symbol('balance amount'));
  const { fontSize, setMeasurement, unregisterMeasurement } = useBalanceAmountContext();

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const fit = () => {
      const requiredFontSize = measureRequiredFontSize(container, content);
      if (requiredFontSize !== null) {
        setMeasurement(measurementKey.current, requiredFontSize);
      }
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    observer.observe(content);
    return () => {
      observer.disconnect();
      unregisterMeasurement(measurementKey.current);
    };
  }, [setMeasurement, unregisterMeasurement]);

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
