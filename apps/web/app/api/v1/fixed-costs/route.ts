import { getFixedCostSummary, listFixedCosts } from '@kobako/db';

import { handleApi, ledgerDatabase, noStore } from '../../../../src/lib/api-contract';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface FixedCostsResponse {
  monthly: string;
  annual: string;
  items: Array<{
    id: number;
    name: string;
    categoryName: string;
    accountName: string;
    amount: string;
    day: number;
    intervalCount: number;
    intervalUnit: 'month' | 'year';
    startMonth: string;
  }>;
}

export function GET(request: Request): Promise<Response> {
  return handleApi(request, async ({ householdId }) => {
    const db = ledgerDatabase();
    const [summary, fixedCosts] = await Promise.all([
      getFixedCostSummary(db, householdId),
      listFixedCosts(db, householdId),
    ]);
    const response: FixedCostsResponse = {
      monthly: String(summary.monthly),
      annual: String(summary.annual),
      items: fixedCosts.map((fixedCost) => ({
        id: fixedCost.id,
        name: fixedCost.name,
        categoryName: fixedCost.categoryName,
        accountName: fixedCost.accountName,
        amount: String(fixedCost.amount),
        day: fixedCost.day,
        intervalCount: fixedCost.intervalCount,
        intervalUnit: fixedCost.intervalUnit,
        startMonth: fixedCost.startMonth,
      })),
    };
    return noStore(response);
  });
}
