# リリース運用

kobako は Conventional Commits と Semantic Versioning (SemVer) を使います。Release Please は `main` の履歴から Release PR を作成・更新し、Release PR の squash merge 後にだけ tag、GitHub Release、GHCR image を作成します。

## なぜ GitHub App が必要か

GitHub の `GITHUB_TOKEN` で作成・更新した PR は、同じ repository の branch であっても `pull_request` workflow が承認待ちになります。`workflow_dispatch` の成功は PR の required-check rollup にはなりません。そのため、GITHUB_TOKEN fallback による「自動化」はこの repository では不十分です。

無人運用は repository-scoped GitHub App installation token を使います。Release Please が App token で PR を作成・更新すると、native `pull_request` CI が通常どおり起動します。workflow は不足設定時に fail closed し、GITHUB_TOKEN で PR を作成しません。

公式仕様:

- [Triggering workflows](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [Required status checks troubleshooting](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
- [workflow_run event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

## 必須セットアップ（maintainer の操作）

1. GitHub App を作成する。
2. App を **`takano536/kobako` のみに install** する。organization / user の全 repository には install しない。
3. App の repository permissions を次の最小構成にする。

   - **Contents: Read and write**（Release PR branch、tag、Release の操作。evaluator の merge は job-scoped token でこの write だけを使う）
   - **Pull requests: Read and write**（Release PR 作成・更新・merge）
   - **Issues: Read and write**（Release Please が `autorelease: pending` / `autorelease: tagged` label を更新するため）
   - **Metadata: Read**（GitHub App の必須 read permission）

   evaluator の API read は App token ではなく workflow の `GITHUB_TOKEN`（Actions / Checks / Contents / Pull requests の read）で行います。App token は evaluator の merge `PUT` にだけ渡し、evaluator には Issues permission を要求しません。

   Administration、Workflows、Packages、ruleset bypass、repository administration の権限は不要です。実際の 403 がない限り追加しません。

4. App の Client ID と秘密鍵を repository settings に登録する。

   - repository variable `RELEASE_APP_CLIENT_ID`: App の Client ID
   - repository variable `RELEASE_APP_BOT_LOGIN`: App slug に `[bot]` を付けた正確な login（例: `kobako-release[bot]`）
   - repository secret `RELEASE_APP_PRIVATE_KEY`: App の秘密鍵。ファイルや Git に保存しない

workflow は `actions/create-github-app-token` に owner `takano536`、repository `kobako`、Release Please jobでは Contents / Issues / Pull requests の permission、evaluator jobでは Contents / Pull requests の write permissionだけを渡します。token は短命で job 終了時に revoke されます。

Client ID、bot login、秘密鍵のいずれかが未設定の場合、Release Please job と evaluator は明確な error で停止します。`GITHUB_TOKEN` に fallback しないため、未設定のまま maintainer 承認に切り替わることはありません。

## 通常の自動フロー

1. 通常 PR を人間が `main` に squash merge します。`lint`、`unit`、`integration`、`build`、`e2e`、`docker` の6 required checksを維持します。
2. `main` の push CI が6 gateを同じ `GITHUB_SHA` で成功させます。成功した main run の Release Please job が App token を発行し、`target-branch: main` / `skip-github-release: true` で Release PR を作成または更新します。
3. Release PR の更新ごとに native `pull_request` CI が起動します。`workflow_dispatch` や cron の代替チェックはありません。
4. `release-automerge.yml` の `workflow_run` evaluator は CI 完了イベントを受け取り、trusted な `refs/heads/main` の validator だけを実行します。PR head を checkout したり、PR のコードを実行したりしません。次を REST API で再検証します。

   - event が `pull_request`、conclusion が `success`
   - head repository が `takano536/kobako`、head branch が正確な Release Please branch
   - PR が open・非 draft、base が `main`、head SHA が workflow run の `head_sha`
   - canonical repository、許可された bot author、`autorelease: pending` label
   - head commit が live main の sole parentを持つ、または live main の verified merge-base を sole parentに持つ（後者は merge-base が live main の祖先で、merge-base から head までの diff が Release Please allowlistだけの場合に限る）
   - Release Please の allowlist（`CHANGELOG.md`、manifest、各 configured package の version file / `extra-files`）以外の変更がない
   - committer が REST `GET /repos/{owner}/{repo}/commits/{sha}` の top-level `committer.login=web-flow`・`id=19864447`・`type=User`、nested `commit.committer.name=GitHub`・`email=noreply@github.com`、sibling `commit.verification.verified=true`・`reason=valid` に全て完全一致する（欠落、型違い、name/emailだけの一致、substringは停止）
   - GitHub Actions app (`id=15368`, slug `github-actions`) の6 checkを head SHA ごとに最新1件だけ選び、全て `completed/success`

   main が docs/chore など release なしの commit だけ進んだ場合、Release Please v17.6.0 は body が変わらなければ branch を force-update しないため、stale base の verified merge-base 条件で deterministic に評価します。repository ruleset は Release PR に「branch を最新にする」strict status check を要求しない設定にし、merge 後の main push 6 gate が実際の squash SHA `M` を再テストします。

5. evaluator は App token で `PUT /pulls/<number>/merge` を `sha=<head SHA>`、`merge_method=squash` として実行します。concurrency は `workflow_run.id` ごとの non-cancellable group でイベントを捨てず、sha-pinned merge と idempotency guard で重複を安全に停止します。PR CI完了イベントだけでなく main push CI完了イベントも evaluator を起動し、live main の canonical open Release PRを再取得します。二つ目の evaluator は既に merged なら no-op です。PUT直前にもPRを再取得して base/main・canonical repository・Release branch/head SHA・open/non-draft・label・authorを再検証し、head SHAのChecks APIも再取得して6 required checksの最新recordが全て `completed/success` であることを確認します。再取得直後からPUTまでのbase retargetは残余TOCTOUですが、retarget権限はmaintainer trust boundary内であり、merge後のmain push validatorもcanonical merged PRと変更範囲を再検証します。pending/queuedの相手側CIは安全なdeferredとして次の完了イベントを待ち、head更新やmetadata/check failureは停止します。live main更新や安全な405/409 conflictは下記のbounded full revalidationへ進み、古いSHAをmergeしません。
   evaluatorの二つの入口は相手側のCIがまだ `queued` / `in_progress` の場合にmergeせず、`deferred=true` と成功終了します。pending runの完了が次の `workflow_run` を発生させるため、PR CI完了側はlive main push CIのRelease Please evidenceを、main push完了側は現在のRelease PR native CIを再取得して再評価します。live mainの移動または安全な405/409 conflict時は最大3回、main・PR・checks・metadataを全て取り直します。各試行でevent head SHA、current PR head、required checksを一致させ、古いsnapshotのmergeは行いません。
6. App token の merge により `push` CI が実際の squash merge SHA `M` で起動します。6 gate後に `commits/M/pulls` から canonical merged Release PR を一つだけ選び、`merge_commit_sha == M`、許可された `merged_by`、base/head/label/metadata/provenance、sole-parent、main ancestry を再検証します。live main が M より先へ進んでいても、M が live main の祖先であることを compare APIで確認して finalizeし、versioned/`sha-M` imageは M 固定で公開します。
7. canonical releaseの `release_finalize` だけが Release Please を `GITHUB_TOKEN`（job permission は `contents: write`、`issues: write`、`pull-requests: write`）/ `skip-github-release: false` / `skip-github-pull-request: true` で実行し、strict SemVer tag と GitHub Release を `M == GITHUB_SHA` に作成します。Release Please がコメント投稿後に失敗しても、後続の immutable target verification が tag と Release の両方が `M` を指すことを確認した場合だけ続行し、missing / mismatched / partial target は hard fail します。target検証後は同じ canonical merged PRだけを再取得し、`autorelease: tagged` を付与して `autorelease: pending` を削除します。既にtaggedならno-opで、finalize途中失敗後の再実行でも冪等です。finalize成功後、同じ main push の Release Please jobが repository-scoped App token / `skip-github-release: true` で live mainを再計算し、次の Release PRを作成または更新します。
   通常の main push `N` が `M` の merged pending Release PR を検出した場合、`M` の push run の `release_finalize` が active なら pre-check は `deferred` を返して `N` の Release Please だけを skip します。`M` の `release_please` は `release_finalize` 完了後に live main を再計算するため、後続の `N` の pre-check が `M` を stale と誤判定して block することはありません。
8. 通常の main push は `publish_main`、canonical release push M は `publish_release` が単一の `ghcr.io/takano536/kobako` image の version tag と `sha-M` tagを公開します。`latest` は promotion lock 内でlive main tipを確認してから更新する eventual-consistency設計で、後続runはlock待ちの後により新しいtipだけをpromoteします。

worker image はローカル Compose/CI 専用で、GHCR には公開しません。

## 失敗と復旧

- **App 設定不足**: `RELEASE_APP_CLIENT_ID`、`RELEASE_APP_BOT_LOGIN`、`RELEASE_APP_PRIVATE_KEY` と install repository を確認します。秘密鍵をログに出さず再登録し、次の main push CI を待ちます。
- **API が 403**: evaluator の read API (`actions/runs`、`check-runs`、commits/compare/contents/pulls) は workflow `GITHUB_TOKEN` の Actions / Checks / Contents / Pull requests read を確認します。`release_finalize` の `GITHUB_TOKEN` は Contents / Issues / Pull requests write、Release Please の作成・更新は App の Contents / Pull requests / Issues RW、evaluator の merge は App の Contents / Pull requests RW だけを確認します。token を広い repository scope に置き換えません。
  `release_please` pre-check は job の `GITHUB_TOKEN`（`actions: read`、`contents: read`、`pull-requests: read`）で merged Release PR、M の push run、tag/Release target を参照し、App token は次の Release PR の作成・更新に限定します。active M run に terminal の `release_finalize` job があれば stale として扱い、completed run に job が見えない場合は `unknown` として fail closed します。M 自身の current run では pending label を bounded retry で再取得してから stale/clear を決めます。
  merged PR scanはRelease Please v17.6.0の `pullRequestIterator(main, 'MERGED', 200, false)` と同じREST `pulls` の `updated desc` ページ順で、最初の200件のmerged PRだけを対象にします。200件に到達するのは仕様上のscan window終端であり、pagination exhaustionとしてエラーにしません。
- **PR evaluator が pending / missing / failure と停止**: native PR CIの `queued` / `in_progress` は `deferred=true` で成功終了し、run完了イベントから再評価します。missing、failure、cancelled、skipped、wrong-appのcheckはfail closedです。headが更新されれば新しい `pull_request` CI と `workflow_run` evaluator が自動的に発生し、dispatch や verify ref を手動で作ってrequired checksを偽装しません。
- **PR head / main base が変わった、または merge が 405/409**: headがlive mainのverified merge-baseに基づき、Release Please allowlistだけのstale diffならevaluatorは安全にmergeを試行します。live main更新または安全な405/409 conflictでは最大3回、main・PR・checks・metadataを再取得して最初から評価し、古いhead SHAを指定してmergeしません。各試行後もfresh snapshotを確定できなければdeferredで終了します。それ以外のhead/base変更は停止し、rulesetのstrict status checkを無効化しても古いPRを強制しません。
- **main push run が失敗 / pending置換で停止**: 後続の main push を作らず、対象 SHA `M` の push runで failed jobs を rerunします。run の `github.sha` は `M` のままで、release_finalizeは immutable tag/Release probeにより既存の matching target を再利用し、検証済みcanonical PRのpending/tagged label修復も再実行するため冪等です。Release Please の作成 step が失敗しても、matching target の検証後だけ許容されます。tag / Release が absent の場合も同じ `M` の成功 push runだけを再実行します。
- **Release Please が次の Release PR を作成せず stale state で停止**: `release_please` の deterministic pre-check が、merged canonical Release PR の `autorelease: pending` 残留を通常の no-change と区別して fail します。tag と Release が既に存在する場合は同じ merge SHA `M` の finalize を再実行して label を修復し、partial / mismatch の target は上書きせず、[この recovery 手順](#失敗と復旧)に従って調査します。
- **M の `release_finalize` が実行中**: pre-check は、別の main push `N` から見た active M run に terminal finalizer jobがまだない場合だけ `deferred` を出し、N の Release Please だけを skip します。M 自身の current runは deferせず、pending labelを再取得して clear/staleを決めます。M の `release_please` は finalize 完了後に live main を再計算します。
- **M の finalize が terminal なのに状態を判定できない**: completed run に `release_finalize` job が見えない場合など、pre-check は bounded lookup 後に `unknown` として fail closed します。Actions API の権限・run/job の存在を確認し、同じ main push を再実行します。
- **publish_main が実行されない**: `release_please` pre-check の stale / unknown failure は job を失敗させるため、`publish_main` は ordinary な `sha-M` / `latest` image を公開しません。`deferred` は意図した非 block 状態なので、N の通常 publishだけを継続します。
- **manifest / version valueを変更したhuman PR**: `release_candidate` は manifest の `.` またはconfigured JSON version fieldの値を変えたordinary publishを許可せず、関連PRが見える場合はcanonical author不一致の `no canonical merged Release PR ... author is not ...`、association indexingが空の場合はbounded retry後の `release-owned version files changed ... no canonical merged Release PR ...` でfail-closedします。package.jsonのdependencyなどversion値以外だけの変更はordinaryです。前者は同じMをrerunせず、該当コミットをrevertまたはfix-forwardしてcanonical Release PRで新しいMを作ります。後者だけはcanonical bot PRの一時的なindex遅延として同じMのpush runをrerunします。CHANGELOG.mdだけのhuman docs fixもordinaryです。
- **tag / Release / image が別 SHA、partial、または version 不一致**:上書き、tag 移動、tag の削除・再作成をしません。対象 SHA と API 出力を maintainer が調査し、原因を fix-forward して新しい release PR を作ります。
- **image publish だけが失敗**:既存の immutable version / `sha-M` tag を再利用できる場合だけ、同じ push run を同じ SHA で再実行します。別 commit へ version tag を移しません。
- **既に merged の evaluator が再実行**: canonical merged PR を検出して no-op になります。push run の release candidate 判定も `commits/M/pulls` の exact SHA だけを対象にするため、過去の tagged PR を選びません。

## Version と CHANGELOG

Conventional Commits と SemVer を使います。

| prefix                                         | 0.x.y        | 1.0.0 以降   |
| ---------------------------------------------- | ------------ | ------------ |
| `fix:`                                         | patch        | patch        |
| `feat:`                                        | minor        | minor        |
| `feat!:` / `BREAKING CHANGE:`                  | minor        | major        |
| `docs:`、`test:`、`ci:`、`chore:`、`refactor:` | release なし | release なし |

`.release-please-manifest.json` の root (`.`)、root `package.json`、configured `extra-files` の version は同じ値でなければなりません。`CHANGELOG.md` は共有する先頭の `# Changelog` を保ち、その直後に一つの新しい `## [X.Y.Z]` section を挿入し、既存履歴を byte-identical に保ちます。Release PR validator はこの形式と JSON の version 以外の差分を拒否します。

## GHCR

- `ghcr.io/takano536/kobako:X.Y.Z`
- `ghcr.io/takano536/kobako:sha-<full SHA>`
- `ghcr.io/takano536/kobako:latest`（live main tip と一致した quality-gated pushだけ）

versioned tag と `sha-<full SHA>` tag は同じ `M`、同じ OCI `source` / `revision` / `version` label を持つ単一 image を指します。
