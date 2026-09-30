import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getTransfer, listAccounts } from '@kobako/db';

import { getCurrentHouseholdId, getLedgerDatabase } from '../../../../../src/lib/ledger-data';
import { parseInt4Id } from '../../../../../src/lib/ids';
import { DeleteTransferForm, TransferForm } from '../../transfer-form';
import { updateTransferAction } from '../../actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: '振替を編集',
};

export default async function EditTransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idText } = await params;
  const id = parseInt4Id(idText);
  if (id === undefined) {
    notFound();
  }

  const db = getLedgerDatabase();
  const householdId = getCurrentHouseholdId();
  const [transfer, accounts] = await Promise.all([
    getTransfer(db, householdId, id),
    listAccounts(db, householdId),
  ]);
  if (!transfer) {
    notFound();
  }

  const action = updateTransferAction.bind(null, idText);
  return (
    <div className="content-stack content-narrow form-page">
      <section className="page-heading" aria-labelledby="edit-transfer-title">
        <h1 id="edit-transfer-title">振替を編集</h1>
        <Link className="text-link" href={`/transactions?month=${transfer.occurredOn.slice(0, 7)}`}>
          一覧へ戻る
        </Link>
      </section>
      <section className="form-surface" aria-label="振替の入力">
        <div className="edit-form-layout">
          <TransferForm
            action={action}
            accounts={accounts}
            initialValues={{
              fromAccountId: String(transfer.fromAccountId),
              toAccountId: String(transfer.toAccountId),
              amount: String(transfer.amount),
              occurredOn: transfer.occurredOn,
              memo: transfer.memo,
            }}
            submitLabel="変更を保存"
          />
          <DeleteTransferForm
            transferId={transfer.id}
            fromAccountName={transfer.fromAccountName}
            toAccountName={transfer.toAccountName}
            amount={transfer.amount}
            occurredOn={transfer.occurredOn}
          />
        </div>
      </section>
    </div>
  );
}
