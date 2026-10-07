import Link from 'next/link';

import { FitAmount } from './fit-amount';
import { formatYen } from '../../src/lib/format';

type AccountKind = 'cash' | 'bank' | 'credit_card' | 'debit_card' | 'electronic_money' | 'other';

interface PaymentSchedule {
  primaryAmount: string | null;
  secondaryAmount: string | null;
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
  return (
    <div className="balance-metric" role="group" aria-label={label}>
      {value === null ? (
        <FitAmount className="balance-amount balance-metric-unknown" ariaLabel={`${label}不明`}>
          —
        </FitAmount>
      ) : (
        <FitAmount className="balance-amount">
          <SemanticYen value={value} tone={tone} />
        </FitAmount>
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
            label={kind === 'credit_card' ? '未決済残高' : '支払予定'}
            value={paymentSchedule.primaryAmount}
            tone={toneForAmount(
              paymentSchedule.primaryAmount ?? '0',
              kind === 'bank' || kind === 'credit_card',
            )}
          />
          <BalanceMetric
            label={kind === 'credit_card' ? '未請求' : '残高'}
            value={paymentSchedule.secondaryAmount}
            tone={
              paymentSchedule.secondaryAmount === null
                ? 'neutral'
                : toneForAmount(paymentSchedule.secondaryAmount, kind === 'credit_card')
            }
          />
        </div>
      ) : (
        <FitAmount className="balance-amount" ariaLabel="残高">
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
        </FitAmount>
      )}
    </li>
  );
}
