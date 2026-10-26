import { handleApi, noStore } from '../../../src/lib/api-contract';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET(request: Request): Promise<Response> {
  return handleApi(request, async () =>
    noStore({
      name: 'kobako',
      resources: {
        accounts: '/api/v1/accounts',
        categories: '/api/v1/categories',
        transactions: '/api/v1/transactions',
        transfers: '/api/v1/transfers',
      },
      notes: [
        'カテゴリと資産は名前で指定します。',
        'externalId は任意です。省略すると日付・金額・メモから指紋を作ります。',
        '重複した行はエラーではなく skipped として返します。',
        '一括登録は ?dry_run=1 で確認できます。',
      ],
    }),
  );
}
