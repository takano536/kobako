import {
  aggregateBankPaymentSchedules,
  currentTokyoDate,
  deriveCardBalancePaymentSchedule,
  getCardBillingSummaries,
  getManagedAccountBalances,
} from '@kobako/db';

import { handleApi, ledgerDatabase, noStore } from '../../../../src/lib/api-contract';
import { calculateBalanceSummary } from '../../../../src/lib/balances';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET(request: Request): Promise<Response> {
  return handleApi(request, async ({ householdId }) => {
    const db = ledgerDatabase();
    const today = currentTokyoDate();
    const allBalances = await getManagedAccountBalances(db, householdId);
    const balances = allBalances.filter((account) => account.deletedAt === null);
    const cardSummaries = await getCardBillingSummaries(
      db,
      householdId,
      balances
        .filter((account) => account.kind === 'credit_card')
        .map((account) => account.accountId),
      today,
    );
    const billingByAccountId = new Map(
      cardSummaries.map((billing) => [billing.accountId, billing]),
    );
    const scheduledByBankId = aggregateBankPaymentSchedules(cardSummaries, today.slice(0, 7));
    const groups = new Map<
      number,
      {
        name: string;
        systemKey: string | null;
        accounts: Array<{
          id: number;
          name: string;
          kind: (typeof balances)[number]['kind'];
          balance: string;
          scheduledAmount: string;
          scheduledDueOn: string | null;
          unbilledAmount: string | null;
          nextPayment: unknown;
        }>;
      }
    >();

    for (const account of balances) {
      let scheduledAmount = '0';
      let scheduledDueOn: string | null = null;
      let unbilledAmount: string | null = null;
      let nextPayment: unknown = null;
      if (account.kind === 'bank') {
        scheduledAmount = (scheduledByBankId.get(account.accountId) ?? 0n).toString();
      } else if (account.kind === 'credit_card') {
        const billing = billingByAccountId.get(account.accountId);
        const schedule = deriveCardBalancePaymentSchedule(billing?.periods ?? [], today);
        scheduledAmount = schedule.scheduledAmount;
        scheduledDueOn = schedule.scheduledDueOn;
        unbilledAmount = schedule.unbilledAmount;
        nextPayment = billing?.nextPayment ?? null;
      }

      const group = groups.get(account.assetCategoryId);
      const outputAccount = {
        id: account.accountId,
        name: account.accountName,
        kind: account.kind,
        balance: account.balance,
        scheduledAmount,
        scheduledDueOn,
        unbilledAmount,
        nextPayment,
      };
      if (group) {
        group.accounts.push(outputAccount);
      } else {
        groups.set(account.assetCategoryId, {
          name: account.assetCategoryName,
          systemKey: account.assetCategorySystemKey,
          accounts: [outputAccount],
        });
      }
    }

    return noStore({
      summary: calculateBalanceSummary(balances),
      groups: [...groups.values()],
    });
  });
}
