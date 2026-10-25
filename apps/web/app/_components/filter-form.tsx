'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';

const FilterFormContext = createContext<(() => void) | null>(null);

/** フィルタのフォームに値を反映させる関数。フォームの外では null。 */
export function useFilterFormApply(): (() => void) | null {
  return useContext(FilterFormContext);
}

/**
 * Filters apply as soon as they change: the URL is replaced, so the panel stays open
 * and the ledger re-renders on the server. No submit button.
 *
 * Native change events cover the selects. Widgets that keep their value in React state
 * (the month picker) call `useFilterFormApply` instead, because React ignores change
 * events from a hidden input.
 */
export function FilterForm({ className, children }: { className?: string; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const formRef = useRef<HTMLFormElement>(null);
  const apply = useMemo(
    () => () => {
      const form = formRef.current;
      if (!form) return;
      const params = new URLSearchParams();
      for (const [key, value] of new FormData(form).entries()) {
        const text = String(value);
        if (text) params.set(key, text);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );
  return (
    <FilterFormContext.Provider value={apply}>
      <form
        ref={formRef}
        className={className}
        data-slot="filter-form"
        method="get"
        onChange={(event) => {
          const target = event.target as unknown as { name?: string };
          if (!target.name) return;
          apply();
        }}
        onSubmit={(event) => event.preventDefault()}
      >
        {children}
      </form>
    </FilterFormContext.Provider>
  );
}
