import {
  apiTransferPatchSchema,
  deleteTransfer,
  getTransfer,
  listAccounts,
  updateTransfer,
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
    if (id === undefined) return apiError(404, 'not_found', '振替が見つかりません。');
    const parsed = await readJson(request);
    if (!parsed.ok) return parsed.response;
    const body = apiTransferPatchSchema.safeParse(parsed.body);
    if (!body.success) return invalidBody(body.error);

    const db = ledgerDatabase();
    const existing = await getTransfer(db, householdId, id);
    if (!existing) return apiError(404, 'not_found', '振替が見つかりません。');
    const accounts = await listAccounts(db, householdId);
    const findAccount = (name: string) =>
      accounts.find((row) => row.deletedAt === null && row.name === name);

    const fromName = body.data.from ?? existing.fromAccountName;
    const toName = body.data.to ?? existing.toAccountName;
    const from = findAccount(fromName);
    if (!from) {
      return apiError(400, 'unknown_account', `資産「${fromName}」が見つかりません。`, 'GET /api/v1/accounts で名前を確認してください。');
    }
    const to = findAccount(toName);
    if (!to) {
      return apiError(400, 'unknown_account', `資産「${toName}」が見つかりません。`, 'GET /api/v1/accounts で名前を確認してください。');
    }
    if (from.id === to.id) {
      return apiError(400, 'same_account', '振替元と振替先が同じです。', '別の資産を指定してください。');
    }
    const result = await updateTransfer(db, householdId, id, {
      fromAccountId: from.id,
      toAccountId: to.id,
      amount: body.data.amount ?? existing.amount,
      occurredOn: body.data.occurredOn ?? existing.occurredOn,
      memo: body.data.memo ?? existing.memo,
    });
    if (result.status === 'not_found') return apiError(404, 'not_found', '振替が見つかりません。');
    if (result.status === 'validation_error') {
      return apiError(400, 'invalid_transfer', '振替を更新できません。', result.code);
    }
    if (result.status !== 'ok') {
      return apiError(500, 'write_failed', '更新に失敗しました。', '時間をおいて再試行してください。');
    }
    return noStore({ id: result.transfer.id, updated: true });
  });
}

export function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleApi(request, async ({ householdId }) => {
    const id = parseId((await params).id);
    if (id === undefined) return apiError(404, 'not_found', '振替が見つかりません。');
    const deleted = await deleteTransfer(ledgerDatabase(), householdId, id);
    if (deleted.status !== 'ok') return apiError(404, 'not_found', '振替が見つかりません。');
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  });
}
