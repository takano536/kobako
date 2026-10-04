import Link from 'next/link';

import { SignedYen } from '../_components/ui';

interface AccountBalanceRowProps {
  accountName: string;
  balance: string;
  kind: 'cash' | 'bank' | 'credit_card' | 'debit_card' | 'electronic_money' | 'other';
  transactionsHref: string;
}

function isLiability(kind: AccountBalanceRowProps['kind'], rawBalance: bigint): boolean {
  return kind === 'credit_card' || (kind === 'other' && rawBalance < 0n);
}

export function AccountBalanceRow({
  accountName,
  balance,
  kind,
  transactionsHref,
}: AccountBalanceRowProps) {
  const rawBalance = BigInt(balance);
  const liability = isLiability(kind, rawBalance);
  const displayBalance = kind === 'credit_card' ? -rawBalance : rawBalance;
  return (
    <li className="balance-row">
      <Link className="balance-account-link" href={transactionsHref}>
        <span className="balance-account-name">{accountName}</span>
      </Link>
      <span className="balance-amount" aria-label="残高">
        <SignedYen value={displayBalance.toString()} tone={liability ? 'negative' : 'positive'} />
      </span>
    </li>
  );
}
