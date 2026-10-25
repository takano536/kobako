import {
  apiTransferBodySchema,
  currentTokyoMonth,
  ingestApiBatch,
  isValidMonth,
  listLedgerEntries,
} from '@kobako/db';

import {
  apiError,
  batchResponse,
  handleApi,
  invalidBody,
  ledgerDatabase,
  noStore,
  readJson,
} from '../../../../src/lib/api-contract';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET(request: Request): Promise<Response> {
  return handleApi(request, async ({ householdId, url }) => {
    const rawMonth = url.searchParams.get('month') ?? currentTokyoMonth();
    if (rawMonth !== 'all' && !isValidMonth(rawMonth)) {
      return apiError(
        400,
        'invalid_month',
        '月の形式が正しくありません。',
        'YYYY-MM か all を指定してください。',
      );
    }
    const rows = await listLedgerEntries(ledgerDatabase(), householdId, {
      month: rawMonth,
      type: 'transfer',
      origin: url.searchParams.get('origin') === 'api' ? 'api' : undefined,
    });
    return noStore({ items: rows, count: rows.length });
  });
}

export function POST(request: Request): Promise<Response> {
  return handleApi(request, async ({ householdId, url }) => {
    const parsed = await readJson(request);
    if (!parsed.ok) return parsed.response;
    const body = apiTransferBodySchema.safeParse(parsed.body);
    if (!body.success) return invalidBody(body.error);
    const dryRun = url.searchParams.get('dry_run') === '1';
    const result = await ingestApiBatch(ledgerDatabase(), householdId, {
      label: body.data.label,
      idempotencyKey: request.headers.get('idempotency-key'),
      transfers: body.data.transfers,
      dryRun,
    });
    return batchResponse(result, dryRun);
  });
}
