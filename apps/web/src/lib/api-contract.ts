import { NextResponse } from 'next/server';

import { toApiIssues, type ApiBatchResult } from '@kobako/db';

import { API_TOKEN_ENV, authorizeApiRequest } from './api-auth';
import { getLedgerDatabase } from './ledger-data';

export function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function apiError(
  status: number,
  code: string,
  message: string,
  hint?: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return noStore({ error: { code, message, ...(hint ? { hint } : {}), ...extra } }, status);
}

/** Auth gate plus one place for unexpected failures, so no handler leaks a stack trace. */
export async function handleApi(
  request: Request,
  handler: (context: { householdId: string; url: URL }) => Promise<Response>,
): Promise<Response> {
  const auth = await authorizeApiRequest(request);
  if (auth.status === 'disabled') {
    return apiError(
      503,
      'api_disabled',
      'この API は無効です。',
      `${API_TOKEN_ENV} を設定した配布で起動してください。`,
    );
  }
  if (auth.status === 'unauthorized') {
    return apiError(
      401,
      'unauthorized',
      'Authorization ヘッダーが正しくありません。',
      'Bearer <token> の形式で送ってください。',
    );
  }
  try {
    return await handler({ householdId: auth.householdId, url: new URL(request.url) });
  } catch (error) {
    console.error('[api] unhandled failure', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return apiError(
      500,
      'internal_error',
      '処理に失敗しました。',
      '時間をおいて再試行してください。',
    );
  }
}

export async function readJson(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return {
      ok: false,
      response: apiError(
        400,
        'invalid_json',
        'JSON として読めませんでした。',
        'Content-Type: application/json で送ってください。',
      ),
    };
  }
}

export function invalidBody(error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): NextResponse {
  return apiError(400, 'invalid_body', '入力が正しくありません。', undefined, {
    issues: toApiIssues(error),
  });
}

/**
 * One status rule for every bulk write: 201 only when a row was actually written, and 400 when
 * no row could be written, so the per-row `hint`s are not hidden behind a success status.
 */
export function batchResponse(result: ApiBatchResult, dryRun: boolean): Response {
  if (result.status === 'error') {
    return apiError(
      500,
      'write_failed',
      '登録に失敗しました。',
      '時間をおいて再試行してください。',
    );
  }
  if (result.status === 'ok' && result.errors > 0 && result.created === 0 && result.skipped === 0) {
    return noStore(
      {
        ...result,
        dryRun,
        error: {
          code: 'rows_rejected',
          message: '登録できる行がありませんでした。',
          hint: 'rows の各 hint を見て修正してから再送してください。',
        },
      },
      400,
    );
  }
  return noStore({ ...result, dryRun }, !dryRun && result.created > 0 ? 201 : 200);
}

export function parseId(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647 ? id : undefined;
}

export function ledgerDatabase() {
  return getLedgerDatabase();
}
