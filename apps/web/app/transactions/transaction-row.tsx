import Link from 'next/link';

import type { ListedTransaction } from '@kobako/db';

import { CategoryDot } from '../../src/lib/category';
import {
  formatJapaneseDate,
  formatTransactionAmount,
  moneyToneClass,
  transactionAmountTone,
} from '../../src/lib/format';
import { withSelectedMonth } from '../../src/lib/month-navigation';

function transactionEditHref(
  transactionId: number,
  selectedMonth: string | null | undefined,
): string {
  return withSelectedMonth(`/transactions/${transactionId}/edit`, selectedMonth);
}

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
  selectedMonth,
}: {
  transaction: ListedTransaction;
  showMemo?: boolean;
  showDate?: boolean;
  dateHeading?: string;
  selectedMonth?: string | null;
}) {
  const editHref = transactionEditHref(transaction.id, selectedMonth);
  const label = transactionLabel(transaction);
  const amountTone = transactionAmountTone(transaction.type, transaction.amount);
  const amount = formatTransactionAmount(transaction.type, transaction.amount);
  if (showDate) {
    return (
      <li className="recent-row">
        <Link className="recent-link" href={editHref} aria-label={label}>
          <span className="recent-copy">
            <CategoryDot type={transaction.type} name={transaction.categoryName} />
            <span className="recent-copy-text">
              <time dateTime={transaction.occurredOn}>
                {formatJapaneseDate(transaction.occurredOn)}
              </time>
              <span>{transaction.categoryName}</span>
            </span>
          </span>
          <span className={`record-amount ${moneyToneClass(amountTone)}`}>{amount}</span>
        </Link>
      </li>
    );
  }

  return (
    <li className="transaction-row">
      {dateHeading ? <h3 className="transaction-group-heading">{dateHeading}</h3> : null}
      <Link className="transaction-link" href={editHref} prefetch={false} aria-label={label}>
        <CategoryDot type={transaction.type} name={transaction.categoryName} />
        <span className="transaction-main">
          <span className="transaction-category">{transaction.categoryName}</span>
          {showMemo && transaction.memo ? (
            <span className="transaction-memo" title={transaction.memo}>
              {transaction.memo}
            </span>
          ) : null}
        </span>
        <span className={`record-amount ${moneyToneClass(amountTone)}`}>{amount}</span>
        <span className="row-affordance" aria-hidden="true">
          ›
        </span>
      </Link>
    </li>
  );
}
