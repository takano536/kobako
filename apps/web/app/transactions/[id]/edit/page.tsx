import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getTransaction, listAccounts, listCategories } from '@kobako/db';

import { getCurrentHouseholdId, getLedgerDatabase } from '../../../../src/lib/ledger-data';
import { parseInt4Id } from '../../../../src/lib/ids';
import { DeleteTransactionForm, TransactionForm } from '../../transaction-form';
import { updateTransactionAction } from '../../actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: '取引を編集',
};

export default async function EditTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idText } = await params;
  const id = parseInt4Id(idText);
  if (id === undefined) {
    notFound();
  }

  const db = getLedgerDatabase();
  const householdId = getCurrentHouseholdId();
  const [transaction, categories, accounts] = await Promise.all([
    getTransaction(db, householdId, id),
    listCategories(db, householdId),
    listAccounts(db, householdId),
  ]);
  if (!transaction) {
    notFound();
  }

  const action = updateTransactionAction.bind(null, idText, 'transaction');
  return (
    <div className="content-stack content-narrow form-page">
      <section className="page-heading" aria-labelledby="edit-transaction-title">
        <h1 id="edit-transaction-title">取引を編集</h1>
        <Link
          className="text-link"
          href={`/transactions?month=${transaction.occurredOn.slice(0, 7)}`}
        >
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
              type: transaction.type,
              amount: String(transaction.amount),
              occurredOn: transaction.occurredOn,
              categoryId: String(transaction.categoryId),
              fromAccountId: '',
              toAccountId: '',
              memo: transaction.memo,
            }}
            submitLabel="変更を保存"
          />
          <DeleteTransactionForm transactionId={transaction.id} />
        </div>
      </section>
    </div>
  );
}
