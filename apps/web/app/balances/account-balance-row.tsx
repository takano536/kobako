import Link from 'next/link';
import type { CardBillingSummary } from '@kobako/db';

import { formatJapaneseDateWithYear } from '../../src/lib/format';
import { SignedYen } from '../_components/ui';

interface AccountBalanceRowProps {
  accountId: number;
  accountName: string;
  balance: string;
  kind: 'cash' | 'bank' | 'credit_card' | 'debit_card' | 'electronic_money' | 'other';
  transactionsHref: string;
  billingSummary?: CardBillingSummary;
}

function isLiability(kind: AccountBalanceRowProps['kind'], rawBalance: bigint): boolean {
  return kind === 'credit_card' || (kind === 'other' && rawBalance < 0n);
}

export function AccountBalanceRow({
  accountId,
  accountName,
  balance,
  kind,
  transactionsHref,
  billingSummary,
}: AccountBalanceRowProps) {
  const rawBalance = BigInt(balance);
  const liability = isLiability(kind, rawBalance);
  const displayBalance = kind === 'credit_card' ? -rawBalance : rawBalance;
  const billingUnavailable =
    billingSummary === undefined ||
    !billingSummary.settingsComplete ||
    billingSummary.calendarError !== null;
  const payment = kind !== 'credit_card' || billingUnavailable ? null : billingSummary?.nextPayment;
  return (
    <li className="balance-row">
      <Link className="balance-account-link" href={transactionsHref}>
        <span className="balance-account-name">{accountName}</span>
      </Link>
      <div className="balance-row-metrics">
        <span className="balance-amount" aria-label="残高">
          <SignedYen value={displayBalance.toString()} tone={liability ? 'negative' : 'positive'} />
        </span>
        {kind === 'credit_card' ? (
          !billingUnavailable ? (
            payment ? (
              <span className="balance-next-payment" aria-label="次回支払">
                次回支払：{formatJapaneseDateWithYear(payment.dueOn)}・
                <SignedYen value={payment.amount} tone="neutral" />
              </span>
            ) : null
          ) : (
            <Link className="balance-settings-link" href={`/accounts/${accountId}/edit`}>
              設定
            </Link>
          )
        ) : null}
      </div>
    </li>
  );
}
