import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getTransfer, listAccounts, listCategories } from '@kobako/db';

import { getCurrentHouseholdId, getLedgerDatabase } from '../../../../../src/lib/ledger-data';
import { parseInt4Id } from '../../../../../src/lib/ids';
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
    <div className="content-stack content-narrow form-page">
      <section className="page-heading" aria-labelledby="edit-transfer-title">
        <h1 id="edit-transfer-title">取引を編集</h1>
        <Link className="text-link" href={`/transactions?month=${transfer.occurredOn.slice(0, 7)}`}>
          一覧へ戻る
        </Link>
      </section>
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
    </div>
  );
}
