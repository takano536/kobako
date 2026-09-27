import Link from 'next/link';

import { currentTokyoDate, currentTokyoMonth, isValidMonth, listCategories } from '@kobako/db';

import { getCurrentHouseholdId, getLedgerDatabase } from '../../../src/lib/ledger-data';
import { TransactionForm } from '../transaction-form';
import { createTransactionAction } from '../actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: '新規登録',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewTransactionPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const currentMonth = currentTokyoMonth();
  const requestedMonth = firstQueryValue(query.month);
  const targetMonth =
    requestedMonth && isValidMonth(requestedMonth) ? requestedMonth : currentMonth;
  const occurredOn = targetMonth === currentMonth ? currentTokyoDate() : `${targetMonth}-01`;
  const categories = await listCategories(getLedgerDatabase(), getCurrentHouseholdId());
  const firstExpense = categories.find((category) => category.type === 'expense');
  const backHref = `/transactions?month=${encodeURIComponent(targetMonth)}`;

  return (
    <div className="content-stack content-narrow form-page">
      <section className="page-heading" aria-labelledby="new-transaction-title">
        <h1 id="new-transaction-title">新規登録</h1>
        <Link className="text-link" href={backHref}>
          取引一覧へ戻る
        </Link>
      </section>
      <section className="form-surface" aria-label="取引の入力">
        <TransactionForm
          action={createTransactionAction}
          categories={categories}
          initialValues={{
            type: 'expense',
            amount: '',
            occurredOn,
            categoryId: firstExpense ? String(firstExpense.id) : '',
            memo: '',
          }}
          submitLabel="登録する"
        />
      </section>
    </div>
  );
}
