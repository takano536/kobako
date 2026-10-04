import Link from 'next/link';
import type { Metadata } from 'next';
import { listAccountGroups, listManagedAccounts } from '@kobako/db';

import { getCurrentHouseholdId, getLedgerDatabase } from '../../src/lib/ledger-data';
import { ActionLink, PageHeader, PageShell, SectionHeading } from '../_components/ui';
import {
  createAccountGroupAction,
  deleteAccountAction,
  deleteAccountGroupAction,
  renameAccountGroupAction,
  reorderAccountGroupsAction,
  reorderAccountsAction,
} from './actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata: Metadata = { title: '口座' };
type AccountsSearchParams = Promise<{ error?: string; references?: string }>;
function movedGroupIds(
  groups: readonly { id: number }[],
  index: number,
  direction: -1 | 1,
): number[] {
  const target = index + direction;
  if (target < 0 || target >= groups.length) return groups.map((group) => group.id);
  return groups.map((group, groupIndex) => {
    if (groupIndex === index) return groups[target]?.id ?? group.id;
    if (groupIndex === target) return groups[index]?.id ?? group.id;
    return group.id;
  });
}

function movedAccountIds(
  accounts: readonly { id: number }[],
  index: number,
  direction: -1 | 1,
): number[] {
  const target = index + direction;
  if (target < 0 || target >= accounts.length) return accounts.map((account) => account.id);
  return accounts.map((account, accountIndex) => {
    if (accountIndex === index) return accounts[target]?.id ?? account.id;
    if (accountIndex === target) return accounts[index]?.id ?? account.id;
    return account.id;
  });
}

