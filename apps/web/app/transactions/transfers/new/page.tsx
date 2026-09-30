import Link from 'next/link';

import { currentTokyoDate, currentTokyoMonth, isValidMonth, listAccounts } from '@kobako/db';

import { getCurrentHouseholdId, getLedgerDatabase } from '../../../../src/lib/ledger-data';
import { TransferForm } from '../transfer-form';
import { createTransferAction } from '../actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: '振替を追加',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewTransferPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const currentMonth = currentTokyoMonth();
  const requestedMonth = firstQueryValue(query.month);
  const targetMonth =
    requestedMonth && isValidMonth(requestedMonth) ? requestedMonth : currentMonth;
  const occurredOn = targetMonth === currentMonth ? currentTokyoDate() : `${targetMonth}-01`;
  const accounts = await listAccounts(getLedgerDatabase(), getCurrentHouseholdId());
  const backHref = `/transactions?month=${encodeURIComponent(targetMonth)}`;

  return (
    <div className="content-stack content-narrow form-page">
      <section className="page-heading" aria-labelledby="new-transfer-title">
        <h1 id="new-transfer-title">振替を追加</h1>
        <Link className="text-link" href={backHref}>
          取引一覧へ戻る
        </Link>
      </section>
      {accounts.length < 2 ? (
        <section
          className="empty-state insufficient-accounts"
          aria-labelledby="insufficient-accounts-title"
        >
          <h2 id="insufficient-accounts-title">振替には2つ以上の口座が必要です</h2>
          <p>「らくな家計簿」から2つ以上の口座を取り込むと、振替を登録できます。</p>
        </section>
      ) : (
        <section className="form-surface" aria-label="振替の入力">
          <TransferForm
            action={createTransferAction}
            accounts={accounts}
            initialValues={{
              fromAccountId: '',
              toAccountId: '',
              amount: '',
              occurredOn,
              memo: '',
            }}
            submitLabel="登録する"
          />
        </section>
      )}
    </div>
  );
}
