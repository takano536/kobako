import {
  apiWriteBodySchema,
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
  parseId,
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
    const typeParam = url.searchParams.get('type');
    const type =
      typeParam === 'expense' || typeParam === 'income' || typeParam === 'transfer'
        ? typeParam
        : undefined;
    if (typeParam && !type) {
      return apiError(
        400,
        'invalid_type',
        '種別が正しくありません。',
        'expense / income / transfer のいずれかです。',
      );
    }
    const categoryRaw = url.searchParams.get('category');
    const accountRaw = url.searchParams.get('account');
    const categoryId = categoryRaw === null ? undefined : parseId(categoryRaw);
    const accountId = accountRaw === null ? undefined : parseId(accountRaw);
    if (categoryRaw !== null && categoryId === undefined) {
      return apiError(
        400,
        'invalid_category',
        'カテゴリの指定が正しくありません。',
        'GET /api/v1/categories の id を指定してください。',
      );
    }
    if (accountRaw !== null && accountId === undefined) {
      return apiError(
        400,
        'invalid_account',
        '資産の指定が正しくありません。',
        'GET /api/v1/accounts の id を指定してください。',
      );
    }
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw === null ? undefined : parseId(limitRaw);
    if (limitRaw !== null && limit === undefined) {
      return apiError(400, 'invalid_limit', 'limit は 1 以上の整数で指定してください。');
    }
    const rows = await listLedgerEntries(ledgerDatabase(), householdId, {
      month: rawMonth,
      type,
      categoryId: type === 'transfer' ? undefined : categoryId,
      accountId,
      origin: url.searchParams.get('origin') === 'api' ? 'api' : undefined,
    });
    return noStore({ items: limit ? rows.slice(0, limit) : rows, count: rows.length });
  });
}

export function POST(request: Request): Promise<Response> {
  return handleApi(request, async ({ householdId, url }) => {
    const parsed = await readJson(request);
    if (!parsed.ok) return parsed.response;
    const body = apiWriteBodySchema.safeParse(parsed.body);
    if (!body.success) return invalidBody(body.error);
    if (!body.data.transactions?.length && !body.data.transfers?.length) {
      return apiError(400, 'invalid_body', 'transactions か transfers に1件以上入れてください。');
    }
    const dryRun = url.searchParams.get('dry_run') === '1';
    const result = await ingestApiBatch(ledgerDatabase(), householdId, {
      label: body.data.label,
      idempotencyKey: request.headers.get('idempotency-key'),
      transactions: body.data.transactions ?? [],
      transfers: body.data.transfers ?? [],
      dryRun,
    });
    return batchResponse(result, dryRun);
  });
}
