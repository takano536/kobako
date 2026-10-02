# リリース運用

kobako は Conventional Commits と Semantic Versioning (SemVer) を使います。Release Please は main の履歴から Release PR を作成・更新する役割だけを担い、Release PR を merge するまではリリースされません。

## バージョンと commit

通常の PR と Release Please の Release PR は squash merge します。main に残る squash 後の PR title が Conventional Commit として解析されるため、title は変更の実態に合う prefix を付けます。

| prefix                                         | 0.x.y                     | 1.0.0 以降   |
| ---------------------------------------------- | ------------------------- | ------------ |
| `fix:`                                         | patch (`0.1.0` → `0.1.1`) | patch        |
| `feat:`                                        | minor (`0.1.1` → `0.2.0`) | minor        |
| `feat!:` または `BREAKING CHANGE:`             | minor (`0.2.0` → `0.3.0`) | major        |
| `docs:`、`test:`、`ci:`、`chore:`、`refactor:` | リリースなし              | リリースなし |

`0.x` の breaking change は `bump-minor-pre-major: true` で minor とします。実際の不具合修正をリリース抑制のために `chore:` や `ci:` へ偽装してはいけません。安定版への移行では独自 prefix を作らず、`Release-As` footer で明示します。
複数の `fix:` が main に蓄積した場合も、同じ Release PR にまとめて一度 squash merge すれば patch bump は一度だけです。

```sh
git commit --allow-empty \
  -m "chore: prepare stable release" \
  -m "Release-As: 1.0.0"
```

## Release Please と生成物

`.release-please-manifest.json` は root (`.`) の version を管理し、`release-please-config.json` の extra-files で root、web、worker、db の version を同じ version に更新します。generic marker (`# x-release-please-version`) が設定されている場合も削除・変更しないでください。

`CHANGELOG.md` と `.release-please-manifest.json` は Release Please が所有する生成物です。Release Please の出力を更新のたびに手動で Prettier 整形すると、次の更新で同じ差分が発生するため、両ファイルだけを `.prettierignore` に追加しています。これはレビュー対象から除外する意味ではありません。quality gate では JSON、version 整合性、generic marker、Changelog の見出しを別の validator で確認します。
Release Please が使う `autorelease: pending` と `autorelease: tagged` label は事前に repository へ作成しておきます。削除された場合も権限を広げず、同じ名前の label を再作成してください。

## リリース順序

すべての quality gate は、workflow run の `github.sha` と同じ commit を明示的に checkout します。別の SHA を checkout して run の check として扱うことは禁止です。

1. normal PR では format、Release Please 生成物 validator、lint、typecheck、unit、integration、production build、E2E、Docker の6 gateだけを実行する。
2. main の push（または main への normal `workflow_dispatch`）で6 gateが成功した場合だけ、Release Please を `target-branch: main` と `skip-github-release: true` で実行し、Release PR を作成・更新する。
3. main run は REST API で canonical な open Release PR（bot author、同一 repository head、base=`main`、正確な head branch、`autorelease: pending`、非 draft）を再取得し、その head ref へ `workflow_dispatch` を送ります。Release Please の action output だけを PR identity の根拠にしません。
4. Release PR dispatch の6 gateが同じ head SHAで成功した後、Checks API の各最新 record（GitHub Actions app id `15368` / slug `github-actions`）を確認し、`completed/success` の6個がそろった場合だけ、head SHAを指定して squash merge します。PR更新、main先行、fork、author/base/label/state違い、missing/pending/failure/cancelled/skipped/neutral checkは停止します。merge APIにはRelease PR titleと ` (#<number>)` を組み合わせた `commit_title` を明示し、既存の `chore(main): release 0.3.1 (#17)` と同じ履歴形式にします。
5. merge 後は `release-verify/<merge SHA>` ref を `merge SHA` に作成し、同じ ref へ `workflow_dispatch` を送ります。専用 verify run の `github.sha` は必ず merge SHA と一致し、6 gateはその run の SHAを checkout して再実行します。人間が Release PR を merge した main push runは SHA imageだけを通常publishし、versioned image/tag/Releaseを作成せず、この verify ref/runの自己修復だけを行います。
6. verify runで6 gate、canonical merged PR、merge SHAがmainの祖先であることを確認した後だけ、Release Please を `target-branch: main`、`skip-github-release: false`、`skip-github-pull-request: true` で実行します。厳密な `vX.Y.Z` tagがmerge SHAを指すことを確認してからGitHub Releaseとversioned imageを扱います。matching tag/Releaseが既にあり、PRにpending labelが残る場合は、Release Please v17.6.1の `removeIssueLabels(['autorelease: pending'])` と `addIssueLabels(['autorelease: tagged'])` と同じ順で修復します。

