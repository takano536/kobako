# CI 方針

`.github/workflows/ci.yml` は pull request と `main` への push を対象にします。top-level permission は `contents: read` だけです。PR の古い実行は concurrency で cancel し、各 job に timeout を設定しています。

## Job

- `lint`: Prettier check、ESLint、TypeScript typecheck
- `unit`: Vitest の unit test
- `integration`: `postgres:18.6-alpine3.24` service、空 DB への migration、実 PostgreSQL integration test
- `build`: DB package、Next.js、worker の production build
- `e2e`: PostgreSQL service、migration、production server、Chromium E2E。失敗時に Playwright report/test results を artifact 化
- `docker`: buildx で web/migrate/worker image を load（push なし）し、Compose の migration、web health、DB health を確認
- `publish`: `main` への push かつ全ての既存 job 成功時だけ、1 job 内で web/migrate の SHA image を private GHCR へ push し、両方成功後に `latest` へ retag

## GHCR publish

`publish` は `if` と `needs: [lint, unit, integration, build, e2e, docker]` の両方で `main` push の成功だけを許可します。pull request では既存の `docker` job が image を build/load して検証しますが、registry へ push しません。

publish job は workflow の `contents: read` を継承し、job 単位で `packages: write` だけを追加します。`docker/login-action` は `${{ secrets.GITHUB_TOKEN }}` で `ghcr.io` へ login し、PAT や追加 secret は使いません。対象 image は次の通りです。

- `ghcr.io/takano536/kobako-web`
- `ghcr.io/takano536/kobako-migrate`

publish job は各 SHA tag を先に `docker buildx imagetools inspect --format '{{json .Image}}'` で確認し、inspect が成功して存在が確認できた場合は single/multi-platform の `.config.Labels` を jq で検証してから build/push を skip します。source が `https://github.com/takano536/kobako`、revision が `${{ github.sha }}` と一致しない場合は fail します。inspect が失敗した場合は stderr を notice として記録し、build/push を試みます。これにより first run の package `denied`/`name unknown` 等からも作成を進められ、auth/network error は build/push 自体の失敗として表面化します。両方の SHA tag が検証または push で成功した後、同じ job の `docker buildx imagetools create` で両方を `latest` へ retag します。2 つの package 間の latest promotion は atomic ではなく best-effort です。SHA tag は inspect 成功時に CI が再 push しない運用上の immutable tag ですが、GHCR writer は retag/delete でき、digest（`@sha256:...`）だけが真に immutable です。`KOBAKO_IMAGE_TAG=sha-<full commit SHA>` の pin が web/migrate の整合性を保ちます。将来 worker を publish するときは、この job に worker の SHA 検査、build/push step、promote line を追加します。

BuildKit の `type=gha` cache は target ごとに scope を分け、`docker` job と publish job で共有します。`cache-to` には `ignore-error=true` を付け、optional な cache export 障害で image build/release が失敗しないようにします。PR は自分の ref にだけ cache を書き込み、GitHub Actions の cache ref isolation により `main` から PR cache は読めないため、未検証の差分で main の publish cache を汚染しません。publish は別 runner で同じ commit から rebuild しますが、同じ run の GHA cache を再利用するだけで、byte-for-byte の artifact handoff ではありません。

`KOBAKO_IMAGE_TAG` の rollback は web と migrate の両方を同じ SHA tag へ切り替え、Compose recreate 時にその migrate image をもう一度実行します。migration は forward-only なので、古い SHA tag を指定しても schema の変更は巻き戻りません。schema を戻す必要がある場合は、先に DB backup から復元する手順を用意してください。PostgreSQL の major version bump は image tag の変更だけで行わず、明示的な `pg_upgrade` または dump/restore を実施します。

workflow の `docker` job では `compose.selfhost.yaml config` も安全な検証用 password で確認します。self-host の image は private のため、deploy host で一度だけ GHCR 認証を設定し、`compose.selfhost.yaml` の手順に従ってください。

## Docker の graceful shutdown 検証

Docker job は health check 後に `docker compose stop -t 20` を実行し、worker の終了コードが `0` であることを確認します。web は `0` または `143` を許容します。`143` は Next standalone が HTTP server を graceful に閉じた後の SIGTERM 終了コードです。`137` は SIGKILL または timeout を示すため失敗とし、それ以外の web 終了コードも失敗にします。

すべての Node job は `.node-version` の pinned Node 24.21.0 と pnpm 12.6.0 を使い、`pnpm install --frozen-lockfile` を実行します。CI 用 PostgreSQL の固定 credential は workflow に明示したテスト専用値で、repository secret は渡しません。

External Actions は full commit SHA で固定し、更新時には tag の SHA を GitHub API で確認します。Renovate が package、GitHub Actions、Docker base image の更新 PR を作り、merge は自動化しません。
