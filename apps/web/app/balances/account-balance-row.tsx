import Link from 'next/link';

import { formatJapaneseDate } from '../../src/lib/format';
import { SignedYen } from '../_components/ui';

interface PaymentSchedule {
  amount?: string;
  dueOn?: string;
  balanceAmount?: string;
  settingsHref?: string;
}

interface AccountBalanceRowProps {
  accountName: string;
  balance: string;
  kind: 'cash' | 'bank' | 'credit_card' | 'debit_card' | 'electronic_money' | 'other';
  transactionsHref: string;
  paymentSchedule?: PaymentSchedule;
}

function isLiability(kind: AccountBalanceRowProps['kind'], rawBalance: bigint): boolean {
  return kind === 'credit_card' || (kind === 'other' && rawBalance < 0n);
}

export function AccountBalanceRow({
  accountName,
  balance,
  kind,
  transactionsHref,
  paymentSchedule,
}: AccountBalanceRowProps) {
  const rawBalance = BigInt(balance);
  const liability = isLiability(kind, rawBalance);
  const displayBalance = kind === 'credit_card' ? -rawBalance : rawBalance;
  return (
    <li className="balance-row">
      <Link className="balance-account-link" href={transactionsHref}>
        <span className="balance-account-name">{accountName}</span>
      </Link>
      <div className="balance-row-metrics">
        <span className="balance-schedule" aria-label={paymentSchedule ? '決済予定' : undefined}>
          {paymentSchedule?.settingsHref ? (
            <Link className="balance-settings-link" href={paymentSchedule.settingsHref}>
              設定を確認
            </Link>
          ) : paymentSchedule?.amount !== undefined ? (
            <>
              <span className="balance-schedule-amount">
                <SignedYen value={paymentSchedule.amount} tone="neutral" />
              </span>
              {paymentSchedule.dueOn ? (
                <span className="balance-schedule-due">
                  支払日 {formatJapaneseDate(paymentSchedule.dueOn)}
                </span>
              ) : null}
            </>
          ) : null}
        </span>
        <span
          className="balance-amount"
          aria-label={paymentSchedule?.balanceAmount !== undefined ? '未決済額' : '残高'}
        >
          <SignedYen
            value={(paymentSchedule?.balanceAmount ?? displayBalance).toString()}
            tone={liability ? 'negative' : 'positive'}
          />
        </span>
      </div>
    </li>
  );
}
