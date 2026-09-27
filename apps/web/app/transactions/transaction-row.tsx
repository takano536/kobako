import Link from 'next/link';

import type { ListedTransaction } from '@kobako/db';

import { formatYen } from '../../src/lib/format';

function typeLabel(type: ListedTransaction['type']): string {
  return type === 'income' ? '収入' : '支出';
}

export function TransactionRow({
  transaction,
  showMemo = false,
}: {
  transaction: ListedTransaction;
  showMemo?: boolean;
}) {
  return (
    <li>
      <Link className="transaction-row" href={`/transactions/${transaction.id}/edit`}>
        <span className="transaction-date">
          <time dateTime={transaction.occurredOn}>{transaction.occurredOn}</time>
          <span>{transaction.categoryName}</span>
          {showMemo && transaction.memo ? (
            <span className="transaction-memo">{transaction.memo}</span>
          ) : null}
        </span>
        <span className={`transaction-amount ${transaction.type}`}>
          {typeLabel(transaction.type)} {transaction.type === 'income' ? '+' : '-'}{' '}
          {formatYen(transaction.amount)}
        </span>
      </Link>
    </li>
  );
}
