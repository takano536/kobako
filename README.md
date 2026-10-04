# kobako

自分のサーバーで動かす、日本語の家計簿です。

収入と支出を記録し、月ごとの収支やカテゴリ別の支出を確認できます。

## できること

- 取引の登録・編集・削除（支出・収入・振替を選んで登録）
- 月ごとの収入、支出、収支の確認
- 資産・負債・純資産の集計と、現金・銀行・クレジットカード・デビットカードの順に並ぶ資産別残高一覧
- 資産の登録・設定、電子マネーなど既存の資産グループへの配置、論理削除
- クレジットカードの締め日・支払日・支払月・引落口座を資産設定で一つのフォームから編集
- 取引・振替の資産による絞り込みと、絞り込み画面からの資産設定
- 手入力の収入・支出で資産を任意に指定（未指定も可）
- カテゴリ別支出の集計
- 月、種別、カテゴリ、資産による取引の絞り込みとページ移動
- パソコンとスマートフォンに対応した日本語 UI
- 「らくな家計簿」の Excel エクスポートファイルからのインポート

## 現在の制限

現在は 1 つの家計を管理する構成です。ユーザー認証や家計の切り替えにはまだ対応していません。

- Android 版「らくな家計簿」の日本語 Excel 形式のみ対応
- 振替の登録には2つ以上の削除されていない資産が必要
- 初期残高（開始残高）の設定には未対応
- 資産グループの追加・改名・並び替え UI は提供していません。既存グループを維持し、標準グループを固定順で表示します
- 資産の削除は `deleted_at` を使う論理削除です。資産の状態、過去の取引・振替・インポート対応付けは保持します

認証がないため、インターネットへ直接公開せず、ローカルネットワークや VPN 内で使ってください。

## 「らくな家計簿」から取り込む

Realbyte「らくな家計簿」Android 日本語版からエクスポートした Excel ファイルを取り込めます。

取引画面の「取り込む」からファイルを選び、プレビューを確認してください。収入・支出・振替、期間、件数、新しいカテゴリ、新しい資産を確認してから確定します。未対応付けの資産は確定時に自動で「その他」へ作成され、安定 ID または名前の対応付けは次回以降の同じ取り込み元で再利用されます。既存資産の設定や名称はインポートで上書きしません。同じファイルを誤って二重に取り込むことはありません。

対応するファイルは `.xlsx`、5 MiB・10,000 件までです。

## Docker Compose で起動する

Docker Engine と Docker Compose v2 が必要です。

```sh
git clone https://github.com/takano536/kobako.git
cd kobako
cp .env.example .env
docker compose up --build
```

起動したら、ブラウザで <http://127.0.0.1:3000> を開きます。

### DB migration

Compose は PostgreSQL が healthy になってから `web` を起動し、単一の公開 image (`ghcr.io/takano536/kobako:<tag>`) に同梱した migration を Next.js の起動前に自動適用します。`worker` は `web` の health check 後に起動するため、通常構成に終了済みの `migrate` サービスは残りません。`web` と PostgreSQL だけの構成でも、公開 image tag を更新して通常の Deploy を実行でき、既存の DB volume を削除する必要はありません。

Migration に失敗した場合は `web` は起動せず、コンテナログに `[web] migration failed` が出力されます。migration はスキーマを自動 downgrade しないため、バージョンダウン前にはバックアップを取得し、アプリと DB スキーマの互換性を確認してください。

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
git diff --check
```

integration test と E2E には、開発用とは別のテスト専用データベースが必要です。接続先は `.env.example` を参考に設定してください。migration の確認では既存の volume を使わず、ローカル Docker の使い捨て DB を使用してください。

## 構成

kobako は pnpm workspace を使ったモノリポです。

- `apps/web`：Next.js による Web アプリ（取引・残高・資産設定 UI）
- `apps/worker`：バックグラウンド処理用のプロセス
- `packages/db`：PostgreSQL、Drizzle ORM、migration、入力検証、元帳・資産・取り込み対応付け
- `compose.yaml`：ローカル実行用の Docker Compose 構成

## コントリビューション

kobako は現在、個人利用を目的に開発しています。Issue や Pull Request は受け付けていません。

## License

Copyright (C) 2026 takano536

kobako is licensed under the GNU Affero General Public License v3.0 or later. See [LICENSE](LICENSE).
