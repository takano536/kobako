import Link from 'next/link';

import type { ListedTransfer } from '@kobako/db';

import { formatJapaneseDate, formatYen, moneyToneClass } from '../../src/lib/format';
import { withSelectedMonth } from '../../src/lib/month-navigation';

function transferEditHref(transferId: number, selectedMonth: string | null | undefined): string {
  return withSelectedMonth(`/transactions/transfers/${transferId}/edit`, selectedMonth);
}

export function TransferRow({
  transfer,
  showMemo = false,
  dateHeading,
  selectedMonth,
}: {
  transfer: ListedTransfer;
  showMemo?: boolean;
  dateHeading?: string;
  selectedMonth?: string | null;
}) {
  const editHref = transferEditHref(transfer.id, selectedMonth);
  const label = `${formatJapaneseDate(transfer.occurredOn)} 振替 ${transfer.fromAccountName}から${transfer.toAccountName}へ ${formatYen(transfer.amount)}`;
  return (
    <li className="transaction-row">
      {dateHeading ? <h3 className="transaction-group-heading">{dateHeading}</h3> : null}
      <Link className="transaction-link" href={editHref} prefetch={false} aria-label={label}>
        <span className="category-dot transfer-dot" aria-hidden="true" />
        <span className="transaction-category transfer-type">振替</span>
        <span className="transaction-main transaction-main-transfer">
          <span className="transfer-category">
            <span className="transfer-account">{transfer.fromAccountName}</span>
            <span className="transfer-destination">
              <span className="transfer-arrow" aria-hidden="true">
                →
              </span>
              <span className="transfer-account">{transfer.toAccountName}</span>
            </span>
          </span>
          {showMemo && transfer.memo ? (
            <span className="transaction-memo" title={transfer.memo}>
              {transfer.memo}
            </span>
          ) : null}
        </span>
        <span className={`record-amount ${moneyToneClass('neutral')}`}>
          {formatYen(transfer.amount)}
        </span>
        <span className="row-affordance" aria-hidden="true">
          ›
        </span>
      </Link>
    </li>
  );
}
