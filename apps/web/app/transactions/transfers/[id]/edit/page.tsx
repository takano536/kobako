import { notFound } from 'next/navigation';

import { getTransfer, listAccounts, listCategories } from '@kobako/db';

import { getCurrentHouseholdId, getLedgerDatabase } from '../../../../../src/lib/ledger-data';
import { parseInt4Id } from '../../../../../src/lib/ids';
import { ActionLink, PageHeader, PageShell } from '../../../../_components/ui';
import { DeleteTransactionForm, TransactionForm } from '../../../transaction-form';
import { updateTransactionAction } from '../../../actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: '取引を編集',
};

export default async function EditTransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idText } = await params;
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
  return (
    <PageShell width="narrow">
      <PageHeader
        title="取引を編集"
        actions={
          <ActionLink
            href={`/transactions?month=${transfer.occurredOn.slice(0, 7)}`}
            variant="back"
          >
            一覧へ戻る
          </ActionLink>
        }
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
              fromAccountId: String(transfer.fromAccountId),
              toAccountId: String(transfer.toAccountId),
              memo: transfer.memo,
            }}
            submitLabel="変更を保存"
          />
          <DeleteTransactionForm transactionId={transfer.id} entryType="transfer" />
        </div>
      </section>
    </PageShell>
  );
}
