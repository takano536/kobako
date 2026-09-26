# 技術的判断

## Stack versions

Node.js 24.21.0（`.node-version`）と pnpm 12.6.0 を固定します。TypeScript は 6.0.3 を採用しました。`typescript-eslint` 8.70.1 の peer range が TypeScript 6.1 未満であるため、TypeScript 7 は peer range が対応するまで保留します。Next.js 16.3.6、React 19.3.0、Drizzle ORM 0.45.3、Drizzle Kit 0.31.11、Zod 4.6.5、Vitest 5.0.2、Playwright 1.63.0 を lockfile で固定しています。

PostgreSQL の Compose image は `postgres:18.6-alpine3.24`、Node image は `node:24.21.0-bookworm-slim` とし、`latest` は使いません。

## postgres.js over pg

接続 client は postgres.js を選びました。単純な query/migration と少数 worker 接続に必要な API が小さく、Drizzle の postgres-js adapter と組み合わせられます。health query には接続 timeout と query の短い上限を設けます。

## 家計簿の所有境界

認証導入前でも取引を将来のユーザーへ安全に紐付けられるよう、`households` を明示的な所有境界として先に導入します。固定 well-known UUID と slug `local` の一つだけを idempotent に初期化し、users、sessions、members、invitations、家計切り替え UI は追加しません。将来の認証は household への関連を追加するだけにします。

`@kobako/db` の query/mutation 関数（`listCategories`、`getCategory`、`listTransactions`、`getTransaction`、`getMonthlyTotals`、`getExpenseCategoryTotals`、`createTransaction`、`updateTransaction`、`deleteTransaction`）は `householdId` を明示引数として要求し、内部で `DEFAULT_HOUSEHOLD_ID` を決め打ちしません。共有 package を「単一家計専用」に固定してしまうと、認証導入時に package 内部の書き換えが必要になるためです。household の解決は `apps/web/src/lib/ledger-data.ts` の `getCurrentHouseholdId()` という一箇所だけに閉じ込め、Web 側のすべての Server Component/Server Action がそこを経由します。将来の認証は、この関数の実装をセッションからの導出に差し替えるだけで済みます。

## 金額と日付の型

金額は JPY の正の `integer` とし、上限を `999,999,999` 円に制約します。この上限なら PostgreSQL `int4` に収まり、画面入力の小数・浮動小数点誤差を排除できます。入力は前後空白、先頭の `¥`/`￥`（1 個のみ、記号と数字の間の空白は不可）、ASCII/全角数字、3 桁区切りの ASCII/全角カンマを正規化します。区切りありは先頭 1〜3 桁（0 始まり不可）と後続 3 桁の組み合わせだけ、区切りなしは先頭 0 を許容します。0、`+`/`-` などの符号、小数点（全角含む）、指数表記、崩れた桁区切り、二重の通貨記号、数字以外の混入を拒否し、任意に長い上限超過も上限エラーへ統一します。sum は PostgreSQL で `bigint` になるため、query は文字列へ cast し、差額は JavaScript の `BigInt` で算術を行います。

台帳日付は PostgreSQL `date` と Drizzle の `{ mode: 'string' }` を使い、`YYYY-MM-DD` を文字列のまま処理します。`Date` へ変換して UTC/JST で日付がずれることを避けます。新規登録の初期値は、`?month=` が今月なら `Intl.DateTimeFormat` の `Asia/Tokyo` で求めた今日、それ以外の対象月なら `{month}-01` です。

日付・月が扱う年は 1900〜9998 年に制限します（`packages/db/src/month.ts` の `MIN_SUPPORTED_YEAR`/`MAX_SUPPORTED_YEAR`）。PostgreSQL `date` 自体はこれより広い範囲（紀元前後〜西暦 5874897 年）を扱えますが、`0000-01` のような極端な年が URL 改ざんや壊れたクライアントから届いた場合に PostgreSQL がエラーを返し 500 になることを避けるため、アプリケーション層で安全な範囲へあらかじめ制限し、日本語エラーメッセージで拒否します。`isValidMonth`/`isCalendarDate`/`parseMonth`/`shiftMonth` すべてがこの範囲を守ります。

## カテゴリ整合性

