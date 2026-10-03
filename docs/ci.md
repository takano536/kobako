# CI 方針

`.github/workflows/ci.yml` は `pull_request` と `main` への `push` だけを対象にします。quality gate の job 名 (`lint`、`unit`、`integration`、`build`、`e2e`、`docker`) は repository ruleset の required status checks と同じです。外部 Action は full commit SHA pin です。

pull request では検証だけを行い、GHCR へ push しません。fork の pull request に write 権限や repository secret は渡しません。top-level permission は `contents: read` で、書き込み権限は job 単位に限定します。

## Job graph

```text
pull_request ───────────────> six quality gates ──> workflow_run evaluator
main push ──────────────────> six quality gates ──> release-candidate
                                                        ├─ ordinary: Release Please PR (App token)
                                                        └─ release merge M: Release Please tag/Release
main push ────────────────────────────────────────────> publish sha images
canonical release push M ────────────────────────────> publish version + sha images
                                                            └─> promote latest (live-tip lock)
```

Quality gate jobは常に run の `github.sha` を明示的に checkout します。PR native runの merge ref と head SHAは異なり得るため、trusted evaluatorは `workflow_run.head_sha` と PR APIの head SHAを比較します。`workflow_dispatch` や `release-verify/<SHA>` refはありません。

`ci.yml` の main push concurrencyは `github.sha` ごとの group とし、後続の main push が前の push runをpending置換で失わせないようにします。PR runだけ同じ `github.ref` の古い実行をcancelします。release_pleaseのmain-tip guard、release_finalizeのSHA group、promote-latestのlockとlive-tip checkが重複・古いrunを止めます。`release-automerge.yml` は `workflow_run.id` ごとの `cancel-in-progress: false` で完了イベントを捨てず、sha-pinned mergeとidempotency guardで重複を安全に停止します。PR CI完了イベントとmain push CI完了イベントの両方を受け、後者はlive mainのcanonical open Release PRを再取得します。

## Quality gates

- `lint`: Prettier check、Release Please 生成物 validator、ESLint、TypeScript typecheck
- `unit`: Vitest unit test
- `integration`: PostgreSQL service、migration、integration test
- `build`: DB package、Next.js、worker production build
- `e2e`: PostgreSQL、migration、production server、Chromium E2E
- `docker`: buildxで web/migrate/worker image を loadし、Compose health、bundled migrator、standalone migration、graceful shutdownを検証（pushなし）

`.release-please-manifest.json` と `release-please-config.json` は JSON として parse し、root/workspace version を確認します。`CHANGELOG.md` は先頭の `# Changelog` と Release Please の新しい sectionをvalidatorで確認します。

## Native Release PR evaluator

`release-automerge.yml` は `workflow_run` の `completed` eventだけを受け、trusted な `refs/heads/main` checkoutの validatorを実行します。PR head codeをcheckoutして実行しません。job-level `GITHUB_TOKEN` permissionは API read 用の `actions: read`、`checks: read`、`contents: read`、`pull-requests: read`だけです。repository-scoped App tokenは `contents: write` と `pull-requests: write`だけを持ち、merge `PUT` にのみ渡します。evaluatorのAPI readに Issues permissionは不要です。

validatorは event=`pull_request`、conclusion=`success`、canonical head repository、exact Release Please branchを確認し、live PRを再取得します。PRが open/non-draft、base=`main`、headが workflow runのSHA、`autorelease: pending`、許可された bot authorであることを確認します。head commitはlive mainをsole parentに持つか、live mainの祖先である verified merge-baseをsole parentに持ちます。stale baseの場合も merge-baseからheadまでのdiffはCHANGELOG/manifest/package version/`extra-files` allowlistだけです。rulesetはbranchを最新にする strict status checkを要求しません。committerはREST `GET /repos/{owner}/{repo}/commits/{sha}` の完全な応答から、top-level `committer.login=web-flow`・`id=19864447`・`type=User`、nested `commit.committer.name=GitHub`・`email=noreply@github.com`、sibling `commit.verification.verified=true`・`reason=valid` の全てを完全一致で確認し、欠落・型違い・name/emailだけの一致・substringは拒否します。PUT直前にもPRを再取得して同じbase/head/state/draft/label/author条件を検証します。refetch直後のbase retargetは残余TOCTOUですがmaintainerだけがretargetでき、merge後push validatorがcanonical merged PRとdiffを再検証します。
main push の evaluator は event SHA と live `refs/heads/main` の一致、同じ push CI run の `release-please` job `completed/success` を確認してから、canonical open Release PRをbranch/base/app author/labelで検索します。PRがなければ成功 no-opです。PRがあれば現在の head SHAの native `pull_request` CI runと6 checkを再取得し、pending/missing/failureなら停止します。stale Release PR baseを受け付ける場合も、この live main push evidence が成功している場合だけです。

