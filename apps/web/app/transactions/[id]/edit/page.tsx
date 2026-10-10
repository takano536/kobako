import { notFound } from 'next/navigation';

import { getTransaction, listAccounts, listCategories } from '@kobako/db';

import { withSelectedMonth } from '../../../../src/lib/month-navigation';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../../../src/lib/ledger-data';
import { firstQueryValue, isValidMonth } from '../../../../src/lib/transaction-query';
import { parseInt4Id } from '../../../../src/lib/ids';
import { PageHeader, PageShell } from '../../../_components/ui';
import { DeleteTransactionForm, TransactionForm } from '../../transaction-form';
import { updateTransactionAction } from '../../actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: '取引を編集',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function EditTransactionPage({
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
  const [transaction, categories, accounts] = await Promise.all([
    getTransaction(db, householdId, id),
    listCategories(db, householdId),
    listAccounts(db, householdId),
  ]);
  if (!transaction) {
    notFound();
  }

  const action = updateTransactionAction.bind(null, idText, 'transaction');
  const selectedMonth = firstQueryValue(query.month);
  const backHref =
    selectedMonth && isValidMonth(selectedMonth)
      ? withSelectedMonth('/transactions', selectedMonth)
      : withSelectedMonth('/transactions', transaction.occurredOn.slice(0, 7));
  const cancelHref = withSelectedMonth(`/transactions/${transaction.id}/edit`, selectedMonth);
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
              type: transaction.type,
              amount: String(transaction.amount),
              occurredOn: transaction.occurredOn,
              categoryId: String(transaction.categoryId),
              accountId: transaction.accountId ? String(transaction.accountId) : '',
              fromAccountId: '',
              toAccountId: '',
              memo: transaction.memo,
            }}
            submitLabel="変更を保存"
          />
          <DeleteTransactionForm transactionId={transaction.id} cancelHref={cancelHref} />
        </div>
      </section>
    </PageShell>
  );
}
