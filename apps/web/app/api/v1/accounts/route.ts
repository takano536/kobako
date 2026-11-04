import { listAccounts } from '@kobako/db';

import { handleApi, ledgerDatabase, noStore } from '../../../../src/lib/api-contract';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET(request: Request): Promise<Response> {
  return handleApi(request, async ({ householdId }) => {
    const rows = await listAccounts(ledgerDatabase(), householdId);
    return noStore({
      items: rows
        .filter((account) => account.deletedAt === null)
        .map((account) => ({ id: account.id, name: account.name, kind: account.kind })),
    });
  });
}