Release Please v17.6.1 source は `DEFAULT_LABELS = ['autorelease: pending']` を merged release PR の selectorに使い、release作成後に `removeIssueLabels(this.labels)` と `addIssueLabels(this.releaseLabels)` を実行します（default `releaseLabels = ['autorelease: tagged']`）。merged pending Release PRが残る間は `createPullRequests()` を abortするため、merge済みの `autorelease: pending` PRを新しいRelease PRで迂回してはいけません。mainの成功runごとに、未tagのcanonical merged pending PRの verify ref/runをRESTで確認し、refが無ければ作成、同じSHAなら実行中/成功runが無い場合だけdispatchします。refが別SHAを指す場合は停止します。

### 失敗した Release merge の復旧

Release PR branch dispatchとverify ref/runはnon-cancellable concurrency groupで動作します。新しいdispatchはpending runだけを置き換えます。古いRelease PR runがPUT merge後に停止しても、次のrunのhead SHA/base tip guardがstale mergeを拒否し、merge成功後のverify handoffを止めません。verify失敗時はrefを削除しないため、同じrefの **Re-run failed jobs** または次の手動dispatchで再実行できます。成功したverify runだけがtag、GitHub Release、versioned GHCR imageを作成します。

- 一時的なquality gate失敗なら、失敗jobをverify ref上でrerunします。手動で同じMを再実行するコマンドは次のとおりです。

  ```sh
  gh workflow run ci.yml --repo takano536/kobako \
    --ref release-verify/<full-merge-sha> \
    -f mode=verify -f merge_sha=<full-merge-sha> -f pr_number=<release-pr-number>
  ```

- verify dispatch自体がmerge直後に失敗した場合は、上記コマンドを使います。refがまだ作られていない場合は、まず `gh workflow run ci.yml --ref main -f mode=normal` を実行し、全gate成功後の `ensure-main` に自己修復させます。normal main runはversioned image/tag/Releaseを作成しません。
- Mのgateが恒久的に失敗してM自身を修正できない場合、fix-forwardで別commitをrelease対象に置き換えてはいけません。Mのreleaseを意図的に放棄するmaintainerだけが、canonical merged PRから `autorelease: pending` を削除できます（例: `gh pr edit <number> --remove-label 'autorelease: pending'`）。Release Pleaseはこのlabelをmerged release selectorに要求するため、削除するとMはrelease候補ではなくなり、次のrelease PRを処理できます。tag/Releaseの手動作成やtag移動で穴埋めしてはいけません。
- verify refが同じSHAで存在し、成功または実行中runがあれば重複dispatchしません。pending labelの失敗runは次の成功main runで再試行できます。tagged recoveryは対象PR番号を指定した同じrefのmaintainer rerun/dispatchだけを許可し、別SHAへrefを移動しません。成功後にrefが削除され、PRが `autorelease: tagged` なら、ensure-mainは再dispatchしません。
- tag/Release/imageが別revision、欠落label、不明内容の場合は上書きせず停止します。同じversion・同じrevisionで既に存在するものだけ再実行時に再利用します。matching tag/Releaseがありpending labelだけ残っている場合は、verify finalizerがpendingを外してtaggedを付けます。
- Release PRを人間がmergeしたpush run自身はfinalizeしません。SHA imageだけを通常publishし、versioned image/tag/Releaseはverify runに限定します。close/reopen、空commit、tagの移動・手動再作成は不要です。

## GHCR image

- `ghcr.io/takano536/kobako-web:X.Y.Z`
- `ghcr.io/takano536/kobako-migrate:X.Y.Z`

