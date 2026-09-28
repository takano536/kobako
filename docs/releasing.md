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

main への push は、同じ commit (`github.sha`) を明示的に checkout して次の quality gate を実行します。

1. format、Release Please 生成物の検証、lint、typecheck
2. unit、integration、production build、E2E
3. Docker の web/migrate/worker build と Compose の migration・web・DB health
4. すべて成功した場合だけ Release Please を実行
5. Release Please が `release_created: true` を返した場合だけ、厳密な `vX.Y.Z` tag を検証して SemVer image を公開

Release Please job は対象 commit が現在の main tip であることも確認します。main が先に進んでいた場合は安全に skip し、新しい push の run が処理します。Release PR が作成・更新された場合は、Release Please の出力にある同一 repository の open PR head branch へ `workflow_dispatch` を送り、quality gate だけを再実行します。手動 dispatch では Release job と publish job は実行しません。

Release PR の merge commit に `autorelease: pending` が付いている場合、Release Please の前にその commit の `lint`、`unit`、`integration`、`build`、`e2e`、`docker` の最新 check run がすべて `completed/success` であり、現在の main の祖先であることを検証します。これにより、別の commit や失敗した merge commit を tag することを防ぎます。main の quality gate が失敗した run は tag、GitHub Release、SemVer image を作成しません。

Release Please が `GITHUB_TOKEN` で作る Release PR には `pull_request` workflow が自動起動しない GitHub の制約があります。Release PR merge 前の任意チェックはこの自動起動に依存せず、上記の手動 dispatch と merge 後の正確な main commit の gate を Release Please より先に必須化します。close/reopen、空 commit、手動整形は不要です。

### 失敗した Release merge の復旧

guard は main の現在 tip commit ではなく、merge済み `autorelease: pending` PR の merge commit 自体の check run を検証します。そのため主な復旧手段は、その merge commit を main の tip に留めたまま Actions run を再実行することではなく、次の通常の main push が自然に guard を再評価することです。

- 通常は追加の commit を通常どおり main に push するだけで十分です。その push 自身の run が guard を再実行し、merge commit の check run が既に成功していれば、そのまま Release Please と publish が同じ Release PR merge commit を対象に進みます。close/reopen、空 commit、手動整形は不要です。
- merge commit がまだ main の tip で、かつ失敗が一時的な runner や外部サービスの問題だった場合に限り、その merge commit の Actions run で **Re-run failed jobs** も使えます。main tip が既に先へ進んでいる場合、この古い run の `main_tip` step は `at_tip=false` になり Release Please も publish も skip するため、古い run の再実行に頼ってはいけません。
- Release commit 自体が壊れている場合は、まず修正 commit を main に入れます。修正だけでは失敗した merge commit の check run は成功に変わらないため、guard が tag を阻止し続けます。
- 壊れた merge 済み Release PR を保留から外すときだけ、その PR から `autorelease: pending` label を削除します。`autorelease: tagged` は追加せず、tag や GitHub Release を手動作成・移動しません。次の main push で、manifest の現在値から新しい Release PR が作られます。必要な version を明示する場合は、通常の release commit に `Release-As: <次の SemVer>` footer を付けます。

## GHCR image

- `ghcr.io/takano536/kobako-web:X.Y.Z`
- `ghcr.io/takano536/kobako-migrate:X.Y.Z`

`web` と `migrate` は必ず同じ Release PR merge commit の同じ version で公開します。Release image は `^vX.Y.Z$` の Release Please output 以外から作成せず、tag が origin に存在し、保護された merge commit を指すことを公開前に確認します。OCI label の `source`、`revision`、`version` も検証します。同じ version が同じ revision で既に存在する場合は再実行時に再利用し、別 revision または不明な内容なら上書きせず失敗します。

main の quality gate に成功した通常 build では次の tag も更新します。

- `sha-<full commit SHA>`: 再現・rollback 用
- `latest`: 最新の quality gate 成功 main build。可変 tag なので production では使わない

Release merge commit への main push では `publish_main` と `publish_release` が同じ push で並行して実行されるため、SemVer image (`X.Y.Z`、Release PR merge commit から) に加えて、その merge commit を現在の main commit とする `sha-<full commit SHA>` と `latest` も更新されます。SemVer 以外の通常の main push（Release Please が未作成の場合）は `sha-<full commit SHA>` と `latest` だけを更新します。production と Renovate は完全な `X.Y.Z` を指定し、`X` や `X.Y` は使用しません。GHCR の package visibility は変更しません。

## v0.1.0 の扱い

`v0.1.0` の tag と GitHub Release は、quality gate を release job の前提条件にしていなかった旧 workflow によって、commit `11edf60`（`chore(main): release 0.1.0 (#7)`）の quality gate 中 `lint`（`pnpm format:check`）が失敗していたにもかかわらず作成されました（CI run [36428644862](https://github.com/takano536/kobako/actions/runs/36428644862): lint 失敗、publish skip。Release Please run [36428645646](https://github.com/takano536/kobako/actions/runs/36428645646): release-please job 成功、publish skip）。この version の SemVer container image は publish job が skip されたため公開されていません（GHCR package の直接検証は `read:packages` 権限が必要なため未実施）。別 commit から `0.1.0` を後付け公開したり、tag・Release を移動・削除・再作成したりしてはいけません。次の正常な Release PR の候補は `v0.1.1` です。失敗した version を別 commit で再利用しません。

## DB migration と rollback

既存データを維持する additive migration は内容に応じて patch または minor とします。列削除、互換性のない型変更、データ損失、手動手順が必要な migration は breaking change とし、PR と CHANGELOG に明記します。rollback では以前の完全な `X.Y.Z`、または調査時点の `sha-<full commit SHA>` へ web と migrate を一緒に pin します。migration が forward-only の場合、image を戻しても schema は戻らないため、必要なら DB backup を復元します。

private GHCR の pull には `read:packages` 権限が必要です。token は Compose や repository に保存しません。

```sh
printf '%s' "$GHCR_READ_PACKAGES_TOKEN" \
  | docker login ghcr.io --username YOUR_GITHUB_USERNAME --password-stdin
```

この repository には利用側の Renovate 設定を追加しません。利用側は Docker datasource で完全な SemVer を検出し、private GHCR の hostRules 認証を設定してください。`kobako-web` と `kobako-migrate` は同じ PR にまとめます。
