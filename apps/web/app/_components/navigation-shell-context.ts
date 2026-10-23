'use client';

import { createContext, useContext } from 'react';

export interface NavigationShellValue {
  /**
   * 引き受けた遷移が確定するまでの遷移先の pathname です。タップしたリンクをすぐ現在地として
   * 表示するために使います。遷移が確定した後、中断された後は `null` です。
   */
  navigatingTo: string | null;
  /**
   * 別の本文ページへ移るときに遷移を引き受け、`true` を返します。
   * 同じ画面内の月・条件の変更やカードを開くリンクは `false` を返し、`Link` に任せます。
   */
  navigate: (href: string, options: { scroll: boolean }) => boolean;
  /** `navigate` が引き受ける遷移先かどうかです（先読みの要否の判断に使います）。 */
  handles: (href: string) => boolean;
  /** 履歴移動や Link に任せる遷移に操作が移ったとき、待機先とフィードバックを破棄します。 */
  cancel: () => void;
}

export const NavigationShellContext = createContext<NavigationShellValue | null>(null);

export function useNavigationShell(): NavigationShellValue | null {
  return useContext(NavigationShellContext);
}
