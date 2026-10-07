import Link from 'next/link';

import { formatYen } from '../../src/lib/format';

type AccountKind = 'cash' | 'bank' | 'credit_card' | 'debit_card' | 'electronic_money' | 'other';

interface PaymentSchedule {
  scheduledAmount: string | null;
  balanceAmount: string | null;
  balanceLabel?: string;
}

interface AccountBalanceRowProps {
  accountName: string;
  balance: string;
  kind: AccountKind;
  transactionsHref: string;
  paymentSchedule?: PaymentSchedule;
}

type MoneyTone = 'positive' | 'negative' | 'neutral';

function isLiability(kind: AccountKind, rawBalance: bigint): boolean {
  return kind === 'credit_card' || (kind === 'other' && rawBalance < 0n);
}

function toneForAmount(value: string, debt: boolean): MoneyTone {
  const amount = BigInt(value);
  if (amount === 0n) return 'neutral';
  if (debt) return amount > 0n ? 'negative' : 'positive';
  return amount < 0n ? 'negative' : 'positive';
}

function SemanticYen({ value, tone }: { value: string; tone: MoneyTone }) {
  const amount = BigInt(value);
  const negative = amount < 0n;
  const absoluteValue = (negative ? -amount : amount).toString();
  return (
    <span className={`money-amount money-${tone}`}>
      {negative ? <span className="sr-only">マイナス</span> : null}
      <span aria-hidden="true">{negative ? '−' : ''}</span>
      {formatYen(absoluteValue)}
    </span>
  );
}

function BalanceMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | null;
  tone: MoneyTone;
}) {
  const showContext = label === '利用残高';
  return (
    <div
      className={`balance-metric${showContext ? ' balance-metric-with-context' : ''}`}
      role="group"
      aria-label={label}
    >
      {showContext ? <span className="balance-metric-context">{label}</span> : null}
      {value === null ? (
        <span className="balance-amount balance-metric-unknown" aria-label={`${label}不明`}>
          —
        </span>
      ) : (
        <span className="balance-amount">
          <SemanticYen value={value} tone={tone} />
        </span>
      )}
    </div>
  );
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
  const hasPaymentMetrics =
    paymentSchedule !== undefined && (kind === 'bank' || kind === 'credit_card');
  return (
    <li className={`balance-row${hasPaymentMetrics ? ' balance-row-with-metrics' : ''}`}>
      <Link className="balance-account-link" href={transactionsHref}>
        <span className="balance-account-name">{accountName}</span>
      </Link>
      {paymentSchedule && hasPaymentMetrics ? (
        <div className="balance-row-metrics">
          <BalanceMetric
            label="支払予定"
            value={paymentSchedule.scheduledAmount}
            tone={toneForAmount(
              paymentSchedule.scheduledAmount ?? '0',
              kind === 'bank' || kind === 'credit_card',
            )}
          />
          <BalanceMetric
            label={kind === 'bank' ? '残高' : (paymentSchedule.balanceLabel ?? '未請求')}
            value={paymentSchedule.balanceAmount}
            tone={
              paymentSchedule.balanceAmount === null
                ? 'neutral'
                : toneForAmount(paymentSchedule.balanceAmount, kind === 'credit_card')
            }
          />
        </div>
      ) : (
        <span className="balance-amount" aria-label="残高">
          <SemanticYen
            value={displayBalance.toString()}
            tone={
              displayBalance === 0n
                ? 'neutral'
                : kind === 'credit_card' && displayBalance < 0n
                  ? 'positive'
                  : liability
                    ? 'negative'
                    : 'positive'
            }
          />
        </span>
      )}
    </li>
  );
}
