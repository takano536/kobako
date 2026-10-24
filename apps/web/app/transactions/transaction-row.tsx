import type { ListedTransaction } from '@kobako/db';
import { PrefetchLink } from '../_components/prefetch-link';
import transactionStyles from './transaction-row.module.css';
import uiStyles from '../_components/ui.module.css';

import { CategoryDot } from '../../src/lib/category';
import {
  formatJapaneseDate,
  formatTransactionAmount,
  moneyToneClass,
  transactionAmountTone,
} from '../../src/lib/format';
import { withSelectedMonth } from '../../src/lib/month-navigation';

const moneyToneStyles: Record<string, string> = {
  'money-amount money-neutral': uiStyles['money-neutral'] ?? '',
  'money-amount money-positive': uiStyles['money-positive'] ?? '',
  'money-amount money-negative': uiStyles['money-negative'] ?? '',
};

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
    transaction.origin === 'api' ? 'API' : null,
    ...details,
    amount,
  ].filter((value): value is string => value !== null).join(' ');
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
  const amountClassName = [
    transactionStyles['record-amount'],
    moneyToneStyles[moneyToneClass(amountTone)],
  ].join(' ');

  if (showDate) {
    return (
      <li data-slot="transaction-row" className={transactionStyles['recent-row']}>
        <time
          data-slot="transaction-date"
          className={transactionStyles['recent-date']}
          dateTime={transaction.occurredOn}
        >
          {formatJapaneseDate(transaction.occurredOn)}
        </time>
        <PrefetchLink
          className={[
            transactionStyles['transaction-link'],
            transactionStyles['transaction-link-ordinary'],
          ].join(' ')}
          data-slot="transaction-link"
          href={editHref}
          aria-label={label}
          scroll={false}
        >
          <span className={transactionStyles['transaction-category-cell']}>
            <CategoryDot type={transaction.type} name={transaction.categoryName} />
            <span
              data-slot="transaction-category"
              className={transactionStyles['transaction-category']}
              title={transaction.categoryName}
            >
              {transaction.categoryName}
            </span>
            {transaction.origin === 'api' ? (
              <span
                data-slot="origin-badge"
                className={transactionStyles['origin-badge']}
                aria-hidden="true"
              >
                API
              </span>
            ) : null}
          </span>
          <span data-slot="transaction-main" className={transactionStyles['transaction-main']}>
            {assetName ? (
              <span
                data-slot="transaction-asset-name"
                className={transactionStyles['transaction-asset-name']}
                title={assetName}
              >
                {assetName}
              </span>
            ) : null}
            {showMemo && transaction.memo ? (
              <span
                data-slot="transaction-memo"
                className={transactionStyles['transaction-memo']}
                title={transaction.memo}
              >
                {transaction.memo}
              </span>
            ) : null}
          </span>
          <span className={amountClassName} data-slot="record-amount">
            {amount}
          </span>
        </PrefetchLink>
      </li>
    );
  }

  return (
    <li data-slot="transaction-row" className={transactionStyles['transaction-row']}>
      {dateHeading ? (
        <h3
          data-slot="transaction-group-heading"
          className={transactionStyles['transaction-group-heading']}
        >
          {dateHeading}
        </h3>
      ) : null}
      <PrefetchLink
        className={[
          transactionStyles['transaction-link'],
          transactionStyles['transaction-link-ordinary'],
        ].join(' ')}
        data-slot="transaction-link"
        href={editHref}
        scroll={false}
        aria-label={label}
      >
        <span className={transactionStyles['transaction-category-cell']}>
          <CategoryDot type={transaction.type} name={transaction.categoryName} />
          <span
            data-slot="transaction-category"
            className={transactionStyles['transaction-category']}
            title={transaction.categoryName}
          >
            {transaction.categoryName}
          </span>
          {transaction.origin === 'api' ? (
              <span
                data-slot="origin-badge"
                className={transactionStyles['origin-badge']}
                aria-hidden="true"
              >
                API
              </span>
            ) : null}
        </span>
        <span data-slot="transaction-main" className={transactionStyles['transaction-main']}>
          {assetName ? (
            <span
              data-slot="transaction-asset-name"
              className={transactionStyles['transaction-asset-name']}
              title={assetName}
            >
              {assetName}
            </span>
          ) : null}
          {showMemo && transaction.memo ? (
            <span
              data-slot="transaction-memo"
              className={transactionStyles['transaction-memo']}
              title={transaction.memo}
            >
              {transaction.memo}
            </span>
          ) : null}
        </span>
        <span className={amountClassName} data-slot="record-amount">
          {amount}
        </span>
        <span
          data-slot="row-affordance"
          className={transactionStyles['row-affordance']}
          aria-hidden="true"
        >
          ›
        </span>
      </PrefetchLink>
    </li>
  );
}
