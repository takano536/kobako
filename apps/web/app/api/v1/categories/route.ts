import { listCategories } from '@kobako/db';

import { handleApi, ledgerDatabase, noStore } from '../../../../src/lib/api-contract';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET(request: Request): Promise<Response> {
  return handleApi(request, async ({ householdId }) => {
    const rows = await listCategories(ledgerDatabase(), householdId);
    return noStore({
      items: rows.map((category) => ({ id: category.id, name: category.name, type: category.type })),
    });
  });
}
