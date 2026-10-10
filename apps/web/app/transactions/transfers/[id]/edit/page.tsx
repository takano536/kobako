import { notFound } from 'next/navigation';

import { getTransfer, listAccounts, listCategories } from '@kobako/db';

import { getCurrentHouseholdId, getLedgerDatabase } from '../../../../../src/lib/ledger-data';
import { withSelectedMonth } from '../../../../../src/lib/month-navigation';
import { parseInt4Id } from '../../../../../src/lib/ids';
import { firstQueryValue, isValidMonth } from '../../../../../src/lib/transaction-query';
import { PageHeader, PageShell } from '../../../../_components/ui';
import { DeleteTransactionForm, TransactionForm } from '../../../transaction-form';
import { updateTransactionAction } from '../../../actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: '取引を編集',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export default async function EditTransferPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id: idText } = await params;
  const query = await searchParams;
  const id = parseInt4Id(idText);
  if (id === undefined) {
    notFound();
  }

  const db = getLedgerDatabase();
  const householdId = getCurrentHouseholdId();
  const [transfer, accounts, categories] = await Promise.all([
    getTransfer(db, householdId, id),
    listAccounts(db, householdId),
    listCategories(db, householdId),
  ]);
  if (!transfer) {
    notFound();
  }

  const action = updateTransactionAction.bind(null, idText, 'transfer');
  const selectedMonth = firstQueryValue(query.month);
  const backHref =
    selectedMonth && isValidMonth(selectedMonth)
      ? withSelectedMonth('/transactions', selectedMonth)
      : withSelectedMonth('/transactions', transfer.occurredOn.slice(0, 7));
  const cancelHref = withSelectedMonth(
    `/transactions/transfers/${transfer.id}/edit`,
    selectedMonth,
  );
  return (
    <PageShell width="narrow">
      <PageHeader
        title="取引を編集"
        titleAriaLabel="取引を編集"
        backLink={{ href: backHref, label: '一覧へ戻る' }}
      />
      <section className="form-surface" aria-label="取引の入力">
        <div className="edit-form-layout">
          <TransactionForm
            action={action}
            categories={categories}
            accounts={accounts}
            initialValues={{
              type: 'transfer',
              amount: String(transfer.amount),
              occurredOn: transfer.occurredOn,
              categoryId: '',
              accountId: '',
              fromAccountId: String(transfer.fromAccountId),
              toAccountId: String(transfer.toAccountId),
              memo: transfer.memo,
            }}
            submitLabel="変更を保存"
          />
          <DeleteTransactionForm
            transactionId={transfer.id}
            entryType="transfer"
            cancelHref={cancelHref}
          />
        </div>
      </section>
    </PageShell>
  );
}
