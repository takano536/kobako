import {
  currentTokyoDate,
  currentTokyoMonth,
  isValidMonth,
  listActiveAccounts,
  listCategories,
} from '@kobako/db';

import { getCurrentHouseholdId, getLedgerDatabase } from '../../../src/lib/ledger-data';
import { ActionLink, PageHeader, PageShell } from '../../_components/ui';
import { TransactionForm } from '../transaction-form';
import { createTransactionAction } from '../actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: '新規登録',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type TransactionFormType = 'expense' | 'income' | 'transfer';

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseType(value: string | undefined): TransactionFormType {
  return value === 'income' || value === 'transfer' ? value : 'expense';
}

export default async function NewTransactionPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const currentMonth = currentTokyoMonth();
  const requestedMonth = firstQueryValue(query.month);
  const targetMonth =
    requestedMonth && isValidMonth(requestedMonth) ? requestedMonth : currentMonth;
  const paymentContext = firstQueryValue(query.payment) === '1';
  const occurredOn =
    (paymentContext ? firstQueryValue(query.occurredOn) : undefined) ??
    (targetMonth === currentMonth ? currentTokyoDate() : `${targetMonth}-01`);
  const fromAccountId = paymentContext ? (firstQueryValue(query.fromAccountId) ?? '') : '';
  const toAccountId = paymentContext ? (firstQueryValue(query.toAccountId) ?? '') : '';
  const paymentAmount = paymentContext ? (firstQueryValue(query.amount) ?? '') : '';
  const paymentRemaining = paymentContext ? firstQueryValue(query.remaining) : undefined;
  const paymentReturn = paymentContext ? firstQueryValue(query.return) : undefined;
  const householdId = getCurrentHouseholdId();
  const db = getLedgerDatabase();
  const [categories, accounts] = await Promise.all([
    listCategories(db, householdId),
    listActiveAccounts(db, householdId),
  ]);
  const type = paymentContext ? 'transfer' : parseType(firstQueryValue(query.type));
  const firstExpense = categories.find((category) => category.type === 'expense');
  const firstIncome = categories.find((category) => category.type === 'income');
  const backHref =
    paymentReturn?.startsWith('/transactions') && !paymentReturn.startsWith('//')
      ? paymentReturn
      : `/transactions?month=${encodeURIComponent(targetMonth)}`;

  return (
    <PageShell width="narrow">
      <PageHeader
        title="新規登録"
        actions={
          <ActionLink href={backHref} variant="back">
            取引一覧へ戻る
          </ActionLink>
        }
      />
      <section className="form-surface" aria-label="取引の入力">
        <TransactionForm
          action={createTransactionAction}
          categories={categories}
          accounts={accounts}
          initialValues={{
            type,
            amount: paymentContext ? paymentAmount : '',
            occurredOn,
            categoryId:
              type === 'income'
                ? firstIncome
                  ? String(firstIncome.id)
                  : ''
                : type === 'expense' && firstExpense
                  ? String(firstExpense.id)
                  : '',
            accountId: '',
            fromAccountId,
            toAccountId,
            memo: '',
          }}
          submitLabel="登録する"
          paymentContext={paymentContext}
          paymentRemaining={paymentRemaining}
          returnTo={paymentReturn}
        />
      </section>
    </PageShell>
  );
}
