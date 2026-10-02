# ブランチと PR

`main` は常に CI が通る状態を保ち、直接 push しません。作業ごとに `chore/bootstrap-development-foundation` のような短い目的別 branch を作り、PR で merge します。

## Commit

Conventional Commits を使います。

```text
feat: add transaction import
fix: handle database timeout
chore: update CI action pin
docs: clarify local setup
```

一つの commit は一つの意図に寄せ、migration を含む場合は PR の説明に対象 schema と適用手順を書きます。秘密情報、`.env`、`.tmp/` は commit しません。

## PR

PR template の変更概要・理由・検証内容・migration・security impact・未解決事項を埋めます。UI 変更には screenshot の要否を記載します。

Required status checks は `lint`、`unit`、`integration`、`build`、`e2e`、`docker` の6個です。CI が実行されない状態で merge せず、失敗時はログと再現手順を確認します。通常 PR は人間が従来どおり main へ squash merge します。

## Release PR

Release Please は main の Conventional Commit（squash merge 後の PR title）から Release PR を作成または更新します。Release PR も squash merge しますが、canonical な Release Please PR（bot author、同一 repository head、base=`main`、正確な head branch、`autorelease: pending`、open・非 draft）だけを automation が自動 merge します。title や branch 名だけでは対象とみなしません。

`GITHUB_TOKEN` が作成・更新する Release PR の native `pull_request` CI は承認待ちになります。無人運用は repository 限定の release App を設定し、App 未設定時は maintainer が native CI を承認します（設定は [`docs/releasing.md`](releasing.md)）。dispatch 成功だけでは PR required checks の代わりになりません。追加の head 検証として、Release Please の main run は REST API で PR を再検証して同じ head ref に `workflow_dispatch` を送ります。dispatch run の6 gateが in-run で成功し、GitHub の PR required-check rollup の6 gateが全てSUCCESSであることを確認し、Checks API の同じ head SHA にある各 gate の最新 check が GitHub Actions app の `completed/success` である場合だけ、検証済み head SHA を指定して squash merge します。head 更新、main の先行、missing/pending/failure/skipped/neutral/cancelled check、fork、他 author、他 base、label 欠落は merge しません。

merge は GITHUB_TOKEN の push workflow suppression を受けるため、merge commit `M` へ専用 ref `release-verify/<M>` を作成し、`workflow_dispatch` で6 gateを **その run の `github.sha == M`** として再実行します。main push run（人間が Release PR を merge した場合を含む）は release/tag を作成せず、pending の merged Release PR の verify ref/run を REST API で自己修復します。verify run だけが `M` を tag、GitHub Release、versioned GHCR image の対象にします。

verify ref/runとRelease PR branch dispatchはnon-cancellable groupで動き、pending runだけを新しいdispatchに置き換えます。PUT merge後に古いRelease PR runが止まっても、SHA/base-tip guardがstale mergeを拒否し、merge成功runのverify handoffを妨げません。

Release PR の title は Release Please v17.6.1 の default pattern に従う `chore(main): release X.Y.Z` とし、body の root release section、root `package.json` version、manifest versionを automation が照合します。Release PR の変更は `release-please-config.json` から導出した CHANGELOG/manifest/package version/extra-files の allowlist 内だけで、head の author は `github-actions[bot]` または設定済み release App の Bot、committer は同 Bot または GitHub API の署名検証が `verified=true`・`reason=valid` の `web-flow` User である必要があります。

main の base-tip check は merge API の compare-and-swap ではないため原子的ではありません。merge 後の `release-verify/<M>` run が `M` を checkout し、6 required checks、canonical PR、main ancestry、Release metadata、tag/Release target を全て再検証します。Release PR branch の update を bot と限定する ruleset、および main の `strict_required_status_checks_policy: true` は optional hardening（未適用）です。後者は通常 PR に最新 main の取り込みを要求する運用コストがあります。

`release-verify` branch/ref が既に存在する、または別 SHA を指す場合は新しい ref を上書きせず停止します。conflict/mismatch ref を削除した後、同じ `M` の recovery dispatchを行います。verify ref の残存確認は `gh api repos/takano536/kobako/git/matching-refs/heads/release-verify/` で行います。`autorelease: tagged` 後の image publish failure は main self-heal の対象外なので、同じ SHA の failed-job rerun/recovery dispatchで再開し、tag/Release/imagesをmatching SHAから再利用します。

SemVer の規則は次のとおりです。

- `0.x`: `fix:` は patch、`feat:` と breaking change は minor
- `1.0.0` 以降: `fix:` は patch、`feat:` は minor、breaking change は major
- `docs:`、`test:`、`ci:`、`chore:`、`refactor:` だけでは release しない

不具合修正を `chore:` や `ci:` に偽装せず、複数の `fix:` を一つの Release PR に蓄積します。`v0.1.0` は quality gate 失敗前に作成された履歴であり、SemVer image の backfill や version の再利用はしません。次の正常な Release PR の候補は `v0.1.1` です。タグは `vX.Y.Z`、GHCR の web/migrate は同じ `X.Y.Z` です。

安定版への移行では独自 prefix を作らず、`Release-As: 1.0.0` footer を使います。DB migration の breaking change、手動手順、rollback 不能性は PR と CHANGELOG（必要なら Release notes）に明記してください。詳細は [`docs/releasing.md`](releasing.md) を参照してください。
