# CI 方針

`.github/workflows/ci.yml` は pull request、`main` への push、手動 `workflow_dispatch` を対象にします。quality gate の job 名 (`lint`、`unit`、`integration`、`build`、`e2e`、`docker`) は既存の required status checks と同じです。外部 Action は full commit SHA pin です。

pull request では検証だけを行い、GHCR へ push しません。fork の pull request に write 権限や repository secret は渡しません。top-level permission は `contents: read` で、書き込み権限は main push の後段 job にだけ job 単位で付与します。

## main の job graph

```text
pull_request ───────────────> lint ─┐
workflow_dispatch (any ref) ─> unit ─┤
main push ───────────────────> integration ─┤
                                      build ──┤──> release_please (no release)
                                      e2e ────┤       ├─> release_pr_checks
                                      docker ──┘       ├─> ensure_verify
                                                       └─> publish_main ─> promote_latest
release branch dispatch ────> six gates ──> release_pr_merge (REST + squash)
verify/<merge SHA> dispatch ─> six gates ──> verify_guard ─> release_finalize
                                                        ├─> publish_main ─> promote_latest
                                                        ├─> publish_release
                                                        └─> cleanup_verify (not latest)
release-heal schedule/manual ───────────────────────────> heal-main (missing run only)

quality gate job は常に run の `github.sha` を checkout します。verify run は先に `release-verify/<merge SHA>` ref をその merge SHAへ作成してから dispatchするため、`github.sha` と実際にテストする commitが一致します。workflow input の `merge_sha`、`expected_head_sha`、`github.sha` を別のcheckout refへ置き換えてはいけません。

main の push と main への normal `workflow_dispatch` は non-cancellable の同じ `kobako-ci-main` concurrency groupで直列化します。Release PR branch dispatchもnon-cancellableで、pending runだけを新しいdispatchに置き換えます。PUT merge後の古いin-progress runがensureVerifyRunまで進んでも害はなく、head SHA/base tip guardが stale mergeを拒否し、merge成功後のverify handoffを止めません。verify runは `kobako-ci-verify-<SHA>` groupでcancelしません。GitHubは各groupにpendingを1つだけ保持するため、mainの古いpending runが置き換わっても、次の成功main runとmerge直後のensure処理が未処理のverify refをRESTで自己修復します。

## Release PR と verify

mainの全gateが成功した場合だけ `release_please` を `target-branch: main`、`skip-github-release: true` で実行します。Release Please actionはPRの作成/更新だけを担い、normal main runではtag/Releaseを作成しません。main runはREST APIでcanonicalなopen Release PRを再取得して、同一head branchへ `workflow_dispatch` を送ります。action outputはPR identityの根拠にしません。

`release_pr_merge` は正確なRelease PR branchの `workflow_dispatch` だけで動き、in-runの6 gate成功に加えて、author=`github-actions[bot]`、同一repository head、base=`main`、exact branch、pending label、open/non-draft、head SHA=`github.sha`、main tip=PR base SHA=head commit sole parentを確認します。validator checkout は常に `refs/heads/main` を使い、dispatch inputの `main_sha` はデータとして比較するだけです。trusted shell stepが `git rev-parse HEAD == PR base SHA == live main tip` を確認してからmain側 validatorを実行します。Checks APIはhead SHAの最新recordをnameごとに選び、GitHub Actions app id `15368` / slug `github-actions` の `completed/success`だけを受け付けます。PUT mergeには検証済みhead SHA、`merge_method=squash`、Release PR titleに ` (#<number>)` を付けた `commit_title` を指定します。

merge後のmain push（人間によるmergeを含む）はversioned image/tag/Releaseをpublishせず、SHA imageだけを通常の `publish_main` で扱い、finalizeしません。merge SHAに専用verify ref/runをensureします。verify runはexact `github.sha`を6 gateで再テストし、canonical merged PR、merge SHAがlive mainの祖先、in-run gate成功を確認した後だけRelease Pleaseを `target-branch: main`、`skip-github-release: false`、`skip-github-pull-request: true` で実行します。Release Please sourceはmerged pending Release PRが残ると新PR作成をabortするため、このself-healは必須です。

`publish_release` はverify runだけで動き、tag target、GitHub Release、OCI revision、versionが同じmerge SHA/versionであることを確認します。既存matching tag/Release/imageは再利用し、PRがまだ `autorelease: pending` ならRelease Please v17.6.1と同じくpendingを外して `autorelease: tagged` を付け、別revision、欠落label、不明manifestはfail closedです。verify成功後はrefを削除し、mainが先に進んでいればnormal main dispatchを1回送り後続commitを処理します。失敗時はverify refを残してrerunします。

## Quality gates

- `lint`: Prettier check、Release Please 生成物 validator、ESLint、TypeScript typecheck
- `unit`: Vitest の unit test
- `integration`: `postgres:18.6-alpine3.24` service、空 DB への migration、実 PostgreSQL integration test
- `build`: DB package、Next.js、worker の production build
- `e2e`: PostgreSQL service、migration、production server、Chromium E2E。失敗時に Playwright report/test results を artifact 化
- `docker`: buildx で web/migrate/worker image を load（push なし）し、標準 Compose（独立 `migrate` サービスなし）を起動して web image の起動前 migration、web image 内の migrator 一式、standalone `migrate` image の冪等実行、web/DB health、DB-backed page、web/worker の継続起動、graceful shutdown を確認する。`migrate` target の build は手動・高度な運用向け互換性のため継続する。

`.release-please-manifest.json` と `release-please-config.json` は JSON として parse し、root version と workspace version の整合性を確認します。Release Please が設定する generic extra-file がある場合は、`# x-release-please-version` marker と version も確認します。`CHANGELOG.md` がある場合は先頭を `# Changelog` 見出しにします。生成物は Release Please 所有の canonical output なので Prettier からは除外しますが、validator とレビューの対象です。

## Publish matrix

| event / result                      | web / migrate tag  | OCI `version` label | `latest`                             |
| ----------------------------------- | ------------------ | ------------------- | ------------------------------------ |
| `pull_request` / arbitrary dispatch | push なし          | push なし           | 変更なし                             |
| normal main push/dispatch           | `sha-<github.sha>` | `sha-<github.sha>`  | main tip確認後に promote             |
| verify ref dispatch for `M`         | `sha-M` と `X.Y.Z` | `sha-M` / `X.Y.Z`   | promotion時のmain tipが`M`の場合だけ |

Versioned imageはverify runだけが公開します。release outputは厳密な `^vX.Y.Z$` のみを受け付け、origin tagの解決先がverify runの `github.sha == M` と一致することを確認します。GHCR tagは `X.Y.Z` に変換し、`X.Y` や `X` の可変SemVer tagは作成しません。

既存の `X.Y.Z` tag/imageはOCIのsource、revision、versionを検査します。同じrevisionなら再実行でskipできます。異なるrevision、欠落label、不明manifestはfailし、別commitで上書きしません。webとmigrateは同じverify merge commitから同じversionを作成します。workerはquality gateでbuildしますがGHCRへはpublishしません。

## 権限と Release PR

Release PRは `GITHUB_TOKEN` で作成されるため、PR作成イベントから `pull_request` workflowが自動起動しない制約があります。`release_pr_checks` はRESTでcanonical PRを選び、同じhead branchへ `workflow_dispatch` を送ります。merge jobはexact Release PR ref、完全なcanonical predicate、head SHA、最新6 checkを再確認してからPUT squash mergeします。

merge commitのpushはGITHUB_TOKEN suppressionでCIを自動起動しないため、automationは `release-verify/<full merge SHA>` refを作成して明示dispatchします。verify refはmain default-branch rulesetの対象外ですが、verify run自身はrepository、ref、SHA、merged canonical PR、main ancestry、in-run gateをすべて確認します。通常main run（人間mergeを含む）はtag/Releaseを作らず、merged pending PRのverify ref/run self-healだけを行います。

job permissionsは必要最小限です。gateは `contents: read`、PR dispatch/self-healは `actions: write` と必要な `pull-requests: read`（ref作成/削除時だけ `contents: write`）、mergeは `contents: write`/`pull-requests: write`/`checks: read`、verify finalizerはtag/Releaseとref cleanupに必要なwrite、publishは `contents: read`/`packages: write` だけを持ちます。追加PAT、App、SSH key、secretは不要です。

tag push triggerは追加していません。GITHUB_TOKENで作成したtagは別workflowを起動しないため、verify run内のRelease Please outputからpublish jobへ明示的に渡します。`autorelease: pending` と `autorelease: tagged` labelは事前作成が必要で、削除時も権限を広げず再作成します。

## Release automation invariants

`release_pr_merge` は main checkout の `release-please-config.json` から算出した Release Please 所有ファイルだけを許可し、head commit の author が `github-actions[bot]` の Bot、committer が同 Bot または GitHub API の署名検証が `verified=true`・`reason=valid` の `web-flow` User であること、title/body/root version が一致することを確認します。merge 前の base-tip/sole-parent check は GitHub merge API に compare-and-swap がないため非原子的な TOCTOU 防御であり、verify run は `M` に対して完全に再実行します。

`release_finalize` は Release Please action の直前に、live main の config、manifest、各 package version file、extra-files の blob SHA が `M` と一致することを確認します。main の metadata が先に変わった場合は Release Please を実行せず、hold/revert 後に同じ verify ref を recovery dispatch します。Release object は published (`draft=false`, `prerelease=false`)、exact tag、tag SHA、`target_commitish` が40桁SHAで `M` と完全一致することまで検証します。Read-only APIで確認した既存Releaseも `v0.3.0=f404557eed862e4a8d1428016d25054a3a459cab`、`v0.3.1=c44f2d1694530b62e3c9a2d6c1c94f5c2069f4ed` のSHA値であり、branch名は受け付けません。

`promote_latest` は `kobako-latest-promotion`（cancel不可）で直列化し、lock 内で main tip をREST再確認します。一方 `cleanup_verify` は promotion を待たず、publish job成功後にだけ ref を削除します。DELETE の404は既に削除済みとして成功扱いし、その後も main の後続処理を確認します。main成功runは失敗した verify を再試行できますが、約30分ごとの `release-heal.yml` は verify workflow_dispatch run が一つもない場合だけ作成・dispatchし、失敗/成功/実行中 run は自動再dispatchしません。
write accessを持つ actor に限定した残余 window は、`verify-release-inputs` 直後から Release Please actionまでのPR title/bodyまたはmain config変更、merge base TOCTOU、文字通りの `release-verify` branch namespace conflictです。前二者は後段検証で fail closedし、conflictは既存refをrepointせず手動削除・recoveryします。pending PRのrefを手動削除し、failed runだけが残る場合はscheduled healerも再dispatchしないため、maintainerが同じ `M` を手動dispatchします。

Release PR が `autorelease: tagged` になった後の image publish failure は ensure/heal の対象外です。残った `release-verify/<M>` は未完了 release として同じ SHA の rerun/recovery dispatchで処理し、別SHAへの ref 移動や tag の上書きはしません。すべての `actions/checkout` は `persist-credentials: false` とし、workflow は checkout token を使って push しません。

## Docker の graceful shutdown 検証

Docker job は health check 後に `docker compose stop -t 20` を実行し、worker の終了コードが `0` であることを確認します。web は `0` または `143` を許容します。`137` は SIGKILL または timeout を示すため失敗とし、それ以外の web 終了コードも失敗にします。通常の cleanup は CI 専用環境にだけ実行されます。

すべての Node job は `.node-version` の pinned Node 24.21.0 と pnpm 12.6.0 を使い、`pnpm install --frozen-lockfile` を実行します。CI 用 PostgreSQL の credential は workflow に明示したテスト専用値で、repository secret は渡しません。
```