`web` と `migrate` は必ず同じ verify run の同じ merge SHA・同じ version で公開します。Release imageは `^vX.Y.Z$` のRelease Please outputだけを受け付け、tagがoriginに存在してmerge SHAを指すことを確認します。OCI labelの `source`、`revision`、`version` を厳密に検証し、別revisionや欠落labelの既存tagは上書きしません。

main quality gateに成功した通常buildでは次のtagを更新します。

- `sha-<full commit SHA>`: 再現・rollback用
- `latest`: 最新のquality gate成功main build。可変tagなのでproductionでは使わない

verify runでも `sha-<merge SHA>` imageを作成します。`latest` promotionは専用の `kobako-latest-promotion` lock（`cancel-in-progress: false`）内でREST APIからmain tipを再確認し、merge SHAと一致する場合だけ更新します。古いrunの再実行でlatestをrollbackしません。worker imageはGHCRへpublishしません。

## 自動化の追加ガードと復旧

- Release PR の provenance は、main checkout の `release-please-config.json` から導出した allowlist（`CHANGELOG.md`、manifest、各 package の `package.json`、`extra-files`）だけを許可します。head の author は `github-actions[bot]` の Bot でなければなりません。committer は同 Bot、または GitHub API の署名検証が `verified=true`・`reason=valid` の `web-flow` User だけを許可します。署名検証の欠落・失敗や他の committer は停止します。PR title は `chore(main): release X.Y.Z`（`package.json` と manifest の root version と一致）、body は Release Please の root version section 一つだけであることを確認します。validatorは常に信頼済みの `refs/heads/main` checkoutで実行し、dispatch inputの `main_sha` は比較データとしてだけ扱います。実行前に `git rev-parse HEAD == PR base SHA == live main tip` を確認し、head checkout のファイルをvalidator sourceにしてはいけません。Release Please の変更範囲は pinned action/source に合わせて監査します。ただし、これは悪意ある write-access collaborator への防御ではありません。`workflow_dispatch` は release branch 上の `ci.yml` を実行するため、repository write access を持つ actor が release branch 自体を書き換えれば、この validator を迂回できます。provenance/file checks は意図しない変更や Release Please が生成した内容からの逸脱を検出する guard であり、trust boundary は repository write access です。この境界を harden するのが optional の release-branch ruleset です。
- provenanceのallowlist内でも、各JSON version fileはbase/headで `version` 以外のparsed fieldを変更できず、manifestは `.` 以外を変更できません。`CHANGELOG.md` は共有する先頭の `# Changelog` 見出しを維持し、その直後にtarget versionのwell-formedな新release sectionだけを挿入できます。既存履歴は挿入後にbyte-identicalでなければならず、見出し重複・編集・削除・並べ替え・誤った挿入位置は停止します。
- merge 前には PR の base SHA、main の tip、head commit の sole parent を確認します。GitHub の merge API に base SHA の compare-and-swap はないため、この確認は **TOCTOU に対して原子的ではありません**。merge 後の verify run は commit `M` を checkout し、同じ6 gate、canonical PR、main ancestry、Release metadata、tag/Release targetを再検証します。
- Release finalize の直前には、Release Please が live main から読む `release-please-config.json`、manifest、各 package version file、`extra-files` の blob SHA が `M` と一致することを確認します。不一致なら Release Please を実行せず、main の metadata を hold または revert してから同じ `M` を recovery dispatch します。
- title/body/version、tag SHA、GitHub Release（`draft=false`、`prerelease=false`、`tag_name` exact、`target_commitish` は40桁のSHAで `M` と完全一致）に mismatch があれば上書きせず停止します。実在する `v0.3.0` と `v0.3.1` の Release APIも `target_commitish` にそれぞれの40桁commit SHAを返すため、branch名は受け付けません。
- `release-heal.yml` は main 上で約30分ごと（または手動）に実行されます。これは quality gate を実行せず、canonical merged pending PR の `M` に対して **verify の workflow_dispatch run が一つも存在しない場合だけ** ref 作成と dispatchを行います。成功・実行中 run は dispatchせず、失敗 runも scheduled heal では再 dispatchしません。通常の成功 main run は従来どおり failed verify を一度だけ再試行できます。
- write accessを持つ actor に限定した残余 window は明示的に受け入れます。`verify-release-inputs` と Release Please action の間の数秒に PR title/body または main の Release Please config が変更される可能性、merge API に base SHA CAS がない merge base TOCTOU、write access actor が文字通りの `release-verify` branchを先に作る namespace conflict です。前二者は後段の metadata/target検証で停止し、conflictは ref 作成を fail closed にして手動復旧します。
- PR merge 後に `autorelease: tagged` になった後で image publish が失敗しても、ensure-main/heal はその release を自動再試行しません。これは意図した境界です。残った `release-verify/<M>` は未完了 release の印なので、失敗 job を同じ SHA で rerun するか、tag/Release/images を再利用する matching recovery dispatch を maintainer が行います。ref の一覧は次で確認します。
- pending PRの verify ref を手動削除した後、対象SHAに failed run だけが残っている場合、scheduled heal は「runが存在する」と判断して何もしません。refを同じ `M` で再作成し、上記の exact-SHA `workflow_dispatch` を maintainer が手動実行してください。

  ```sh
  gh api repos/takano536/kobako/git/matching-refs/heads/release-verify/
  ```

