import type { Metadata } from 'next';
import { listActiveManagedAccounts } from '@kobako/db';
import { withSelectedMonth } from '../../../src/lib/month-navigation';
import { firstQueryValue } from '../../../src/lib/transaction-query';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../../src/lib/ledger-data';
import { ActionLink, PageHeader, PageShell } from '../../_components/ui';
import { createAccountAction } from '../actions';
import { AccountForm } from '../account-form';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata: Metadata = { title: '資産を登録' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewAccountPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const backHref = withSelectedMonth('/balances', firstQueryValue(query.month));
  const accounts = await listActiveManagedAccounts(getLedgerDatabase(), getCurrentHouseholdId());
  return (
    <PageShell width="narrow">
      <PageHeader
        title="資産を登録"
        actions={
          <ActionLink href={backHref} variant="back">
            残高へ戻る
          </ActionLink>
        }
      />
      <section className="form-surface" aria-label="資産の入力">
        <AccountForm
          action={createAccountAction}
          accounts={accounts}
          initialValues={{
            name: '',
            kind: 'other',
            expectedKind: '',
            closingDay: '',
            paymentDay: '',
            paymentMonthOffset: '',
            debitAccountId: '',
          }}
          submitLabel="登録する"
        />
      </section>
    </PageShell>
  );
}