カテゴリの `type`（支出/収入）と household 所有を UI だけに任せず、`transactions(category_id, household_id, type)` から `categories(id, household_id, type)` への複合 FK で DB に強制します。categories 側には複合 FK 用の一意キーを置き、transaction amount、参照、memo 長も not-null/FK/CHECK/varchar で検証します。

## Mutation と再検証

Mutation 機構は Next.js Server Actions に統一します。登録・編集フォームは React 19 の `useActionState` でサーバーから返した入力値と日本語フィールドエラーを表示し、フォーム送信時はクライアント側でも同じ Zod schema を検証しますが（`event.preventDefault()` で不正な送信そのものを止めます）、Server Action は必ず同じ schema と DB 上のカテゴリ照合で再検証します。成功時は対象月の一覧へ redirect し、`revalidatePath` を呼びます。削除は確認チェックを必須にし、`deleteTransaction` が単一の `DELETE ... RETURNING occurred_on` で削除対象の日付を取得します（削除前に別 query で存在確認しません）。行が返らなければ `notFound()` を呼び、削除後は対象月一覧へ redirect して削除済み URL には戻しません。Route Handler、optimistic update、追加キャッシュは使いません。

## server-only パッケージ

`apps/web/src/lib/ledger-data.ts` は DB client と household 解決をこの一箇所に閉じ込めていますが、`server-only` パッケージはこのリポジトリに追加されていない（lockfile に存在しない）ため import していません。Client Component は `@kobako/db/validation` サブパスだけを import し DB client を含まないため、実害はありません。将来 `server-only` を依存として追加する場合はこのファイルの先頭に `import 'server-only'` を足すだけで済みます。

## Worker

worker は今すぐ job を処理しませんが、web request と将来の Import/Export 等を分離するプロセス境界には価値があります。そのため、起動時 DB check、signal による graceful shutdown、idle 待機だけを実装しました。

## Integration test の DB 安全性

integration test は `TEST_DATABASE_URL` を必須とし、`NODE_ENV=production` または非 loopback host を拒否します。対象 database name は `test`/`tests` token を含む test-designated 名に限定し、`DATABASE_URL` とは host alias（`localhost`/`127.0.0.1`/`::1`）、既定 port 5432、database name を正規化した identity が一致しないことを確認します。schema の drop と各テストの truncate の直前には test 接続で `current_database()` と PostgreSQL system identifier を取得し、`DATABASE_URL` が到達可能なら同じ `(system_identifier, current_database())` でないことも検証します。`DATABASE_URL` が到達不能な場合だけ後者の比較を省略します。これにより beforeEach の reset はテスト失敗後も独立して再実行できます。`pg_control_system()` の system identifier query は実行権限を要求し、環境によって superuser/`pg_monitor` 相当が必要です。PostgreSQL 18 の検証 image では非 superuser role の query を確認し、権限を revoke した場合は `could not verify TEST_DATABASE_URL database identity` で fail closed しました。

## E2E データベースの安全性

`apps/web/e2e/ledger.spec.ts` は schema/table を truncate しません。各実行で UUID から `e2e:<UUID>:<test>` の marker を生成し、9000〜9997 年の run-specific な候補月と翌月が default household 内で空であることを DB で確認してから、画面操作の日付に使います。候補が埋まっている場合は既存行を削除せず別候補を探し、空きがなければ失敗します。後処理の DELETE は default household・同じ遠未来範囲・現在 run の marker prefix に限定し、クラッシュした別 run の残骸や同じ年の利用者データを年だけで削除しません。

## Renovate

Dependabot と Renovate の二重運用は避け、Renovate を採用します。pnpm lockfile、workspace、GitHub Actions、Docker base image を更新対象にし、dependency dashboard と grouping は設定しますが、自動 merge は行いません。

## Shared packages

validation、calendar helper、家計簿 schema/query は Web の Server Component/Action と integration test が実際に共有するため `@kobako/db` に置きます。ブラウザ用フォームは DB client を import せず、validation サブパスだけを import します。空の抽象 package は増やしません。

## Next.js generated guidance

Next.js 16 の `next dev` が生成する `apps/web/AGENTS.md` と `apps/web/CLAUDE.md` は、ファイル内の指示どおり削除せず commit します。将来の Next.js 開発時に、該当バージョンの公式ガイドを確認するための開発者向け案内です。
