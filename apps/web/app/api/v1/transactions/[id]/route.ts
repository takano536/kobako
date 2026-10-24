import {
  apiTransactionPatchSchema,
  deleteTransaction,
  getTransaction,
  listAccounts,
  listCategories,
  updateTransaction,
} from '@kobako/db';

import {
  apiError,
  handleApi,
  invalidBody,
  ledgerDatabase,
  noStore,
  parseId,
  readJson,
} from '../../../../../src/lib/api-contract';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleApi(request, async ({ householdId }) => {
    const id = parseId((await params).id);
    if (id === undefined) return apiError(404, 'not_found', '取引が見つかりません。');
    const parsed = await readJson(request);
    if (!parsed.ok) return parsed.response;
    const body = apiTransactionPatchSchema.safeParse(parsed.body);
    if (!body.success) return invalidBody(body.error);

    const db = ledgerDatabase();
    const existing = await getTransaction(db, householdId, id);
    if (!existing) return apiError(404, 'not_found', '取引が見つかりません。');

    const type = body.data.type ?? existing.type;
    const categoryName = body.data.category ?? existing.categoryName;
    const categories = await listCategories(db, householdId);
    const category = categories.find((row) => row.type === type && row.name === categoryName);
    if (!category) {
      return apiError(
        400,
        'unknown_category',
        `カテゴリ「${categoryName}」が見つかりません。`,
        'GET /api/v1/categories で名前と種別を確認してください。',
      );
    }

    let accountId = existing.accountId;
    if (body.data.account !== undefined) {
      if (body.data.account === null || body.data.account === '') {
        accountId = null;
      } else {
        const accounts = await listAccounts(db, householdId);
        const account = accounts.find(
          (row) => row.deletedAt === null && row.name === body.data.account,
        );
        if (!account) {
          return apiError(
            400,
            'unknown_account',
            `資産「${body.data.account}」が見つかりません。`,
            'GET /api/v1/accounts で名前を確認してください。',
          );
        }
        accountId = account.id;
      }
    }

    const updated = await updateTransaction(db, householdId, id, {
      type,
      amount: body.data.amount ?? existing.amount,
      occurredOn: body.data.occurredOn ?? existing.occurredOn,
      categoryId: category.id,
      accountId,
      memo: body.data.memo ?? existing.memo,
    });
    if (!updated) return apiError(404, 'not_found', '取引が見つかりません。');
    return noStore({ id: updated.id, updated: true });
  });
}

export function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleApi(request, async ({ householdId }) => {
    const id = parseId((await params).id);
    if (id === undefined) return apiError(404, 'not_found', '取引が見つかりません。');
    const deleted = await deleteTransaction(ledgerDatabase(), householdId, id);
    if (!deleted) return apiError(404, 'not_found', '取引が見つかりません。');
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  });
}
