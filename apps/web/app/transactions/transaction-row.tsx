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

function transactionLabel(transaction: ListedTransaction, showMemo: boolean): string {
  const amount = formatTransactionAmount(transaction.type, transaction.amount);
  const details = [
    transaction.accountName,
    showMemo && transaction.memo ? transaction.memo : null,
  ].filter((value): value is string => value !== null);
  return [
    formatJapaneseDate(transaction.occurredOn),
    typeLabel(transaction.type),
    transaction.categoryName,
    ...details,
    amount,
  ].join(' ');
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
  const label = transactionLabel(transaction, showMemo);
  const assetName = transaction.accountName;
  const amountTone = transactionAmountTone(transaction.type, transaction.amount);
  const amount = formatTransactionAmount(transaction.type, transaction.amount);
  if (showDate) {
    return (
      <li className="recent-row">
        <time className="recent-date" dateTime={transaction.occurredOn}>
          {formatJapaneseDate(transaction.occurredOn)}
        </time>
        <Link
          className="transaction-link transaction-link-ordinary"
          href={editHref}
          aria-label={label}
        >
          <CategoryDot type={transaction.type} name={transaction.categoryName} />
          <span className="transaction-category" title={transaction.categoryName}>
            {transaction.categoryName}
          </span>
          <span className="transaction-main">
            {assetName ? (
              <span className="transaction-asset-name" title={assetName}>
                {assetName}
              </span>
            ) : null}
            {showMemo && transaction.memo ? (
              <span className="transaction-memo" title={transaction.memo}>
                {transaction.memo}
              </span>
            ) : null}
          </span>
          <span className={`record-amount ${moneyToneClass(amountTone)}`}>{amount}</span>
        </Link>
      </li>
    );
  }

  return (
    <li className="transaction-row">
      {dateHeading ? <h3 className="transaction-group-heading">{dateHeading}</h3> : null}
      <Link
        className="transaction-link transaction-link-ordinary"
        href={editHref}
        prefetch={false}
        aria-label={label}
      >
        <CategoryDot type={transaction.type} name={transaction.categoryName} />
        <span className="transaction-category" title={transaction.categoryName}>
          {transaction.categoryName}
        </span>
        <span className="transaction-main">
          {assetName ? (
            <span className="transaction-asset-name" title={assetName}>
              {assetName}
            </span>
          ) : null}
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
