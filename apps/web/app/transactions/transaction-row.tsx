import Link from 'next/link';

import type { ListedTransaction } from '@kobako/db';

import { CategoryDot } from '../../src/lib/category';
import {
  formatJapaneseDate,
  formatTransactionAmount,
  transactionAmountTone,
} from '../../src/lib/format';

function typeLabel(type: ListedTransaction['type']): string {
  return type === 'income' ? '収入' : '支出';
}

function transactionLabel(transaction: ListedTransaction): string {
  const amount = formatTransactionAmount(transaction.type, transaction.amount);
  return `${formatJapaneseDate(transaction.occurredOn)} ${typeLabel(transaction.type)} ${transaction.categoryName} ${amount}`;
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
  const label = transactionLabel(transaction);
  const amountTone = transactionAmountTone(transaction.type, transaction.amount);
  const amount = formatTransactionAmount(transaction.type, transaction.amount);
  if (showDate) {
    return (
      <li className="recent-row">
        <Link
          className="recent-link"
          href={`/transactions/${transaction.id}/edit`}
          aria-label={label}
        >
          <span className="recent-copy">
            <CategoryDot type={transaction.type} name={transaction.categoryName} />
            <span className="recent-copy-text">
              <time dateTime={transaction.occurredOn}>
                {formatJapaneseDate(transaction.occurredOn)}
              </time>
              <span>{transaction.categoryName}</span>
            </span>
          </span>
          <span className={`record-amount ${amountTone}`}>{amount}</span>
        </Link>
      </li>
    );
  }

  return (
    <li className="transaction-row">
      {dateHeading ? <h3 className="transaction-group-heading">{dateHeading}</h3> : null}
      <Link
        className="transaction-link"
        href={`/transactions/${transaction.id}/edit`}
        aria-label={label}
      >
        <CategoryDot type={transaction.type} name={transaction.categoryName} />
        <span className="transaction-main">
          <span className="transaction-category">{transaction.categoryName}</span>
          {showMemo && transaction.memo ? (
            <span className="transaction-memo" title={transaction.memo}>
              {transaction.memo}
            </span>
          ) : null}
        </span>
        <span className={`record-amount ${amountTone}`}>{amount}</span>
        <span className="row-affordance" aria-hidden="true">
          ›
        </span>
      </Link>
    </li>
  );
}
