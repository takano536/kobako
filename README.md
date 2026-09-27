# kobako

日本向けセルフホスト家計簿 Web アプリ **kobako** です。月ごとの収入・支出を記録し、カテゴリ別の支出と収支差額を確認できます。

## 実装済みの機能

- 月次概要（収入合計、支出合計、収支差額、カテゴリ別支出、最近の取引）
- URL の `month=YYYY-MM` による月移動（前月・翌月、未来月も表示可能）
- 収入・支出の新規登録、編集、削除（削除後は対象月の一覧へ redirect し、削除済み URL には戻りません）
- 取引一覧の月・種別・カテゴリ絞り込み
- PostgreSQL の制約による金額、カテゴリ、所有境界の整合性検証
- 日本語の入力エラー表示、キーボード操作、画面幅に応じたレイアウト

`month` が `YYYY-MM` 形式でない場合、または対応年（1900〜9998 年）の範囲外の場合は、現在の Asia/Tokyo の月にフォールバックします。未来月を開いてもデータは自動生成しません。

## 前提ツール

- Node.js 24.21.0（`.node-version`、`>=24.21.0 <25`）
- Corepack（pnpm 12.6.0 を `packageManager` で固定）
- PostgreSQL 17 以上（ローカル開発で Docker を使わない場合）
- Docker Engine / Docker Compose v2（Compose を使う場合）
- Chromium（E2E をローカルで実行する場合）

Docker が使えない環境でも、Node.js とローカル PostgreSQL があればアプリ・migration・unit/integration test を実行できます。

## ローカル起動

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
# .env の DATABASE_URL をローカル PostgreSQL に合わせる
pnpm db:migrate
pnpm dev
```

`http://localhost:3000` にアクセスすると家計簿の月次概要が表示されます。`pnpm dev` は web 開発サーバーを起動します。DB が起動していると `/api/health/db` も `{"status":"ok"}` を返します。

worker は別ターミナルで起動できます。

```sh
pnpm worker:dev
# 停止: Ctrl-C（SIGINT）
```

worker は起動時に DB を確認した後、ジョブを実行せずシグナルを待機します。`SIGTERM`/`SIGINT` で接続を閉じて終了します。

ルートの環境変数を必要とする pnpm script は、Node.js 24 の env-file API（`--env-file-if-exists` または web dev launcher の `process.loadEnvFile`）でリポジトリルートの `.env` を自動的に読み込みます。`.env` がない場合も、外部から環境変数を指定して実行できます。外部環境変数と `.env` に同じキーがある場合は、明示的に指定した外部環境変数が優先されます。シェルで `.env` を source する必要はありません。

## Docker Compose

開発用の値を確認したうえで `.env` を作成し、Compose を起動します。

```sh
cp .env.example .env
# Compose 内の DB URL は COMPOSE_DATABASE_URL を設定しない場合に POSTGRES_* から構成する
docker compose up --build
```

以下が起動します。

- `postgres`: `postgres:18.6-alpine3.24`、named volume 付き
- `migrate`: PostgreSQL が healthy になった後に一度だけ migration と初期データ登録
- `web`: migration 成功後の Next.js standalone サーバー
- `worker`: migration 成功後の待機 worker

Web は `127.0.0.1:3000`、PostgreSQL は `127.0.0.1:5432` にのみ bind します。停止する場合は `docker compose down` を使ってください（`down -v` は DB volume を削除するため、通常の停止では使いません）。Compose の認証情報は開発専用であり、本番へ流用しないでください。

起動後は別ターミナルで Compose の health endpoint と状態を確認できます。

```sh
curl --fail http://127.0.0.1:3000/api/health
curl --fail http://127.0.0.1:3000/api/health/db
docker compose ps
```

どちらの curl も `{"status":"ok"}` を返し、`docker compose ps` の `web` が healthy なら確認完了です。

## 家計簿データと入力ルール

現在は認証導入前の単一所有境界です。`households` に固定 ID のローカル家計（slug `local`）を一つ作成し、将来の認証でユーザーをこの境界へ関連付けられる形にしています。家計の切り替え UI はありません。`@kobako/db` の query/mutation 関数はすべて `householdId` を明示的な引数として受け取り、Web 側は `apps/web/src/lib/ledger-data.ts` の一箇所だけで対象 household を解決します（将来の認証実装時はこの一箇所だけ差し替えます）。

