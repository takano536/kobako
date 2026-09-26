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

Required status checks として `lint`、`unit`、`integration`、`build`、`e2e`、`docker` を設定します。CI が実行されない状態で merge せず、失敗時はログと再現手順を確認します。
