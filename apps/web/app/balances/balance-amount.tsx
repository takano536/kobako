import type { ReactNode } from 'react';

import balanceStyles from './balances.module.css';

interface BalanceAmountProps {
  children: ReactNode;
  className: string;
  ariaLabel?: string;
}

interface BalanceAmountTextProps {
  children: ReactNode;
  className: string;
}

export function BalanceAmountText({ children, className }: BalanceAmountTextProps) {
  return (
    <span data-slot="balance-account-name" className={className}>
      {children}
    </span>
  );
}

export function BalanceAmount({ children, className, ariaLabel }: BalanceAmountProps) {
  return (
    <span data-slot="balance-amount" className={className} aria-label={ariaLabel}>
      <span data-slot="balance-amount-content" className={balanceStyles['balance-amount-content']}>
        {children}
      </span>
    </span>
  );
}
