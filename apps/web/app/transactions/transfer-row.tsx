import type { ListedTransfer } from '@kobako/db';
import { PrefetchLink } from '../_components/prefetch-link';
import transactionStyles from './transaction-row.module.css';
import uiStyles from '../_components/ui.module.css';

import { formatJapaneseDate, formatYen } from '../../src/lib/format';
import { withSelectedMonth } from '../../src/lib/month-navigation';

const neutralMoneyClass = uiStyles['money-neutral'] ?? '';

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
  const label = `${formatJapaneseDate(transfer.occurredOn)} 振替 ${transfer.fromAccountName}から${transfer.toAccountName}へ ${formatYen(transfer.amount)}${transfer.origin === 'api' ? ' API' : ''}`;
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
        data-slot="transaction-link"
        className={transactionStyles['transaction-link']}
        href={editHref}
        aria-label={label}
      >
        <span
          data-slot="category-dot"
          className={transactionStyles['transfer-dot']}
          aria-hidden="true"
        />
        <span
          data-slot="transaction-category"
          className={[
            transactionStyles['transaction-category'],
            transactionStyles['transfer-type'],
          ].join(' ')}
        >
          振替
        </span>
        <span
          data-slot="transaction-main-transfer"
          className={[
            transactionStyles['transaction-main'],
            transactionStyles['transaction-main-transfer'],
          ].join(' ')}
        >
          <span data-slot="transfer-category" className={transactionStyles['transfer-category']}>
            <span data-slot="transfer-account" className={transactionStyles['transfer-account']}>
              <span>{transfer.fromAccountName}</span>
            </span>
            <span
              data-slot="transfer-destination"
              className={transactionStyles['transfer-destination']}
            >
              <span
                data-slot="transfer-arrow"
                className={transactionStyles['transfer-arrow']}
                aria-hidden="true"
              >
                →
              </span>
              <span data-slot="transfer-account" className={transactionStyles['transfer-account']}>
                <span>{transfer.toAccountName}</span>
              </span>
            </span>
            {transfer.origin === 'api' ? (
              <span
                data-slot="origin-badge"
                className={transactionStyles['origin-badge']}
                aria-hidden="true"
              >
                API
              </span>
            ) : null}
          </span>
          {showMemo && transfer.memo ? (
            <span
              data-slot="transaction-memo"
              className={transactionStyles['transaction-memo']}
              title={transfer.memo}
            >
              {transfer.memo}
            </span>
          ) : null}
        </span>
        <span
          className={[transactionStyles['record-amount'], neutralMoneyClass].join(' ')}
          data-slot="record-amount"
          data-tone="neutral"
        >
          {formatYen(transfer.amount)}
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
