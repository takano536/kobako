# kobako

日本向けセルフホスト家計簿 Web アプリ **kobako** のリポジトリです。

現在は、家計簿の本機能に先立つ**開発基盤段階**です。Next.js の最小ページ、PostgreSQL/Drizzle の疎通確認、worker の境界、テスト、Docker Compose、CI を動かせる状態を保ちます。

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

`http://localhost:3000` にアクセスすると `kobako` が表示されます。`pnpm dev` は web 開発サーバーを起動します。DB が起動していると `/api/health/db` も `{"status":"ok"}` を返します。

worker は別ターミナルで起動します。

```sh
pnpm worker:dev
# 停止: Ctrl-C（SIGINT）
```

ルートの環境変数を必要とする pnpm script は、Node.js 24 の env-file API（`--env-file-if-exists` または web dev launcher の `process.loadEnvFile`）でリポジトリルートの `.env` を自動的に読み込みます。`.env` がない場合も、外部から環境変数を指定して実行できます。外部環境変数と `.env` に同じキーがある場合は、明示的に指定した外部環境変数が優先されます。シェルで `.env` を source する必要はありません。

worker は起動時に DB を確認した後、ジョブを実行せずシグナルを待機します。`SIGTERM`/`SIGINT` で接続を閉じて終了します。

## Docker Compose

開発用の値を確認したうえで `.env` を作成し、Compose を起動します。

```sh
cp .env.example .env
# Compose 内の DB URL は COMPOSE_DATABASE_URL を設定しない場合に POSTGRES_* から構成する
docker compose up --build
```

以下が起動します。

- `postgres`: `postgres:18.6-alpine3.24`、named volume 付き
- `migrate`: PostgreSQL が healthy になった後に一度だけ migration
- `web`: migration 成功後の Next.js standalone サーバー
- `worker`: migration 成功後の待機 worker

Web は `127.0.0.1:3000`、PostgreSQL は `127.0.0.1:5432` にのみ bind します。停止する場合は `docker compose down` を使ってください（`down -v` は DB volume を削除するため、通常の停止では使いません）。Compose の認証情報は開発専用であり、本番へ流用しないでください。

起動後は別ターミナルで Compose の health endpoint を確認できます。

```sh
curl --fail http://127.0.0.1:3000/api/health
curl --fail http://127.0.0.1:3000/api/health/db
docker compose ps
```

どちらの curl も `{"status":"ok"}` を返し、`docker compose ps` の `web` が healthy なら確認完了です。

## 環境変数

`.env.example` は開発専用のサンプルです。実際の秘密情報を commit しないでください。

- `DATABASE_URL`: web、worker、migration が使う PostgreSQL URL（サーバーコードで遅延検証）
- `TEST_DATABASE_URL`: integration test 専用 URL。`DATABASE_URL` と異なる DB を指定
- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`: Compose の開発用 PostgreSQL のユーザー、パスワード、DB 名
- `COMPOSE_DATABASE_URL`: Compose ネットワーク内から PostgreSQL へ接続する URL。未設定時は `POSTGRES_*` の値から開発用既定 URL を構成する。接続情報に URL 予約文字を含める場合は、percent-encoding 済みの URL を設定する

認証、アップロード、AI 用の未実装設定や秘密情報はこの段階では追加していません。

## Migration

schema は DB 接続確認だけを目的とする `system_healthchecks` テーブル一つです。生成済み SQL は `packages/db/drizzle/` に commit します。

```sh
pnpm db:generate                 # schema 変更時に SQL を生成
pnpm db:migrate                  # 空の DB を含む対象 DB に適用
```

migration runner は Drizzle ORM の `migrate` を利用します。開発用 DB と test DB は必ず分けてください。

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

E2E は `pnpm build` 後の production standalone server を Playwright の `webServer` から起動します。E2E 用 DB へ先に `pnpm db:migrate` を適用してください。integration test は `TEST_DATABASE_URL` がない場合、または `DATABASE_URL` と同じ場合に失敗します。

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
  web/                    # Next.js App Router と health endpoints
  worker/                 # DB 確認後に idle 待機する worker
packages/
  db/                     # Drizzle schema、client、env、migration
packages/db/drizzle/      # commit 対象の生成済み migration
.github/workflows/ci.yml  # lint/unit/integration/build/e2e/docker
compose.yaml              # 開発用 PostgreSQL とアプリ群
Dockerfile                # web/migrate/worker multi-stage image
```

共有ドメイン package は、現時点では実際に共有する domain code がないため作っていません。DB 接続、env 検証、secret redaction は `@kobako/db` に集約しています。

## トラブルシューティング

- **`DATABASE_URL` エラー**: PostgreSQL URL (`postgresql://` または `postgres://`) を指定し、開発 DB と test DB の URL を分けてください。
- **`/api/health` は OK だが `/api/health/db` が 503**: PostgreSQL の起動、port、認証情報、migration、URL の hostname を確認してください。health response は内部エラーを返しません。サーバーログには secret を含まない接続先だけが出ます。
- **Compose の接続先エラー**: コンテナ内の DB hostname は `postgres` です。`.env` に `DATABASE_URL=...@localhost` を置く場合は、Compose 用に `COMPOSE_DATABASE_URL=...@postgres` を指定してください。
- **integration test が拒否される**: `TEST_DATABASE_URL` を設定し、`DATABASE_URL` と異なる DB を使ってください。
- **Chromium がない**: `pnpm exec playwright install chromium`（CI は `--with-deps`）を実行してください。
- **Docker がない**: Docker Compose の確認はできませんが、ローカル PostgreSQL を用意すれば Node.js 側の migration、health、test、build は実行できます。

## 未実装機能

ユーザー、認証、家計、口座、取引、カテゴリ、カード請求、Import/Export、PWA、AI、バックアップ/restore、ジョブキュー、本番デプロイ、GHCR 公開は本基盤の対象外です。worker は将来の非同期処理の境界だけを提供します。
