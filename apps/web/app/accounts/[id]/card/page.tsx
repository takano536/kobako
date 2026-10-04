import Link from 'next/link';
import {
  getManagedAccount,
  listCardConditionHistory,
  listManagedAccounts,
  previewCardConditionCorrection,
} from '@kobako/db';
import { accountCardConditionInputSchema } from '@kobako/db/validation';
import { notFound } from 'next/navigation';

import { validatedTransactionReturn } from '../../../../src/lib/transaction-query';
import { getCurrentHouseholdId, getLedgerDatabase } from '../../../../src/lib/ledger-data';
import { parseInt4Id } from '../../../../src/lib/ids';
import { ActionLink, PageHeader, PageShell, SectionHeading } from '../../../_components/ui';
import { DatePickerField } from '../../../transactions/date-picker-field';
import { appendCardConditionAction } from './actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
const dayOptions = Array.from({ length: 31 }, (_, index) => String(index + 1));

function conditionDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

type CardConditionValues = {
  effectiveFrom: string | null;
  closingDay: string | null;
  paymentDay: string | null;
  paymentMonthOffset: 'same_month' | 'next_month' | 'two_months_later' | null;
  debitAccountId: number | null;
};

function parseCorrectionProposal(value: string | undefined): CardConditionValues | undefined {
  if (!value) return undefined;
  try {
    const parsed = accountCardConditionInputSchema.safeParse(JSON.parse(value));
    if (!parsed.success) return undefined;
    return {
      effectiveFrom: parsed.data.effectiveFrom ?? null,
      closingDay: parsed.data.closingDay ?? null,
      paymentDay: parsed.data.paymentDay ?? null,
      paymentMonthOffset: parsed.data.paymentMonthOffset ?? null,
      debitAccountId: parsed.data.debitAccountId ?? null,
    };
  } catch {
    return undefined;
  }
}

function conditionDayLabel(value: string | null): string {
  if (value === null) return '未設定';
  return value === 'last' ? '月末' : `${value}日`;
}

function conditionPeriod(condition: CardConditionValues): string {
  return condition.effectiveFrom
    ? `${conditionDate(condition.effectiveFrom)}の締め期間から`
    : '初期条件（適用開始日未設定）';
}

function conditionSummary(condition: CardConditionValues): string {
  return [
    `適用開始 ${condition.effectiveFrom ? conditionDate(condition.effectiveFrom) : '未設定'}`,
    `締め日 ${conditionDayLabel(condition.closingDay)}`,
    `支払日 ${conditionDayLabel(condition.paymentDay)}`,
    `支払月 ${
      condition.paymentMonthOffset === 'same_month'
        ? '当月'
        : condition.paymentMonthOffset === 'next_month'
          ? '翌月'
          : condition.paymentMonthOffset === 'two_months_later'
            ? '翌々月'
            : '未設定'
    }`,
  ].join(' / ');
}