初期カテゴリは migration 実行時の idempotent な初期化関数で登録されます。

- 支出: 食費、日用品、住居、水道・光熱、通信、交通、医療、娯楽、その他
- 収入: 給与、臨時収入、その他

金額は JPY の正の整数で、`999,999,999` 円以下です。入力では前後の空白、先頭の `¥`/`￥`（1 個のみ。記号と数字の間に空白は不可）、ASCII または全角数字、ASCII または全角カンマを受け付けます。カンマ区切りは先頭グループが 1〜3 桁（0 始まり不可）で、後続が 3 桁の形式だけです。区切りなしの数字は先頭 0 を許容しますが、値 0 自体は拒否します。次はすべて拒否します: 0、負号・`+` などの符号、小数点（`.` 全角含む）、指数表記（`1e3`）、崩れた 3 桁区切り（`1,2345`、`1234,567`、`0,100`）、二重の通貨記号（`¥¥100`）、数字以外の文字混入（`12a`）、上限超過（桁数に関わらず上限エラー）。メモは前後を trim し、空文字または 200 文字以内を保存します。

日付はタイムゾーン変換をしない PostgreSQL `date` と `YYYY-MM-DD` 文字列で扱います。新規登録の日付初期値は、`?month=` が今月なら Asia/Tokyo の今日、それ以外の対象月なら `{month}-01` です。日付・月の対応年は 1900〜9998 年（PostgreSQL `date` が扱える範囲のうち、実用上十分な範囲を安全側に制限）で、範囲外は日本語エラーメッセージで拒否します。

## Migration

schema は `system_healthchecks`、`households`、`categories`、`transactions` で構成されます。生成済み SQL と Drizzle metadata は `packages/db/drizzle/` に commit します。

```sh
pnpm db:generate                 # schema 変更時に SQL と metadata を生成
pnpm db:migrate                  # 空の DB を含む対象 DB に適用し、初期家計・カテゴリも登録
```

`runMigrations` は migration 適用後に固定ローカル家計と初期カテゴリを `ON CONFLICT DO NOTHING` で登録します。migration を再実行しても重複しません。開発用 DB、integration test DB、E2E DB は必ず分けてください。

## Test / build

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

`db:generate`、`db:migrate`、`test:integration`、`test:e2e` もルートの `.env` を自動的に読み込みます。`.env` を使わずに実行する場合は、Fish と Bash のどちらでも使える `env` コマンドなどで `DATABASE_URL` と `TEST_DATABASE_URL` を外部から指定してください。

E2E は `pnpm build` 後の production standalone server を Playwright の `webServer` から起動します。E2E 用の専用 DB を `TEST_DATABASE_URL` に指定し、先に `DATABASE_URL="$TEST_DATABASE_URL" pnpm db:migrate` を実行してください。Playwright の web server も `TEST_DATABASE_URL` を使います。`DATABASE_URL` を別の reference DB として設定する場合は、到達可能で、test DB と異なる DB にしてください。未設定なら reference DB の比較は行わず、test DB 自体の identity を検証します。

integration test は `TEST_DATABASE_URL` が必須で、loopback host の test-designated database（名前に `test` または `tests` の token を含む）だけを許可します。`DATABASE_URL` と host alias（`localhost`/`127.0.0.1`/`::1`）、port（既定値 5432）、database name が同じ場合も失敗します。schema の drop/truncate 前には接続先の `current_database()` と PostgreSQL の system identifier を確認し、`DATABASE_URL` が設定されている場合は接続・identity 検証まで成功しなければ、同じ DB かどうかにかかわらず破壊的 SQL を実行せず fail closed します。system identifier query の `pg_control_system()` は実行権限が必要です（環境によって superuser または `pg_monitor` 相当を要求する場合があります）。権限不足なら integration test は破壊的 SQL を実行せず fail closed します。PostgreSQL 18 の検証 image では、明示的な非 superuser role でも関数実行権限がある限り query は通り、権限を revoke すると fail closed になります。

**E2E は専用の DB で実行してください。** `apps/web/e2e/ledger.spec.ts` は schema/table を truncate せず、各実行で `e2e:<UUID>:<test>` 形式の run-unique marker をメモへ付け、対象 household のその marker の行だけを後処理で削除します。テスト月は run UUID から 9000〜9997 年の範囲で選び、対象月と翌月が household 内で空であることを DB で確認してから使います。空きがなければ既存データを削除せず、明確に失敗します。クラッシュした実行の残骸も marker が一致しない限り削除しません。

