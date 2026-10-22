# デモ配備

公開デモ（README 用）と PR プレビューの2つを Cloudflare Workers に配備します。どちらも `apps/web` を [OpenNext Cloudflare](https://opennext.js.org/cloudflare) でビルドし、訪問者ごとに使い捨ての世帯を発行します。分けているのはコードではなく、Worker と DB です。どちらも `workers.dev` のサブドメインで配備するため、独自ドメインは使いません。

|          | 公開デモ                                            | PR プレビュー                                                  |
| -------- | --------------------------------------------------- | -------------------------------------------------------------- |
| URL      | `https://demo.kobako-app.workers.dev`               | `https://pr-<番号>.kobako-app.workers.dev`                     |
| トリガ   | main への push                                      | PR の open / synchronize                                       |
| Worker   | `demo`                                              | `pr-<番号>`（close で削除）                                    |
| 設定     | `apps/web/wrangler.jsonc`                           | `apps/web/wrangler.preview.jsonc`（`PR_NUMBER` を sed で置換） |
| DB       | `DEMO_DATABASE_URL`                                 | `PREVIEW_DATABASE_URL`                                         |
| 保護     | 公開。上限とリセットで守る                          | 公開。上限を50世帯に絞る                                       |
| リセット | 毎日 03:00 JST（`demo-reset.yml`）と main への push | PR への push                                                   |

DB を分けているのは、PR ブランチの migration や濫用が公開デモを壊さないようにするためです。Neon の無料枠はプロジェクト単位（各 100 CU-hours / 1GB）なので、2プロジェクトに分けても費用は変わりません。

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

| name                    | 内容                                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Workers Scripts:Edit を持つ token                                     |
| `CLOUDFLARE_ACCOUNT_ID` | 配備先 account                                                        |
| `DEMO_DATABASE_URL`     | 公開デモ用 PostgreSQL の接続文字列（Neon などの無料枠で可）           |
| `PREVIEW_DATABASE_URL`  | PR プレビュー用 PostgreSQL の接続文字列（公開デモとは別プロジェクト） |
| `DEMO_RESET_TOKEN`      | `/api/demo/reset` の Bearer token。Worker の secret としても渡す      |

3 つが揃っていない場合、workflow は fail せず skip し、job summary に理由を出します。`DEMO_DATABASE_URL` だけが無い場合は、デモ DB を黙って本番相当へ向けないため明示的に fail します。

## 制約

- プレビュー URL は公開されます。認証は無く、**デモデータだけ**が入った DB に接続します。実データの DB を `DEMO_DATABASE_URL` に設定しません。
- プレビューは DB を共有しますが、訪問者は自分の世帯しか読み書きしません。他人の操作が見えることはありません。
- migration は PR ブランチのものが共有 DB に適用されます。schema を壊す migration を含む PR は、他のプレビューも巻き込みます。
- `apps/worker`（定期処理）はプレビューに含めません。
- Workers の script サイズ上限は 64 MiB（uncompressed）で、現在の bundle は約 9.7 MiB です。

## 配備に必要なもの

- `CLOUDFLARE_API_TOKEN` の権限は **Account: Workers Scripts:Edit** だけで足ります（独自ドメインも route も使わないため）
- アカウントで `workers.dev` のサブドメインが有効になっていること（無効だと配備が失敗します）
- 初回配備後の URL は job summary に出ます。現在は `https://demo.kobako-app.workers.dev` で、repository variable `DEMO_URL` に登録済みです。毎日のリセットはこのホストを叩きます

## ローカルでの確認

```sh
pnpm demo:build   # @kobako/db build + OpenNext build
DATABASE_URL=... pnpm demo:seed
```

`wrangler` は `apps/web` の devDependency です。手元で配備する場合は `apps/web` で `pnpm exec wrangler preview --name <name>` を実行します。

## 代替

Worker Previews が使えない場合は `wrangler versions upload --preview-alias <alias>` で version URL を発行できます。ただし production の binding を共有するため、DB を分けたい場合には向きません。
