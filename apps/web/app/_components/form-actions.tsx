'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import styles from './form-actions.module.css';
import { Button } from './button';

/**
 * フォームの送信操作を一か所で組み立てる。キャンセルはカードを開いた元の画面へ戻る。
 */
export function FormActions({
  showCancel = false,
  children,
}: {
  showCancel?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <div className={styles.actions} data-with-cancel={showCancel}>
      {showCancel ? (
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          キャンセル
        </Button>
      ) : null}
      {children}
    </div>
  );
}
