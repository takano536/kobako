# CI 方針

`.github/workflows/ci.yml` は pull request と `main` への push を対象にします。top-level permission は `contents: read` だけです。PR の古い実行は concurrency で cancel し、各 job に timeout を設定しています。

## Job

- `lint`: Prettier check、ESLint、TypeScript typecheck
- `unit`: Vitest の unit test
- `integration`: `postgres:18.6-alpine3.24` service、空 DB への migration、実 PostgreSQL integration test
- `build`: DB package、Next.js、worker の production build
- `e2e`: PostgreSQL service、migration、production server、Chromium E2E。失敗時に Playwright report/test results を artifact 化
- `docker`: buildx で web/migrate/worker image を load（push なし）し、Compose の migration、web health、DB health を確認

## Docker の graceful shutdown 検証

Docker job は health check 後に `docker compose stop -t 20` を実行し、worker の終了コードが `0` であることを確認します。web は `0` または `143` を許容します。`143` は Next standalone が HTTP server を graceful に閉じた後の SIGTERM 終了コードです。`137` は SIGKILL または timeout を示すため失敗とし、それ以外の web 終了コードも失敗にします。

すべての Node job は `.node-version` の pinned Node 24.21.0 と pnpm 12.6.0 を使い、`pnpm install --frozen-lockfile` を実行します。CI 用 PostgreSQL の固定 credential は workflow に明示したテスト専用値で、repository secret は渡しません。

External Actions は full commit SHA で固定し、更新時には tag の SHA を GitHub API で確認します。Renovate が package、GitHub Actions、Docker base image の更新 PR を作り、merge は自動化しません。
