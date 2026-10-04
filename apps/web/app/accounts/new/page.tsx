import type { Metadata } from 'next';
import { listAccountGroups, listManagedAccounts } from '@kobako/db';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../../src/lib/ledger-data';
import { ActionLink, PageHeader, PageShell } from '../../_components/ui';
import { createAccountAction } from '../actions';
import { AccountForm } from '../account-form';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata: Metadata = { title: '口座を登録' };

export default async function NewAccountPage() {
  const [groups, accounts] = await Promise.all([
    listAccountGroups(getLedgerDatabase(), getCurrentHouseholdId()),
    listManagedAccounts(getLedgerDatabase(), getCurrentHouseholdId()),
  ]);
  return (
    <PageShell width="narrow">
      <PageHeader
        title="口座を登録"
        actions={
          <ActionLink href="/accounts" variant="back">
            口座一覧へ戻る
          </ActionLink>
        }
      />
      <AccountForm
        action={createAccountAction}
        groups={groups}
        existingNames={accounts.map((account) => account.name)}
        initialValues={{
          name: '',
          kind: 'other',
          groupId: 'auto',
          status: 'active',
          expectedKind: '',
          confirmKindChange: false,
        }}
        submitLabel="登録する"
        editing={false}
      />
    </PageShell>
  );
}
