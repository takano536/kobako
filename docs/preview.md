# PR プレビュー

PR ごとに、実ブラウザで触れるデモを Cloudflare Workers へ配備します。UI の確認をスクリーンショットの添付に頼らず、PR のコメントに出る URL から直接操作するための仕組みです。

## 構成

- `apps/web` を [OpenNext Cloudflare](https://opennext.js.org/cloudflare)（`@opennextjs/cloudflare`）で Worker へビルドします（`apps/web/wrangler.jsonc`、`apps/web/open-next.config.ts`）。
- PR ごとの配備は `wrangler preview --name pr-<番号>`（Worker Previews）で行い、PR を閉じたら `wrangler preview delete` で消します。
- DB は**デモ専用の PostgreSQL** を一つ共有します。workflow が `packages/db/dist/migrate.js` で migration を適用し、`apps/web/scripts/seed-demo.ts` で固定のデモデータを idempotent に投入します（既に account がある家計には何もしません）。
- Worker の接続先は `DATABASE_URL` を `--secrets-file` で配備ごとに渡します。Hyperdrive は使いません（postgres.js が `nodejs_compat` の TCP で直接接続でき、設定を増やさずに済むため）。

## 訪問者ごとの世帯

`DEMO_MODE=1` の配備では、訪問者は共有の台帳ではなく**自分専用の世帯**を受け取ります。`/demo/start` が世帯・カテゴリ・デモデータを作成し、`kobako-demo-household` cookie（HttpOnly / SameSite=Lax / 24時間）で結び付けます。cookie の無いページ表示は `/demo/start` へ送られ、世帯が消えていれば作り直されます。本番経路（`DEMO_MODE` 無し）は従来どおり `DEFAULT_HOUSEHOLD_ID` の単一世帯です。

荒らしと容量の上限は `provisionDemoHousehold()` が担保します。

| 設定          | 値      | 意味                                                                         |
| ------------- | ------- | ---------------------------------------------------------------------------- |
| 世帯数の上限  | 200     | 到達したら最古の世帯を削除して枠を作る。ストレージは約2MBで固定              |
| 生存期間      | 24時間  | 発行時に期限切れの世帯を掃除する（cleanup が動かない日があっても上限が効く） |
| 1世帯のデータ | 約4.3KB | 口座4・取引27・振替1・カテゴリ類                                             |

`POST /api/demo/reset` は全訪問者の世帯を削除します。`DEMO_RESET_TOKEN` を設定した配備では `Authorization: Bearer <token>` が必須で、未設定なら 401 を返します。配備前には CI が `pnpm demo:purge` で同じ掃除を行います。

## 必要な Secrets

| name                    | 内容                                                      |
| ----------------------- | --------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Workers Scripts:Edit を持つ token                         |
| `CLOUDFLARE_ACCOUNT_ID` | 配備先 account                                            |
| `DEMO_DATABASE_URL`     | デモ専用 PostgreSQL の接続文字列（Neon などの無料枠で可） |

3 つが揃っていない場合、workflow は fail せず skip し、job summary に理由を出します。`DEMO_DATABASE_URL` だけが無い場合は、デモ DB を黙って本番相当へ向けないため明示的に fail します。

## 制約

- プレビュー URL は公開されます。認証は無く、**デモデータだけ**が入った DB に接続します。実データの DB を `DEMO_DATABASE_URL` に設定しません。
- プレビューは DB を共有しますが、訪問者は自分の世帯しか読み書きしません。他人の操作が見えることはありません。
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
