import type { ListedTransfer } from '@kobako/db';

import { formatYen } from '../../src/lib/format';

export function TransferRow({
  transfer,
  showMemo = false,
  dateHeading,
}: {
  transfer: ListedTransfer;
  showMemo?: boolean;
  dateHeading?: string;
}) {
  return (
    <li className="transaction-row transaction-transfer-row">
      {dateHeading ? <h3 className="transaction-group-heading">{dateHeading}</h3> : null}
      <div className="transaction-transfer">
        <span className="transaction-transfer-label">振替</span>
        <span className="transaction-main">
          <span className="transaction-category">
            {transfer.fromAccountName}
            <span className="sr-only">から </span>
            <span aria-hidden="true"> → </span>
            {transfer.toAccountName}
            <span className="sr-only"> へ</span>
          </span>
          {showMemo && transfer.memo ? (
            <span className="transaction-memo" title={transfer.memo}>
              {transfer.memo}
            </span>
          ) : null}
        </span>
        <span className="record-amount neutral">{formatYen(transfer.amount)}</span>
      </div>
    </li>
  );
}