export default async function CardConditionsPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id: idValue } = await params;
  const accountId = parseInt4Id(idValue);
  if (accountId === undefined) notFound();
  const query = await searchParams;
  const returnTo =
    validatedTransactionReturn(firstQueryValue(query.return), accountId) ??
    `/transactions?account=${accountId}&month=all`;
  const db = getLedgerDatabase();
  const householdId = getCurrentHouseholdId();
  const [account, history, accounts] = await Promise.all([
    getManagedAccount(db, householdId, accountId),
    listCardConditionHistory(db, householdId, accountId),
    listManagedAccounts(db, householdId),
  ]);
  if (!account) notFound();
  if (account.kind !== 'credit_card') notFound();
  const conditionIdValue = firstQueryValue(query.conditionId);
  const conditionId = parseInt4Id(conditionIdValue ?? '');
  if (conditionIdValue && conditionId === undefined) notFound();
  const editingCondition =
    conditionId === undefined
      ? undefined
      : history.find((condition) => condition.id === conditionId);
  const correctionProposal = parseCorrectionProposal(firstQueryValue(query.proposal));
  const rawError = firstQueryValue(query.error);
  const correctionPreview =
    rawError === 'confirm_correction' &&
    conditionId !== undefined &&
    correctionProposal !== undefined
      ? await previewCardConditionCorrection(
          db,
          householdId,
          accountId,
          conditionId,
          correctionProposal,
        )
      : undefined;
  const confirmedCorrection = correctionPreview?.status === 'ok' ? correctionPreview : undefined;
  const formCondition = confirmedCorrection?.after ?? editingCondition;
  const errorStatus =
    rawError === 'confirm_correction'
      ? correctionPreview && correctionPreview.status !== 'ok'
        ? correctionPreview.status
        : undefined
      : rawError;
  const chronological = [...history]
    .filter((condition) => condition.effectiveFrom !== null)
    .sort((left, right) => left.effectiveFrom!.localeCompare(right.effectiveFrom!));
  const errorMessages: Record<string, string> = {
    duplicate_effective_from: '同じ適用開始日のカード条件がすでにあります。',
    not_after_latest: '適用開始日は最新の条件より後の日付にしてください。',
    invalid_debit_account:
      '引き落とし口座はクレジットカード以外の口座（利用終了も可）を選択してください。',
    not_card: 'クレジットカードの条件として保存できません。',
    invalid_input: 'カード条件の入力を確認してください。',
    not_found: '修正対象のカード条件が見つかりません。',
  };
  return (
    <PageShell width="narrow">
      <PageHeader
        title={`${account.name}のカード条件`}
        actions={
          <ActionLink
            href={`/accounts/${accountId}/edit?return=${encodeURIComponent(returnTo)}`}
            variant="back"
          >
            口座を編集
          </ActionLink>
        }
      />
      {firstQueryValue(query.saved) === '1' ? (
        <p className="form-message" role="status">
          保存しました
        </p>
      ) : null}
      {errorStatus ? (
        <p className="form-message" role="alert">
          {errorMessages[errorStatus] ?? 'カード条件を保存できませんでした。'}
        </p>
      ) : null}
      {confirmedCorrection ? (
        <div className="form-message" role="alert">
          <strong>カード条件の変更内容を確認してください。</strong>
          <span>変更前: {conditionSummary(confirmedCorrection.before)}</span>
          <span>変更後: {conditionSummary(confirmedCorrection.after)}</span>
          <span>
            影響期間: {conditionPeriod(confirmedCorrection.before)} →{' '}
            {conditionPeriod(confirmedCorrection.after)}
          </span>
        </div>
      ) : null}
      <section className="section" aria-labelledby="card-condition-form-title">
        <SectionHeading
          id="card-condition-form-title"
          title={
            confirmedCorrection ? '変更内容を確認' : editingCondition ? '条件を修正' : '条件を追加'
          }
        />
        <form className="form-stack account-form" action={appendCardConditionAction}>
          <input type="hidden" name="accountId" value={accountId} />
          <input type="hidden" name="return" value={returnTo} />
          {conditionId !== undefined ? (
            <input type="hidden" name="conditionId" value={conditionId} />
          ) : null}
          {confirmedCorrection ? (
            <input type="hidden" name="confirmCorrection" value="confirm" />
          ) : null}
          <div className="form-field">
            <label id="effective-from-label" htmlFor="effective-from">
              適用開始日（未入力は初期条件）
            </label>
            <DatePickerField
              id="effective-from"
              name="effectiveFrom"
              kind="date"
              value={formCondition?.effectiveFrom ?? ''}
              labelId="effective-from-label"
              ariaDescribedBy="effective-from-help"
            />
            <p id="effective-from-help" className="form-field-help">
              この日を含む締め期間から適用します。
            </p>
          </div>
          <div className="form-field">
            <label htmlFor="closing-day">締め日</label>
            <select
              id="closing-day"
              name="closingDay"
              defaultValue={formCondition?.closingDay ?? ''}
            >
              <option value="">未設定</option>
              {dayOptions.map((day) => (
                <option value={day} key={day}>
                  {day}日
                </option>
              ))}
              <option value="last">月末</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="payment-day">支払日</label>
            <select
              id="payment-day"
              name="paymentDay"
              defaultValue={formCondition?.paymentDay ?? ''}
            >
              <option value="">未設定</option>
              {dayOptions.map((day) => (
                <option value={day} key={day}>
                  {day}日
                </option>
              ))}
              <option value="last">月末</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="payment-month-offset">支払月</label>
            <select
              id="payment-month-offset"
              name="paymentMonthOffset"
              defaultValue={formCondition?.paymentMonthOffset ?? ''}
            >
              <option value="">未設定</option>
              <option value="same_month">当月</option>
              <option value="next_month">翌月</option>
              <option value="two_months_later">翌々月</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="debit-account">引き落とし口座</label>
            <select
              id="debit-account"
              name="debitAccountId"
              defaultValue={
                formCondition?.debitAccountId ? String(formCondition.debitAccountId) : ''
              }
            >
              <option value="">未設定</option>
              {accounts
                .filter(
                  (candidate) => candidate.id !== accountId && candidate.kind !== 'credit_card',
                )
                .map((candidate) => (
                  <option value={candidate.id} key={candidate.id}>
                    {candidate.name}
                    {candidate.status === 'closed' ? '（利用終了）' : ''}
                  </option>
                ))}
            </select>
          </div>
          <div className="form-actions">
            <button className="button button-primary" type="submit">
              {confirmedCorrection
                ? 'この変更を確定する'
                : editingCondition
                  ? '変更内容を確認'
                  : '条件を追加する'}
            </button>
          </div>
        </form>
      </section>
      <p className="card-condition-note">kobako は請求額・支払予定日を計算しません。</p>
      <section className="section" aria-labelledby="card-condition-history-title">
        <SectionHeading id="card-condition-history-title" title="変更履歴" />
        {history.length === 0 ? (
          <p>カード条件はまだ設定されていません。</p>
        ) : (
          <ol className="card-condition-history">
            {history.map((condition) => {
              const nextCondition =
                condition.effectiveFrom === null
                  ? chronological[0]
                  : chronological[chronological.findIndex((item) => item.id === condition.id) + 1];
              const periodStart = condition.effectiveFrom
                ? `${conditionDate(condition.effectiveFrom)}の締め期間から`
                : '適用開始 未設定';
              const periodEnd = nextCondition?.effectiveFrom
                ? `${conditionDate(nextCondition.effectiveFrom)}の前日まで`
                : '現在';
              return (
                <li key={condition.id}>
                  <strong>
                    {periodStart}〜{periodEnd}
                  </strong>
                  <span>
                    締め日 {conditionDayLabel(condition.closingDay)} / 支払日{' '}
                    {conditionDayLabel(condition.paymentDay)}
                  </span>
                  <span>
                    支払月{' '}
                    {condition.paymentMonthOffset === 'same_month'
                      ? '当月'
                      : condition.paymentMonthOffset === 'next_month'
                        ? '翌月'
                        : condition.paymentMonthOffset === 'two_months_later'
                          ? '翌々月'
                          : '未設定'}
                  </span>
                  <span>
                    引き落とし口座{' '}
                    {(() => {
                      const debitAccount = accounts.find(
                        (candidate) => candidate.id === condition.debitAccountId,
                      );
                      return debitAccount
                        ? `${debitAccount.name}${debitAccount.status === 'closed' ? '（利用終了）' : ''}`
                        : '未設定';
                    })()}
                  </span>
                  <Link
                    href={`/accounts/${accountId}/card?conditionId=${condition.id}&return=${encodeURIComponent(returnTo)}`}
                  >
                    この条件を修正
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </PageShell>
  );
}
