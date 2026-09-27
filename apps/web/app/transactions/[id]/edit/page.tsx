import Link from 'next/link';
import { notFound } from 'next/navigation';

import { listCategories, getTransaction } from '@kobako/db';

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
  const [transaction, categories] = await Promise.all([
    getTransaction(db, householdId, id),
    listCategories(db, householdId),
  ]);
  if (!transaction) {
    notFound();
  }

  const action = updateTransactionAction.bind(null, idText);
  return (
    <div className="content-stack content-narrow">
      <section className="page-heading" aria-labelledby="edit-transaction-title">
        <div>
          <p className="eyebrow">取引</p>
          <h1 id="edit-transaction-title">取引を編集</h1>
        </div>
        <Link
          className="text-link"
          href={`/transactions?month=${transaction.occurredOn.slice(0, 7)}`}
        >
          一覧へ戻る
        </Link>
      </section>
      <section className="panel">
        <TransactionForm
          action={action}
          categories={categories}
          initialValues={{
            type: transaction.type,
            amount: String(transaction.amount),
            occurredOn: transaction.occurredOn,
            categoryId: String(transaction.categoryId),
            memo: transaction.memo,
          }}
          submitLabel="変更を保存"
        />
      </section>
      <section className="panel danger-panel" aria-labelledby="delete-title">
        <h2 id="delete-title">取引を削除</h2>
        <p>間違えて登録した取引を削除できます。削除した内容は元に戻せません。</p>
        <DeleteTransactionForm transactionId={transaction.id} />
      </section>
    </div>
  );
}
