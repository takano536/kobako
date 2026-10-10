import {
  currentTokyoDate,
  currentTokyoMonth,
  isValidMonth,
  listActiveAccounts,
  listCategories,
} from '@kobako/db';

import { getCurrentHouseholdId, getLedgerDatabase } from '../../../src/lib/ledger-data';
import { PageHeader, PageShell } from '../../_components/ui';
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
  const occurredOn = targetMonth === currentMonth ? currentTokyoDate() : `${targetMonth}-01`;
  const householdId = getCurrentHouseholdId();
  const db = getLedgerDatabase();
  const [categories, accounts] = await Promise.all([
    listCategories(db, householdId),
    listActiveAccounts(db, householdId),
  ]);
  const type = parseType(firstQueryValue(query.type));
  const firstExpense = categories.find((category) => category.type === 'expense');
  const firstIncome = categories.find((category) => category.type === 'income');
  const backHref = `/transactions?month=${encodeURIComponent(targetMonth)}`;

  return (
    <PageShell width="narrow">
      <PageHeader
        title="新規登録"
        titleAriaLabel="新規登録"
        backLink={{ href: backHref, label: '取引一覧へ戻る' }}
      />
      <section className="form-surface" aria-label="取引の入力">
        <TransactionForm
          action={createTransactionAction}
          categories={categories}
          accounts={accounts}
          initialValues={{
            type,
            amount: '',
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
            fromAccountId: '',
            toAccountId: '',
            memo: '',
          }}
          submitLabel="登録する"
        />
      </section>
    </PageShell>
  );
}
