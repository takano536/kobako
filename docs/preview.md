# PR プレビュー

PR ごとに、実ブラウザで触れるデモを Cloudflare Workers へ配備します。UI の確認をスクリーンショットの添付に頼らず、PR のコメントに出る URL から直接操作するための仕組みです。

## 構成

- `apps/web` を [OpenNext Cloudflare](https://opennext.js.org/cloudflare)（`@opennextjs/cloudflare`）で Worker へビルドします（`apps/web/wrangler.jsonc`、`apps/web/open-next.config.ts`）。
- PR ごとの配備は `wrangler preview --name pr-<番号>`（Worker Previews）で行い、PR を閉じたら `wrangler preview delete` で消します。
- DB は**デモ専用の PostgreSQL** を一つ共有します。workflow が `packages/db/dist/migrate.js` で migration を適用し、`apps/web/scripts/seed-demo.ts` で固定のデモデータを idempotent に投入します（既に account がある家計には何もしません）。
- Worker の接続先は `DATABASE_URL` を `--secrets-file` で配備ごとに渡します。Hyperdrive は使いません（postgres.js が `nodejs_compat` の TCP で直接接続でき、設定を増やさずに済むため）。

## データのリセット

プレビューのデモデータは、**配備のたびに作り直します**。workflow が migration の後に `pnpm demo:reset` を実行し、`transfers`、`transactions`、`accounts` を作り直してから固定のデモデータを入れ直します（口座・カテゴリは残ります）。

手元やプレビューから明示的に作り直す場合は `POST /api/demo/reset` を叩きます。この route は `DEMO_MODE=1` のときだけ有効で、それ以外は 404 を返します（`apps/web/wrangler.jsonc` の `vars` で設定済み）。

ページを開くたびの自動リセットは入れていません。フォーム入力中や送信直後の画面遷移でもサーバーへ問い合わせるため、アクセス単位で初期化すると入力した取引が消えます。レビュー中に書き換えた内容を戻したいときは上記の POST を使います。

## 必要な Secrets

| name                    | 内容                                                      |
| ----------------------- | --------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Workers Scripts:Edit を持つ token                         |
| `CLOUDFLARE_ACCOUNT_ID` | 配備先 account                                            |
| `DEMO_DATABASE_URL`     | デモ専用 PostgreSQL の接続文字列（Neon などの無料枠で可） |

3 つが揃っていない場合、workflow は fail せず skip し、job summary に理由を出します。`DEMO_DATABASE_URL` だけが無い場合は、デモ DB を黙って本番相当へ向けないため明示的に fail します。

## 制約

- プレビュー URL は公開されます。認証は無く、**デモデータだけ**が入った DB に接続します。実データの DB を `DEMO_DATABASE_URL` に設定しません。
- プレビューは DB を共有します。ある PR の操作は他のプレビューにも見えます。
- migration は PR ブランチのものが共有 DB に適用されます。schema を壊す migration を含む PR は、他のプレビューも巻き込みます。
- `apps/worker`（定期処理）はプレビューに含めません。
- Workers の script サイズ上限は 64 MiB（uncompressed）で、現在の bundle は約 9.7 MiB です。

## ローカルでの確認

```sh
pnpm demo:build   # @kobako/db build + OpenNext build
DATABASE_URL=... pnpm demo:seed
```

`wrangler` は `apps/web` の devDependency です。手元で配備する場合は `apps/web` で `pnpm exec wrangler preview --name <name>` を実行します。

## 代替

Worker Previews が使えない場合は `wrangler versions upload --preview-alias <alias>` で version URL を発行できます。ただし production の binding を共有するため、DB を分けたい場合には向きません。
