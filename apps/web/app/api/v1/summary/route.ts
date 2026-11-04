import {
  currentTokyoMonth,
  getExpenseCategoryTotals,
  getMonthlyTotals,
  isValidMonth,
} from '@kobako/db';

import { apiError, handleApi, ledgerDatabase, noStore } from '../../../../src/lib/api-contract';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET(request: Request): Promise<Response> {
  return handleApi(request, async ({ householdId, url }) => {
    const month = url.searchParams.get('month') ?? currentTokyoMonth();
    if (!isValidMonth(month)) {
      return apiError(
        400,
        'invalid_month',
        '月の形式が正しくありません。',
        'YYYY-MM を指定してください。',
      );
    }
    const db = ledgerDatabase();
    const [totals, expenseCategories] = await Promise.all([
      getMonthlyTotals(db, householdId, month),
      getExpenseCategoryTotals(db, householdId, month),
    ]);
    return noStore({ month, ...totals, expenseCategories });
  });
}
