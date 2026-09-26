# アーキテクチャ

## 境界

kobako は pnpm workspace の modular monolith として始めます。

- `apps/web`: Next.js App Router。表示用ページと health endpoint を提供します。
- `apps/worker`: 将来の非同期処理のプロセス境界。現段階では起動時の DB check 後に待機し、ジョブ実装は持ちません。
- `packages/db`: PostgreSQL 接続、Drizzle schema、migration、環境変数検証、接続先 redaction を提供します。

依存方向は apps → packages です。package から app へ依存しません。現時点で domain と呼べるコードはないため、空の共有 package は作っていません。

## データベース

接続には `postgres` (postgres.js) と Drizzle ORM を使います。`system_healthchecks` は migration と読み書きの疎通確認だけを目的とした domain-neutral なテーブルです。家計簿のテーブルはまだ作りません。

DB URL の検証は `@kobako/db` の関数を呼び出した時にだけ行います。そのため Next.js build は runtime credentials を必要としません。health endpoint は成功時・失敗時とも `{status: ...}` だけを返し、サーバーログも URL の credential/query を redaction します。

## 実行モデル

Next.js は `output: 'standalone'` で build し、Docker では non-root の `node` user で起動します。Compose では PostgreSQL healthy → migration completed → web/worker の順に依存させます。

worker は busy loop やダミー job を持ちません。DB check が成功した後、シグナルを解決条件とする promise を待ちます。`SIGTERM`/`SIGINT` で DB client を閉じ、正常終了します。
