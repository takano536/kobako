'use client';

import { createContext, useContext } from 'react';

export interface PendingNavigation {
  from: string;
  to: string;
}

export interface NavigationShellValue {
  pending: PendingNavigation | null;
  /**
   * 骨組みを持つ別の画面へ移るときだけ遷移を引き受け、`true` を返します。
   * 同じ画面内の月・条件の変更やカードを開くリンクは `false` を返し、`Link` に任せます。
   */
  navigate: (href: string, options: { scroll: boolean }) => boolean;
}

export const NavigationShellContext = createContext<NavigationShellValue | null>(null);

export function useNavigationShell(): NavigationShellValue | null {
  return useContext(NavigationShellContext);
}