- `release-verify` という文字列の branch/ref がすでに存在する場合、または別 SHA を指している場合は新規作成を続けず、conflict/mismatch の ref を削除してから recovery dispatch を行います。既存 ref を別 SHA へ repoint してはいけません。
- Release PR branch を保護する ruleset は **optional hardening（この repository には未適用）** です。適用する場合は `release-please--branches--main--components--kobako` の update/push を GitHub Actions bot（および限定した maintainer）に制限し、通常の workflow が branch を作成・更新できることも検証します。main の ruleset では `strict_required_status_checks_policy: true` も推奨ですが、通常 PR は最新 main を取り込んでからでないと merge できなくなる運用コストがあります。

## v0.1.0 の扱い

`v0.1.0` の tag と GitHub Release は、quality gate を release job の前提条件にしていなかった旧 workflow によって、commit `11edf60`（`chore(main): release 0.1.0 (#7)`）の quality gate 中 `lint`（`pnpm format:check`）が失敗していたにもかかわらず作成されました（CI run [36428644862](https://github.com/takano536/kobako/actions/runs/36428644862): lint 失敗、publish skip。Release Please run [36428645646](https://github.com/takano536/kobako/actions/runs/36428645646): release-please job 成功、publish skip）。この version の SemVer container image は publish job が skip されたため公開されていません（GHCR package の直接検証は `read:packages` 権限が必要なため未実施）。別 commit から `0.1.0` を後付け公開したり、tag・Release を移動・削除・再作成したりしてはいけません。次の正常な Release PR の候補は `v0.1.1` です。失敗した version を別 commit で再利用しません。

## DB migration と rollback

既存データを維持する additive migration は内容に応じて patch または minor とします。列削除、互換性のない型変更、データ損失、手動手順が必要な migration は breaking change とし、PR と CHANGELOG に明記します。通常の Compose/Dockge Deploy では web image が PostgreSQL healthy 後かつ Next.js 起動前に migration を適用するため、利用者は web のタグを更新して Deploy するだけで、既存の DB volume を削除する必要はありません。migration に失敗した場合は web が起動せず、ログを確認します。rollback では以前の完全な `X.Y.Z`、または調査時点の `sha-<full commit SHA>` へ web を pin します。migration が forward-only の場合、image を戻しても schema は戻らないため、バージョンダウン前に DB backup を取得してアプリとの互換性を確認し、必要なら DB backup を復元します。

private GHCR の pull には `read:packages` 権限が必要です。token は Compose や repository に保存しません。

```sh
printf '%s' "$GHCR_READ_PACKAGES_TOKEN" \
  | docker login ghcr.io --username YOUR_GITHUB_USERNAME --password-stdin
```

この repository には利用側の Renovate 設定を追加しません。利用側は Docker datasource で完全な SemVer を検出し、private GHCR の hostRules 認証を設定してください。`kobako-web` と `kobako-migrate` は同じ PR にまとめます。
