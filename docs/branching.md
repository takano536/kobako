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

Required status checks として `lint`、`unit`、`integration`、`build`、`e2e`、`docker` を設定します。CI が実行されない状態で merge せず、失敗時はログと再現手順を確認します。Release PR は `GITHUB_TOKEN` で作成されるため `pull_request` CI が自動実行されませんが、Release Please 成功後に同じ Release PR head へ手動 dispatch されます。merge 後は pending label、required check の成功、main の祖先関係を検証してから Release Please と GHCR publish を実行します。close/reopen や空 commit は不要です。

## Release PR

Release Please は main の Conventional Commit（squash merge 後の PR title）から Release PR を作成または更新します。通常 PR と Release PR は squash merge します。Release PR を merge するまでは実リリースされません。

SemVer の規則は次のとおりです。

- `0.x`: `fix:` は patch、`feat:` と breaking change は minor
- `1.0.0` 以降: `fix:` は patch、`feat:` は minor、breaking change は major
- `docs:`、`test:`、`ci:`、`chore:`、`refactor:` だけでは release しない

不具合修正を `chore:` や `ci:` に偽装せず、複数の `fix:` を一つの Release PR に蓄積します。`v0.1.0` は quality gate 失敗前に作成された履歴であり、SemVer image の backfill や version の再利用はしません。次の正常な Release PR の候補は `v0.1.1` です。タグは `vX.Y.Z`、GHCR の web/migrate は同じ `X.Y.Z` です。

安定版への移行では独自 prefix を作らず、`Release-As: 1.0.0` footer を使います。DB migration の breaking change、手動手順、rollback 不能性は PR と CHANGELOG（必要なら Release notes）に明記してください。詳細は [`docs/releasing.md`](releasing.md) を参照してください。
