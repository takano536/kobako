# ブランチと PR

`main` は常に CI が通る状態を保ち、直接 push しません。作業ごとに目的別 branch を作り、PR で squash merge します。秘密情報、`.env`、`.tmp/` は commit しません。

## Commit と通常 PR

Conventional Commits を使います。

```text
feat: add transaction import
fix: handle database timeout
chore: update CI action pin
docs: clarify local setup
```

Required status checks は `lint`、`unit`、`integration`、`build`、`e2e`、`docker` の6個です。各 job は run の `GITHUB_SHA` と同じ commit を checkout します。CI が実行されない状態、または失敗・skipped の状態で merge しません。

## Release PR

Release Please は `main` の Conventional Commit から次の Release PR を作成または更新します。

- head branch: `release-please--branches--main--components--kobako`
- base: `main`
- label: `autorelease: pending`
- same canonical repository、bot author、open、非 draft

Release Please jobは main push の6 gate成功後に、kobakoだけへ install した repository-scoped GitHub App tokenを使います。`GITHUB_TOKEN` fallbackはありません。App setupの詳細と原因は [`docs/releasing.md`](releasing.md) を参照してください。

Release PR の更新は native `pull_request` CI を起動します。`release-automerge.yml` は CI の `workflow_run` completed eventだけを受け、trustedなmain checkoutからREST APIでPR identity、base/head SHA、single-parent、allowlisted diff、web-flow署名、GitHub Actions app (`15368`) の6 native checksを再検証します。PR head codeをcheckoutして検証コードとして実行しません。

- 6 checkが全て `completed/success` で、live mainが変わっていなければ、または live main が Release Please の verified merge-base より先行していて stale diff が allowlist だけなら、evaluatorは App tokenで head SHAを指定した squash mergeを実行します。stale baseを許可するため ruleset の strict status check（branch を最新にする要求）は無効化します。concurrencyは `workflow_run.id` ごとに `cancel-in-progress: false` とし、sha-pinned mergeとidempotency guardで重複を安全に停止します。PR CI完了イベントに加えてmain push CI完了イベントでもlive mainのcanonical open Release PRを再取得します。duplicate eventやrerunは既にmergedならno-opです。head更新、fork、author/base/label違い、extra file、signature不備、missing/pending/failure/cancelled/skipped check、merge 405/409は安全に停止します。cron、workflow_dispatch、release-verify refをrequired checksの代用にしません。

App tokenのmergeは main push CIを実際の squash SHA `M`で起動します。main push runは `github.sha` ごとの concurrency groupで後続pushにpending置換されず、`commits/M/pulls` から `merge_commit_sha == M` のcanonical Release PRを一つだけ対象にし、`merged_by`、metadata、main ancestry、sole-parent、tag/Release targetを再検証します。canonical releaseならRelease Pleaseで `vX.Y.Z` tag / GitHub Releaseを `M == GITHUB_SHA`へ作成し、`publish_release`だけがversioned imageと`sha-M` imageを公開します。通常のmain pushは`publish_main`だけがsha imageとlatestを公開します。latestはlive main tipが対象SHAと一致するlock内でのみpromoteします。

## Version と CHANGELOG

- `0.x`: `fix:` は patch、`feat:` と breaking change は minor
- `1.0.0` 以降: `fix:` は patch、`feat:` は minor、breaking change は major
- `docs:`、`test:`、`ci:`、`chore:`、`refactor:` だけでは release しない

`.release-please-manifest.json` の root version、root `package.json`、configured `extra-files`は一致しなければなりません。`CHANGELOG.md` は先頭の `# Changelog`を一つだけ保持し、直後に新しいrelease sectionを挿入して既存履歴を変更しません。validatorがRelease Please allowlist外のファイル変更やversion以外のJSON変更を拒否します。

## 復旧

- App variable / secret不足は job の明示的な errorです。`RELEASE_APP_CLIENT_ID`、`RELEASE_APP_BOT_LOGIN`、`RELEASE_APP_PRIVATE_KEY`、App installation（`takano536/kobako`のみ）を修正し、次のmain pushを待ちます。
- App API 403はContents RW、Pull requests RW、Issues RW、Metadata Rの不足を意味します。権限を広げず、対象installationだけを修正します。
- native gate失敗、head mismatch、main更新、conflictは古いSHAで再mergeしません。原因を直してPRを更新すれば新しいCIとworkflow_runが自動的に再評価します。
- tag/Release/imageのpartialまたはtarget mismatchは上書き・tag移動しません。同じmerge SHAの成功push runだけを安全に再実行し、別commitへのversion再利用はしません。Mのquality gateやpublishが一時失敗した場合は後続pushを作らず、Mのpush runでfailed jobsをrerunします。github.sha=Mとimmutable target probe、canonical merged PRのpending→tagged label repairによりfinalizeは冪等です。

詳細な原因、通常フロー、GHCR、recovery手順は [`docs/releasing.md`](releasing.md) を参照してください。
