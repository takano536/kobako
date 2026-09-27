import Link from 'next/link';

import type { ListedTransaction } from '@kobako/db';

import { CategoryIcon } from '../../src/lib/category';
import { formatJapaneseDate, formatYen } from '../../src/lib/format';

function typeLabel(type: ListedTransaction['type']): string {
  return type === 'income' ? '収入' : '支出';
}

export function TransactionRow({
  transaction,
  showMemo = false,
  showDate = true,
  dateHeading,
}: {
  transaction: ListedTransaction;
  showMemo?: boolean;
  showDate?: boolean;
  dateHeading?: string;
}) {
  return (
    <li className="transaction-list-item">
      {dateHeading ? <h3 className="transaction-group-heading">{dateHeading}</h3> : null}
      <Link className="transaction-row" href={`/transactions/${transaction.id}/edit`}>
        <span className="sr-only">{formatJapaneseDate(transaction.occurredOn)}</span>
        <span className="transaction-leading">
          <CategoryIcon type={transaction.type} name={transaction.categoryName} />
          <span className="transaction-copy">
            {showDate ? (
              <time className="transaction-date" dateTime={transaction.occurredOn}>
                {formatJapaneseDate(transaction.occurredOn)}
              </time>
            ) : null}
            <span className="transaction-category">{transaction.categoryName}</span>
            {showMemo && transaction.memo ? (
              <span className="transaction-memo" title={transaction.memo}>
                {transaction.memo}
              </span>
            ) : null}
          </span>
        </span>
        <span className={`transaction-amount ${transaction.type}`}>
          <span className="sr-only">{typeLabel(transaction.type)}</span>
          <span aria-hidden="true">{transaction.type === 'income' ? '＋' : '−'}</span>
          {formatYen(transaction.amount)}
        </span>
      </Link>
    </li>
  );
}
