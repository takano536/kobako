'use client';

import { createContext, useContext } from 'react';

export interface NavigationShellValue {
  /**
   * 引き受けた遷移が確定するまでの行き先です。タップしたリンクをすぐ現在地として表示し、
   * 遷移先の外枠を出すために使います。遷移が確定した後、中断された後は `null` です。
   */
  pending: { pathname: string; month: string | null; search: string } | null;
  /** 引き受け中の遷移先の月（`YYYY-MM`）です。月の切り替えの表示に使います。 */
  pendingMonth: string | null;
  /** 画面に出ている本文の月（`YYYY-MM`）です。遷移が確定するたびに更新します。 */
  committedMonth: string | null;
  /** 画面に出ている本文の検索条件（`?` を含む）です。遷移が確定するたびに更新します。 */
  committedSearch: string;
  /**
   * 別の本文へ移るときに遷移を引き受け、`true` を返します。同じ画面の月の切り替えと、
   * 同じ画面の絞り込みの変更も含みます。カードを開くリンクは `false` を返し、`Link` に任せます。
   * `replace` を立てると履歴を増やさずに置き換えます（絞り込みの変更に使います）。
   */
  navigate: (href: string, options: { scroll: boolean; replace?: boolean }) => boolean;
  /** `navigate` が引き受ける遷移先かどうかです（先読みの要否の判断に使います）。 */
  handles: (href: string) => boolean;
  /** 履歴移動や Link に任せる遷移に操作が移ったとき、待機先とフィードバックを破棄します。 */
  cancel: () => void;
}

export const NavigationShellContext = createContext<NavigationShellValue | null>(null);

export function useNavigationShell(): NavigationShellValue | null {
  return useContext(NavigationShellContext);
}
