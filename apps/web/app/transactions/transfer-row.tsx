import Link from 'next/link';

import type { ListedTransfer } from '@kobako/db';

import { formatJapaneseDate, formatYen } from '../../src/lib/format';

export function TransferRow({
  transfer,
  showMemo = false,
  dateHeading,
}: {
  transfer: ListedTransfer;
  showMemo?: boolean;
  dateHeading?: string;
}) {
  const label = `${formatJapaneseDate(transfer.occurredOn)} 振替 ${transfer.fromAccountName}から${transfer.toAccountName}へ ${formatYen(transfer.amount)}`;
  return (
    <li className="transaction-row">
      {dateHeading ? <h3 className="transaction-group-heading">{dateHeading}</h3> : null}
      <Link
        className="transaction-link"
        href={`/transactions/transfers/${transfer.id}/edit`}
        aria-label={label}
      >
        <span className="category-dot transfer-dot" aria-hidden="true" />
        <span className="transaction-main">
          <span className="transaction-category transfer-category">
            {transfer.fromAccountName} <span aria-hidden="true">→</span> {transfer.toAccountName}
          </span>
          {showMemo && transfer.memo ? (
            <span className="transaction-memo" title={transfer.memo}>
              {transfer.memo}
            </span>
          ) : null}
        </span>
        <span className="record-amount neutral">{formatYen(transfer.amount)}</span>
        <span className="row-affordance" aria-hidden="true">
          ›
        </span>
      </Link>
    </li>
  );
}