## CI 概要

`.github/workflows/ci.yml` は pull request と `main` への push で実行します。外部 Action は full SHA pin です。Required status checks には次の job 名を指定できます。

- `lint`: format check、ESLint、TypeScript
- `unit`: Vitest unit tests
- `integration`: PostgreSQL service、migration、Vitest integration tests
- `build`: production build
- `e2e`: PostgreSQL service、migration、production E2E、失敗時 artifact
- `docker`: 3 target の image build、Compose 起動、migration、web/DB health

CI の PostgreSQL 認証情報は workflow 内の固定 CI 専用値であり、repository secret や本番 secret ではありません。Docker job は registry へ push しません。

## ディレクトリ構成

```text
apps/
  web/                    # Next.js App Router、家計簿画面、health endpoints
  worker/                 # DB 確認後に idle 待機する worker
packages/db/              # Drizzle schema、migration、家計簿 query、validation
packages/db/drizzle/      # commit 対象の生成済み migration
.github/workflows/ci.yml  # lint/unit/integration/build/e2e/docker
compose.yaml              # 開発用 PostgreSQL とアプリ群
Dockerfile                # web/migrate/worker multi-stage image
```

依存方向は apps → packages です。DB 接続や query は `@kobako/db` に置き、Web のサーバーコードからだけ利用します。ブラウザ側のフォームは DB client を import せず、共有 validation schema と型だけを利用します。

## 環境変数

`.env.example` は開発専用のサンプルです。実際の秘密情報を commit しないでください。

- `DATABASE_URL`: web、worker、migration が使う PostgreSQL URL（サーバーコードで遅延検証）。integration test の `TEST_DATABASE_URL` と併用する場合は、到達可能な reference DB として test DB と異なる接続先にします。E2E では未設定でも実行できます。
- `TEST_DATABASE_URL`: integration test と E2E の専用 URL。loopback host の test-designated database（名前に `test` または `tests` の token を含む）を指定し、`DATABASE_URL` と host alias・port・database name が異なる必要があります。`NODE_ENV=production` では integration test の破壊的 reset は拒否されます。E2E の web server と後処理はこの URL の DB を使います。
- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`: Compose の開発用 PostgreSQL のユーザー、パスワード、DB 名
- `COMPOSE_DATABASE_URL`: Compose ネットワーク内から PostgreSQL へ接続する URL。未設定時は `POSTGRES_*` の値から開発用既定 URL を構成する。接続情報に URL 予約文字を含める場合は、percent-encoding 済みの URL を設定する

認証、アップロード、AI 用の未実装設定や秘密情報はこの段階では追加していません。

## 未実装機能

ユーザー認証、複数ユーザー・家計切り替え、カテゴリ管理 UI、口座・残高・振替、予算・定期取引、カード請求、Import/Export/CSV、銀行連携、OCR・添付、PWA・オフライン、AI、通知、バックアップ UI、worker job、本番デプロイ、GHCR 公開は対象外です。

## トラブルシューティング

- **`DATABASE_URL` エラー**: PostgreSQL URL（`postgresql://` または `postgres://`）を指定し、開発 DB と test DB を分けてください。
- **`/api/health` は OK だが `/api/health/db` が 503**: PostgreSQL の起動、port、認証情報、migration、URL の hostname を確認してください。health response は内部エラーを返しません。サーバーログには secret を含まない接続先だけが出ます。
- **Compose の接続先エラー**: コンテナ内の DB hostname は `postgres` です。`.env` に `DATABASE_URL=...@localhost` を置く場合は、Compose 用に `COMPOSE_DATABASE_URL=...@postgres` を指定してください。
- **integration test / E2E が拒否される**: `TEST_DATABASE_URL` を設定し、`kobako_test` のように名前に区切られた `test`/`tests` token を含む loopback DB を指定してください。`DATABASE_URL` を設定する場合は到達可能な別 DB を指定し、同じ DB、localhost/127.0.0.1/::1 の host alias、port 5432（既定値）、database name が同じ場合や、`NODE_ENV=production` の場合は安全のため拒否されます。
- **Chromium がない**: `pnpm exec playwright install chromium`（CI は `--with-deps`）を実行してください。
- **Docker がない**: Docker Compose の確認はできませんが、ローカル PostgreSQL を用意すれば Node.js 側の migration、health、test、build は実行できます。
