# kobako

自分のサーバーで動かす、日本語の家計簿です。

収入と支出を記録し、月ごとの収支やカテゴリ別の支出を確認できます。  
まだ開発中ですが、基本的な記録と振り返りには使える状態です。

## できること

- 収入・支出の登録、編集、削除
- 月ごとの収入、支出、収支の確認
- カテゴリ別支出の集計
- 月、種別、カテゴリによる取引の絞り込み
- パソコンとスマートフォンに対応した日本語 UI

## 現在の制限

現在は 1 つの家計を管理する構成です。ユーザー認証や家計の切り替えにはまだ対応していません。

認証がないため、インターネットへ直接公開せず、ローカルネットワークや VPN 内で使ってください。

## Docker Compose で起動する

Docker Engine と Docker Compose v2 が必要です。

```sh
git clone https://github.com/takano536/kobako.git
cd kobako
cp .env.example .env
docker compose up --build
```

起動したら、ブラウザで <http://127.0.0.1:3000> を開きます。

データは Docker volume に保存されます。通常の停止には次のコマンドを使います。

```sh
docker compose down
```

`docker compose down -v` を実行するとデータベースも削除されるため注意してください。

## ローカル開発

必要なもの：

- Node.js 24.21.0
- Corepack
- PostgreSQL 17 以上

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:migrate
pnpm dev
```

開発サーバーは <http://localhost:3000> で起動します。

## テスト

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
pnpm test:e2e
```

integration test と E2E には、開発用とは別のテスト専用データベースが必要です。接続先は `.env.example` を参考に設定してください。

## 構成

kobako は pnpm workspace を使ったモノリポです。

- `apps/web`：Next.js による Web アプリ
- `apps/worker`：バックグラウンド処理用のプロセス
- `packages/db`：PostgreSQL、Drizzle ORM、migration、入力検証
- `compose.yaml`：ローカル実行用の Docker Compose 構成

## コントリビューション

kobako は現在、個人利用を目的に開発しています。Issue や Pull Request は受け付けていません。

## License

Copyright (C) 2026 takano536

kobako is licensed under the GNU Affero General Public License v3.0 or later. See [LICENSE](LICENSE).
