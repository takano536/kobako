# CI 方針

`.github/workflows/ci.yml` は pull request、`main` への push、Release Please workflow からの `workflow_call` を対象にします。pull request では検証だけを行い、GHCR へ push しません。top-level permission は `contents: read` で、GHCR 権限は `publish` job だけに付与します。外部 Action は full commit SHA pin です。

## Quality gates

- `lint`: Prettier check、ESLint、TypeScript typecheck
- `unit`: Vitest の unit test
- `integration`: `postgres:18.6-alpine3.24` service、空 DB への migration、実 PostgreSQL integration test
- `build`: DB package、Next.js、worker の production build
- `e2e`: PostgreSQL service、migration、production server、Chromium E2E。失敗時に Playwright report/test results を artifact 化
- `docker`: buildx で web/migrate/worker image を load（push なし）し、Compose の migration、web health、DB health、self-host Compose の config を確認
- `publish`: 上記すべての成功後に、イベントに応じた image tag を private GHCR へ push

Release Please の `release-ci` job は tag 作成後にこの reusable workflow を呼び、tag が指す commit に対して quality gates をもう一度実行します。reusable workflow 内の `github` context は caller workflow のものなので、release mode は `inputs.release_tag` が空でないことだけで判定します（呼び出し元が `push` でも release tag を使います）。通常の main push 実行と release 呼び出し実行は別 concurrency group なので、同じ commit でも互いに cancel しません。

## Publish matrix

| event                                     | web / migrate tag | OCI `version` label | `latest`              |
| ----------------------------------------- | ----------------- | ------------------- | --------------------- |
| `pull_request`                            | push なし         | push なし           | 変更なし              |
| `main` push                               | `sha-<full SHA>`  | `sha-<full SHA>`    | 同じ SHA から promote |
| Release Please `workflow_call` (`vX.Y.Z`) | `X.Y.Z`           | `X.Y.Z`             | 変更なし              |

main push は従来どおり SHA tag を inspect し、source/revision が一致する場合は再 push しません。既存 SHA image との互換性のため、main mode では version label を検証対象外とします。成功後だけ web と migrate の `latest` を promote します。`latest` は main の最新成功 build を指す試用・手動確認用で、release job はこれを後退させません。

Release tag は小さなローカル実行可能 script (`scripts/compute-release-tags.sh`) で計算します。`^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$` に一致しない tag は fail し、push しません。release job はさらに remote tag が `github.sha` を指すことを確認します。既存の `X.Y.Z` image は OCI source/revision/version label を検証し、異なる revision（または不明な内容）なら上書きせず fail します。`X.Y` や `X` は作成しません。

新しく build する image には次の OCI label を付与します。既存 main SHA image の再利用では、互換性のため version label は必須ではありません。

- `org.opencontainers.image.source=https://github.com/takano536/kobako`
- `org.opencontainers.image.revision=<github.sha>`
- `org.opencontainers.image.version=X.Y.Z`（release）、または `sha-<github.sha>`（main の新規 build）

release tag の既存 image は source/revision/version の 3 つすべてを検証し、main の既存 SHA image は source/revision だけを検証します。
Docker job と publish job は build args にも source/revision/version を渡します。web と migrate は同じ commit から同じ version で build します。worker は CI で build しますが GHCR へは publish しません。

## 権限と GHCR

`publish` job だけが `contents: read` と `packages: write` を持ち、`${{ secrets.GITHUB_TOKEN }}` で `ghcr.io` へ login します。Release Please job は `contents: write` と `pull-requests: write` だけを持ち、tag/Release を作成した同じ workflow run から `release-ci` を呼びます。`autorelease: pending` と `autorelease: tagged` label は事前作成が必要で、削除時は権限を広げず再作成します。タグ push trigger は追加していません（GITHUB_TOKEN で作成した tag は他 workflow を起動しないためです）。

self-host Compose の production image は full SemVer へ固定し、`latest` は使いません。private GHCR を pull する deploy host と Renovate 利用側には `read:packages` 認証が必要です。

## Docker の graceful shutdown 検証

Docker job は health check 後に `docker compose stop -t 20` を実行し、worker の終了コードが `0` であることを確認します。web は `0` または `143` を許容します。`137` は SIGKILL または timeout を示すため失敗とし、それ以外の web 終了コードも失敗にします。通常の cleanup は `docker compose down --volumes --remove-orphans` ですが、これは CI 専用環境にだけ実行されます。

すべての Node job は `.node-version` の pinned Node 24.21.0 と pnpm 12.6.0 を使い、`pnpm install --frozen-lockfile` を実行します。CI 用 PostgreSQL の固定 credential は workflow に明示したテスト専用値で、repository secret は渡しません。Renovate は package、GitHub Actions、Docker base image の更新 PR を作りますが、自動 merge は行いません。
