# 技術的判断

## Stack versions

Node.js 24.21.0（`.node-version`）と pnpm 12.6.0 を固定します。TypeScript は 6.0.3 を採用しました。`typescript-eslint` 8.70.1 の peer range が TypeScript 6.1 未満であるため、TypeScript 7 は peer range が対応するまで保留します。Next.js 16.3.6、React 19.3.0、Drizzle ORM 0.45.3、Drizzle Kit 0.31.11、Zod 4.6.5、Vitest 5.0.2、Playwright 1.63.0 を lockfile で固定しています。

PostgreSQL の Compose image は `postgres:18.6-alpine3.24`、Node image は `node:24.21.0-bookworm-slim` とし、`latest` は使いません。

## postgres.js over pg

接続 client は postgres.js を選びました。現段階の単純な query/migration と少数 worker 接続に必要な API が小さく、Drizzle の postgres-js adapter と組み合わせられます。health query には接続 timeout と query の短い上限を設けます。

## Worker

worker は今すぐジョブを処理しませんが、web request と将来の Import/Export 等を分離するプロセス境界には価値があります。そのため、起動時 DB check、signal による graceful shutdown、idle 待機だけを実装しました。pg-boss やダミー job はまだ導入しません。

## Renovate

Dependabot と Renovate の二重運用は避け、Renovate を採用します。pnpm lockfile、workspace、GitHub Actions、Docker base image を更新対象にし、dependency dashboard と grouping は設定しますが、自動 merge は行いません。

## Shared packages

domain/config package は今の要件に共有 domain code がないため作りません。DB URL schema と redaction は web と worker が実際に共有するため `@kobako/db` に置き、空の抽象 package を増やさない方針です。

## Next.js generated guidance

Next.js 16 の `next dev` が生成する `apps/web/AGENTS.md` と `apps/web/CLAUDE.md` は、ファイル内の指示どおり削除せず commit します。将来の Next.js 開発時に、該当バージョンの公式ガイドを確認するための開発者向け案内です。
