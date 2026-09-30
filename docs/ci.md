# CI 方針

`.github/workflows/ci.yml` は pull request、`main` への push、手動 `workflow_dispatch` を対象にします。quality gate の job 名 (`lint`、`unit`、`integration`、`build`、`e2e`、`docker`) は既存の required status checks と同じです。外部 Action は full commit SHA pin です。

pull request では検証だけを行い、GHCR へ push しません。fork の pull request に write 権限や repository secret は渡しません。top-level permission は `contents: read` で、書き込み権限は main push の後段 job にだけ job 単位で付与します。

## main の job graph

```text
pull_request ────────────> lint ─┐
workflow_dispatch ───────> unit ─┤
main push ───────────────> integration ─┤
                         build ──────────┤──> release_please ──> release_pr_checks
                         e2e ────────────┤                    ├──> publish_main
                         docker ─────────┘                    └──> publish_release
```

quality gate job は `github.sha` を明示的に checkout します。`publish_release` だけは guard 済みの Release PR merge SHA を checkout します。`release_please` は push to main かつ全 quality gate 成功の場合だけ実行し、job permission は必要最小限の次の三つです。

```yaml
contents: write
pull-requests: write
checks: read
```

対象 commit がその時点の main tip でない場合、Release Please は skip します。main の run は concurrency group で直列化し、実行中の release run を cancel しません。pull request と手動 dispatch の queued check は同じ ref の新しい check で置き換えられます。

`release_please` の Release Please action 呼び出しは `skip-github-release` を明示的に制御します。guard (`scripts/verify-release-merge.sh`) が merge 済み `autorelease: pending` PR を実際に見つけて必須 check の成功を検証できた場合だけ tag/Release 作成を許可し、それ以外（guard が検出できなかった通常 push を含む）は常に `skip-github-release: true` で fail closed にします。`gh pr list --label` は search index 経由で結果が返ることがあり、guard 自身の検出が最新でない可能性があるため、action 内部の独立した検出だけを信用して tag を作らせません。

`release_pr_checks` は Release Please の open PR output を検証し、同じ repository の Release PR head branch に `gh workflow run ci.yml --ref ...` を dispatch します。権限は `actions: write` と `contents: read` だけです。`workflow_dispatch` では quality gate だけが実行され、Release Please と publish は skip します。

`publish_main` と `publish_release` は quality gate 成功後にだけ実行され、job permission は次の二つだけです。

```yaml
contents: read
packages: write
```

`publish_main` は `latest` を promote する直前に main tip を再度 `git ls-remote` で確認します。失敗した run を後から **Re-run failed jobs** で再実行しても、その時点で main が先に進んでいれば `latest` を古い image へ戻しません。`publish_release` は `release_please` の job 全体の成功ではなく、release 作成 step が既に設定した `release_created`/`release_merge_sha` output の有無で判定します。Release Please action は内部で release 作成後に Release PR 更新を行うため、後半の PR 更新 step だけが失敗しても、既に作成された tag と GitHub Release に対応する image の publish が block されません。

## Quality gates

- `lint`: Prettier check、Release Please 生成物 validator、ESLint、TypeScript typecheck
- `unit`: Vitest の unit test
- `integration`: `postgres:18.6-alpine3.24` service、空 DB への migration、実 PostgreSQL integration test
- `build`: DB package、Next.js、worker の production build
- `e2e`: PostgreSQL service、migration、production server、Chromium E2E。失敗時に Playwright report/test results を artifact 化
- `docker`: buildx で web/migrate/worker image を load（push なし）し、標準 Compose（独立 `migrate` サービスなし）を起動して web image の起動前 migration、web image 内の migrator 一式、standalone `migrate` image の冪等実行、web/DB health、DB-backed page、web/worker の継続起動、graceful shutdown を確認する。`migrate` target の build は手動・高度な運用向け互換性のため継続する。

`.release-please-manifest.json` と `release-please-config.json` は JSON として parse し、root version と workspace version の整合性を確認します。Release Please が設定する generic extra-file がある場合は、`# x-release-please-version` marker と version も確認します。`CHANGELOG.md` がある場合は先頭を `# Changelog` 見出しにします。生成物は Release Please 所有の canonical output なので Prettier からは除外しますが、validator とレビューの対象です。

## Publish matrix

| event / result                       | web / migrate tag                        | OCI `version` label              | `latest`                        |
| ------------------------------------ | ---------------------------------------- | -------------------------------- | ------------------------------- |
| `pull_request`                       | push なし                                | push なし                        | 変更なし                        |
| `workflow_dispatch`                  | push なし                                | push なし                        | 変更なし                        |
| main push、Release Please が未作成   | `sha-<full SHA>` (current main commit)   | `sha-<full SHA>`                 | current main image から promote |
| main push、`release_created == true` | `X.Y.Z` (Release PR merge commit) と SHA | `X.Y.Z` (release merge revision) | current main image から promote |

release output は厳密な `^vX.Y.Z$` のみを受け付けます。SemVer publish は origin にその tag が存在し、tag commit が guard 済みの Release PR merge SHA と一致することを確認してから GHCR に push します。GHCR tag は `X.Y.Z` に変換します。`X.Y` や `X` の可変 SemVer tag は作成しません。

既存の `X.Y.Z` tag は OCI の source、revision、version の三つを検査します。同じ revision なら再実行で skip できます。異なる revision、欠落 label、不明な manifest は fail し、別 commit で上書きしません。web と migrate は同じ Release PR merge commit から同じ version を作成します。worker は quality gate で build しますが GHCR へは publish しません。

## 権限と Release PR

Release PR は `GITHUB_TOKEN` で作成されるため、GitHub の仕様上、その PR 作成イベントから `pull_request` workflow は自動起動しません。`release_pr_checks` は action が返す open Release PR の head branch に `workflow_dispatch` を送り、quality gate を実行します。必要な check が存在しない Release PR を required status check にすることは避け、main に merge された正確な commit の gate も Release Please 実行前に必須化します。Release PR の close/reopen、空 commit、追加 PAT、広い secret は不要です。

タグ push trigger は追加していません。GITHUB_TOKEN で作成した tag は別 workflow を起動しないため、同じ main run の output を publish job に渡します。`autorelease: pending` と `autorelease: tagged` label は事前作成が必要で、削除時も権限を広げず再作成します。

private GHCR の image を pull する環境には `read:packages` 認証が必要です。正式版を追跡する利用側は full SemVer を使用し、`latest` は使いません。

## Docker の graceful shutdown 検証

Docker job は health check 後に `docker compose stop -t 20` を実行し、worker の終了コードが `0` であることを確認します。web は `0` または `143` を許容します。`137` は SIGKILL または timeout を示すため失敗とし、それ以外の web 終了コードも失敗にします。通常の cleanup は CI 専用環境にだけ実行されます。

すべての Node job は `.node-version` の pinned Node 24.21.0 と pnpm 12.6.0 を使い、`pnpm install --frozen-lockfile` を実行します。CI 用 PostgreSQL の credential は workflow に明示したテスト専用値で、repository secret は渡しません。