Checks APIは期待head SHAの最新 recordをnameごとに選び、GitHub Actions app `15368` / `github-actions` の `completed/success` だけを受け付けます。missing、pending、failure、cancelled、skipped、wrong-appは具体的な理由で停止します。確認後にApp tokenで `PUT /pulls/<number>/merge` (`sha=H`, `merge_method=squash`) を実行します。405/409、head/base mismatch、fork、author、label、extra fileの不一致は古いSHAをmergeせず、次のPR更新を待ちます。

PR の CI run では main-only の `release_candidate`、`release_please`、`release_finalize`、publish jobs、promotion job は条件不成立で skipped です。これらは required check ではなく、6 quality gate が成功した run の workflow conclusion を `success` から変えません。evaluator は workflow の `conclusion=success` を入口にし、Checks APIでは同じ head SHAの6 required checkをそれぞれ最新1件だけ検証するため、required checksを別の rollup として二重計上しません。

## Main push と publish matrix

App tokenでのmergeは main push CIを merge SHA `M`で起動します。quality gate後、push runは REST `commits/M/pulls` から `merge_commit_sha == M` のcanonical Release PRを一つだけ選び、`merged_by`、metadata、main tip、sole parent、Release Please inputsを再検証します。通常main pushではRelease Please PRを作成/更新し、`publish_main`だけが `sha-M` image（version labelも`sha-M`）とlatestを公開します。canonical release pushでは `release_finalize` が job-scoped `GITHUB_TOKEN`（`contents: write`、`issues: write`、`pull-requests: write`）で Release Please のtag/Releaseを `M == GITHUB_SHA`へ作成・検証し、target検証後にcanonical merged PRの `autorelease: pending` を `autorelease: tagged` へ冪等修復してから、release_please jobがApp tokenでlive mainを再計算します。作成stepがコメント投稿後に失敗しても、immutable targetがMに一致する場合だけ検証を通し、missing / partial / mismatch はhard failします。`publish_release`だけがversioned tagと`sha-M`をweb/migrate両方へ公開します。release runでは`publish_main`をskipし、同じsha tagを異なるversion labelで競合させません。
通常の main push `N` が先行 release merge `M` の pending Release PR を見つけた場合、`release_please` pre-check は M の push run と `release_finalize` job を Actions API (`actions: read`) で確認します。M が active なら `deferred` として N の Release Please だけを skipし、M の Release Please が finalize後に live mainを再計算します。terminal なのに判定不能な `unknown`、または finalize済みなのに pending が残る `stale` は jobをfailさせ、`publish_main` は ordinary な `sha/latest` を公開しません。

| event / result                    | web / migrate tag  | `latest`                     |
| --------------------------------- | ------------------ | ---------------------------- |
| `pull_request`                    | pushなし           | 変更なし                     |
| ordinary `main` push              | `sha-<full SHA>`   | live main tip確認後にpromote |
| canonical release `main` push `M` | `X.Y.Z` と `sha-M` | live main tipが`M`の場合だけ |

既存 imageはOCI `source`、`revision`、`version` labelを検査し、同じ revisionだけ再利用します。別revision、欠落label、partial tag/Releaseは上書きしません。`latest` は `kobako-latest-promotion` lock内で main tipを再確認し、古いrunのrollbackを防ぎます。

## Recovery

App設定（Client ID、bot login、private key）または `takano536/kobako` installationが不足するとRelease Please/evaluatorはfail closedします。evaluator read APIの403は job `GITHUB_TOKEN` に Actions / Checks / Contents / Pull requests read があるか確認し、Release Please jobの `GITHUB_TOKEN` は Contents / Actions readだけでよく、PR writeはApp tokenの Contents / Pull requests / Issues RWを確認します。`release_finalize` の `GITHUB_TOKEN` は Contents / Issues / Pull requests write を確認します。evaluator mergeの403は App の Contents / Pull requests RWを確認します。native check失敗、head/main mismatch、merge conflictは原因を直してPR更新を待ちます。main push SHA `M` の quality gateやpublishが一時失敗した場合は、別のmain pushを作らず、その `M` の push runで failed jobs をrerunします。rerunも `github.sha=M` を維持し、release_finalizeは immutable tag/Release probeで既存matching targetを再利用し、検証済みcanonical PRのpending/tagged label修復も再実行するため冪等です。Release Please作成stepの失敗はmatching immutable target検証後だけ許容され、missing / partial / mismatchはhard failです。image publish失敗は同じ `M` のrunを再実行し、別SHAへtagを移しません。stale / unknown pre-check failureでは`publish_main`を実行せずordinary imageを公開しません。

詳細なセットアップ、原因、version/CHANGELOG規約、recovery手順は [`docs/releasing.md`](releasing.md) と [`docs/branching.md`](branching.md) を参照してください。

## Docker の graceful shutdown

Docker jobは `docker compose stop -t 20` 後に worker終了コード `0`、web終了コード `0` または `143` を確認します。`137`、その他の終了コード、health/DB/page failureはCI失敗です。cleanupはCI専用環境にだけ実行します。