function accountKindLabel(kind: string): string {
  return kind === 'credit_card'
    ? 'クレジットカード'
    : kind === 'cash'
      ? '現金'
      : kind === 'bank'
        ? '銀行'
        : kind === 'electronic_money'
          ? '電子マネー'
          : 'その他';
}
export default async function AccountsPage({
  searchParams,
}: {
  searchParams?: AccountsSearchParams;
}) {
  const [groups, accounts, params] = await Promise.all([
    listAccountGroups(getLedgerDatabase(), getCurrentHouseholdId()),
    listManagedAccounts(getLedgerDatabase(), getCurrentHouseholdId()),
    searchParams ?? Promise.resolve({} as Awaited<AccountsSearchParams>),
  ]);
  const errorMessage =
    params.error === 'account_referenced'
      ? `口座を削除できません。参照: ${params.references ?? '取引・振替・取り込み履歴・カードの引き落とし口座'}。`
      : params.error === 'account_delete_failed'
        ? '口座を削除できませんでした。'
        : undefined;
  return (
    <PageShell>
      <PageHeader
        title="口座"
        count={`${accounts.length}件`}
        actions={
          <ActionLink href="/accounts/new" variant="primary">
            口座を登録
          </ActionLink>
        }
      />
      {errorMessage ? (
        <p className="form-message" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <section className="section" aria-labelledby="account-groups-title">
        <SectionHeading id="account-groups-title" title="グループ" />
        <form className="inline-form account-group-create-form" action={createAccountGroupAction}>
          <label htmlFor="new-group-name">新しいグループ</label>
          <input id="new-group-name" name="name" required maxLength={120} />
          <button className="button button-secondary" type="submit">
            追加
          </button>
        </form>
        <ul className="account-group-list">
          {groups.map((group, index) => {
            const groupAccounts = accounts.filter((account) => account.groupId === group.id);
            const isDefault = group.defaultKind !== null;
            return (
              <li key={group.id} className="account-group-card">
                <div className="account-group-header">
                  <div className="account-group-heading">
                    <h3>{group.name}</h3>
                    {isDefault ? <span className="account-group-default">標準</span> : null}
                    <span>{groupAccounts.length}口座</span>
                  </div>
                  <div className="account-group-controls">
                    <div className="account-group-order">
                      {index > 0 ? (
                        <form action={reorderAccountGroupsAction}>
                          {movedGroupIds(groups, index, -1).map((id) => (
                            <input type="hidden" name="orderedIds" value={id} key={id} />
                          ))}
                          <button
                            className="button button-quiet"
                            type="submit"
                            aria-label={`${group.name}を上へ`}
                          >
                            ↑
                          </button>
                        </form>
                      ) : null}
                      {index < groups.length - 1 ? (
                        <form action={reorderAccountGroupsAction}>
                          {movedGroupIds(groups, index, 1).map((id) => (
                            <input type="hidden" name="orderedIds" value={id} key={id} />
                          ))}
                          <button
                            className="button button-quiet"
                            type="submit"
                            aria-label={`${group.name}を下へ`}
                          >
                            ↓
                          </button>
                        </form>
                      ) : null}
                    </div>
                    <details className="account-group-rename">
                      <summary
                        className="button button-quiet"
                        aria-label={`${group.name}の名前を変更`}
                      >
                        名前を変更
                      </summary>
                      <form action={renameAccountGroupAction} className="inline-form">
                        <input type="hidden" name="groupId" value={group.id} />
                        <label className="sr-only" htmlFor={`rename-group-${group.id}`}>
                          グループ名
                        </label>
                        <input
                          id={`rename-group-${group.id}`}
                          name="name"
                          defaultValue={group.name}
                          maxLength={120}
                        />
                        <button className="button button-secondary" type="submit">
                          名前を保存
                        </button>
                      </form>
                    </details>
                    {!isDefault && groupAccounts.length === 0 ? (
                      <details className="delete-details">
                        <summary className="button button-quiet" aria-label={`${group.name}を削除`}>
                          削除
                        </summary>
                        <form action={deleteAccountGroupAction}>
                          <input type="hidden" name="groupId" value={group.id} />
                          <input type="hidden" name="confirm" value="delete" />
                          <button className="button button-quiet" type="submit">
                            削除を確定
                          </button>
                        </form>
                      </details>
                    ) : null}
                  </div>
                </div>
                {groupAccounts.length === 0 ? (
                  <p className="account-group-empty">口座はありません</p>
                ) : (
                  <ul className="managed-account-list">
                    {groupAccounts.map((account, accountIndex) => (
                      <li key={account.id} className="managed-account-row">
                        <div className="managed-account-info">
                          <Link
                            href={`/transactions?account=${account.id}&month=all`}
                            className="managed-account-name"
                          >
                            {account.name}
                          </Link>
                          <p className="managed-account-meta">
                            <span>種類: {accountKindLabel(account.kind)}</span>
                            {account.status === 'closed' ? (
                              <span className="account-status-badge">利用終了</span>
                            ) : null}
                          </p>
                        </div>
                        <div className="managed-account-actions">
                          <Link
                            href={`/accounts/${account.id}/edit?return=${encodeURIComponent(`/transactions?account=${account.id}&month=all`)}`}
                            className="button button-quiet"
                            aria-label={`${account.name}の設定`}
                          >
                            設定
                          </Link>
                          {accountIndex > 0 ? (
                            <form action={reorderAccountsAction}>
                              <input type="hidden" name="groupId" value={account.groupId} />
                              {movedAccountIds(groupAccounts, accountIndex, -1).map((id) => (
                                <input type="hidden" name="orderedIds" value={id} key={id} />
                              ))}
                              <button
                                className="button button-quiet"
                                type="submit"
                                aria-label={`${account.name}を上へ`}
                              >
                                ↑
                              </button>
                            </form>
                          ) : null}
                          {accountIndex < groupAccounts.length - 1 ? (
                            <form action={reorderAccountsAction}>
                              <input type="hidden" name="groupId" value={account.groupId} />
                              {movedAccountIds(groupAccounts, accountIndex, 1).map((id) => (
                                <input type="hidden" name="orderedIds" value={id} key={id} />
                              ))}
                              <button
                                className="button button-quiet"
                                type="submit"
                                aria-label={`${account.name}を下へ`}
                              >
                                ↓
                              </button>
                            </form>
                          ) : null}
                          <details className="delete-details">
                            <summary
                              className="button button-quiet"
                              aria-label={`${account.name}を削除`}
                            >
                              削除
                            </summary>
                            <form action={deleteAccountAction}>
                              <input type="hidden" name="accountId" value={account.id} />
                              <input type="hidden" name="confirm" value="delete" />
                              <button className="button button-quiet" type="submit">
                                削除を確定
                              </button>
                            </form>
                          </details>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </PageShell>
  );
}
