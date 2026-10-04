import Link from 'next/link';

import { SignedYen } from '../_components/ui';
import { formatYen } from '../../src/lib/format';

interface AccountBalanceRowProps {
  accountName: string;
  balance: string;
  kind: 'cash' | 'bank' | 'credit_card' | 'electronic_money' | 'other';
  status: 'active' | 'closed';
  transactionsHref: string;
}

function isLiability(kind: AccountBalanceRowProps['kind'], rawBalance: bigint): boolean {
  return kind === 'credit_card' || (kind === 'other' && rawBalance < 0n);
}

function balanceClassification(
  kind: AccountBalanceRowProps['kind'],
  rawBalance: bigint,
): '資産' | '負債' | '分類なし' {
  if (kind === 'other' && rawBalance === 0n) {
    return '分類なし';
  }
  return isLiability(kind, rawBalance) ? '負債' : '資産';
}

export function AccountBalanceRow({
  accountName,
  balance,
  kind,
  status,
  transactionsHref,
}: AccountBalanceRowProps) {
  const rawBalance = BigInt(balance);
  const liability = isLiability(kind, rawBalance);
  const displayBalance = kind === 'credit_card' ? -rawBalance : rawBalance;
  const overpaid = kind === 'credit_card' && rawBalance > 0n;
  const classification = balanceClassification(kind, rawBalance);
  const classificationExplanation =
    classification === '分類なし'
      ? 'その他の口座は残高の符号で資産・負債を判定。0円のため集計対象外'
      : classification;
  const displayLabel = formatYen(displayBalance.toString());
  const rawLabel = formatYen(rawBalance.toString());
  const amountTone = overpaid ? 'positive' : liability ? 'negative' : 'positive';
  const amountAriaLabel = overpaid
    ? `過払い残高 ${displayLabel}（元帳残高 ${rawLabel}）`
    : liability
      ? `負債残高 ${displayLabel}（元帳残高 ${rawLabel}）`
      : `資産残高 ${displayLabel}`;
  return (
    <li className="balance-row">
      <Link className="balance-account-link" href={transactionsHref}>
        <span className="balance-account-name">{accountName}</span>
        <span
          className="balance-account-badge balance-classification-badge"
          title={classificationExplanation}
          aria-label={classificationExplanation}
        >
          {classification}
        </span>
        {overpaid ? (
          <span
            className="balance-account-badge balance-overpaid-badge"
            title="カード残高がプラスのため過払いです"
            aria-label="過払い"
          >
            過払い
          </span>
        ) : null}
        {status === 'closed' ? <span className="balance-account-badge">利用終了</span> : null}
      </Link>
      <span
        className={`balance-amount${overpaid ? ' balance-account-overpaid' : ''}`}
        aria-label={amountAriaLabel}
      >
        <span className="balance-account-primary">
          <SignedYen value={displayBalance.toString()} tone={amountTone} />
        </span>
        {liability ? <span className="balance-account-raw">元帳 {rawLabel}</span> : null}
      </span>
    </li>
  );
}
