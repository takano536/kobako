import overviewStyles from './overview.module.css';
import uiStyles from './_components/ui.module.css';
import transactionStyles from './transactions/transaction-row.module.css';
import {
  MAX_SUPPORTED_YEAR,
  MIN_SUPPORTED_YEAR,
  currentTokyoMonth,
  getExpenseCategoryTotals,
  getMonthlyTotals,
  listTransactions,
  parseMonth,
  shiftMonth,
} from '@kobako/db';

import { getCurrentHouseholdId, getLedgerDatabase } from '../src/lib/ledger-data';
import { monthLabel } from '../src/lib/format';
import { PageHeader } from './_components/page-header';
import {
  ActionLink,
  EmptyState,
  MonthSwitcher,
  PageShell,
  RegisterTransactionAction,
  SectionHeading,
  SignedYen,
} from './_components/ui';
import { CategoryBreakdown } from './overview/category-breakdown';
import { TransactionRow } from './transactions/transaction-row';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: '概要',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const selectedMonth = firstQueryValue(query.month);
  const month = parseMonth(selectedMonth, currentTokyoMonth());
  const db = getLedgerDatabase();
  const householdId = await getCurrentHouseholdId();
  const [totals, latestTransactions, categoryTotals] = await Promise.all([
    getMonthlyTotals(db, householdId, month),
    listTransactions(db, householdId, { month, limit: 5 }),
    getExpenseCategoryTotals(db, householdId, month),
  ]);

  return (
    <PageShell transition className={overviewStyles['overview-page']}>
      <PageHeader title="概要" actions={<RegisterTransactionAction month={month} />} />
      <MonthSwitcher
        month={month}
        previousHref={
          month > `${MIN_SUPPORTED_YEAR}-01` ? `/?month=${shiftMonth(month, -1)}` : undefined
        }
        nextHref={
          month < `${MAX_SUPPORTED_YEAR}-12` ? `/?month=${shiftMonth(month, 1)}` : undefined
        }
      />

      <section
        className={overviewStyles['overview-summary']}
        role="group"
        aria-labelledby="expense-label"
      >
        <div className={overviewStyles['overview-lead']}>
          <h2 id="expense-label" className={overviewStyles.eyebrow}>
            この月の支出
          </h2>
          <p data-slot="lead-amount" className={overviewStyles['lead-amount']}>
            <SignedYen value={totals.expense} tone="negative" />
          </p>
        </div>

        <dl
          className={overviewStyles['summary-inline']}
          aria-label={`${monthLabel(month)}の収入と差額`}
        >
          <div role="group" aria-labelledby="income-total-label">
            <dt id="income-total-label">収入</dt>
            <dd>
              <SignedYen value={totals.income} tone="positive" />
            </dd>
          </div>
          <div role="group" aria-labelledby="difference-total-label">
            <dt id="difference-total-label">収支差額</dt>
            <dd>
              <SignedYen value={totals.difference} />
            </dd>
          </div>
        </dl>
      </section>

      <section className={overviewStyles.section} aria-labelledby="breakdown-title">
        <SectionHeading
          id="breakdown-title"
          title="支出カテゴリ別の支出"
          action={
            <ActionLink href={`/transactions?month=${month}&type=expense`} variant="quiet">
              支出をすべて見る
            </ActionLink>
          }
        />
        <CategoryBreakdown
          categories={categoryTotals}
          totalExpense={totals.expense}
          month={month}
        />
      </section>

      <section
        className={[overviewStyles.section, overviewStyles['recent-section']].join(' ')}
        aria-labelledby="latest-title"
      >
        <SectionHeading
          id="latest-title"
          title="最近の取引"
          action={
            <ActionLink href={`/transactions?month=${month}`} variant="quiet">
              取引一覧を見る
            </ActionLink>
          }
        />
        {latestTransactions.length === 0 ? (
          <EmptyState
            size="section"
            headingLevel={3}
            title="まだ記録がありません"
            description={
              <>
                <span className={uiStyles['phrase-wrap']}>この月の記録を、</span>
                <span className={uiStyles['phrase-wrap']}>ひとつずつ残しましょう。</span>
              </>
            }
            action={<RegisterTransactionAction month={month} />}
          />
        ) : (
          <ul
            data-slot="recent-list"
            className={[
              transactionStyles['transaction-list'],
              transactionStyles['transaction-list-recent'],
            ].join(' ')}
            aria-label="最近の取引"
          >
            {latestTransactions.map((transaction) => (
              <TransactionRow
                key={transaction.id}
                transaction={transaction}
                selectedMonth={selectedMonth}
                showMemo
              />
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
