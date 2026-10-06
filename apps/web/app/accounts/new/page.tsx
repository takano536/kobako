import type { Metadata } from 'next';
import { listActiveManagedAccounts } from '@kobako/db';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../../src/lib/ledger-data';
import { ActionLink, PageHeader, PageShell } from '../../_components/ui';
import { createAccountAction } from '../actions';
import { AccountForm } from '../account-form';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata: Metadata = { title: '資産を登録' };

export default async function NewAccountPage() {
  const accounts = await listActiveManagedAccounts(getLedgerDatabase(), getCurrentHouseholdId());
  return (
    <PageShell width="narrow">
      <PageHeader
        title="資産を登録"
        actions={
          <ActionLink href="/balances" variant="back">
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
            confirmKindChange: false,
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
