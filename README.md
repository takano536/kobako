# kobako

自分のサーバーで動かす、日本語の家計簿です。

収入と支出を記録し、月ごとの収支やカテゴリ別の支出を確認できます。

## できること

- 取引の登録・編集・削除（支出・収入・振替を選んで登録）
- 月ごとの収入、支出、収支の確認
- 資産・負債・純資産の集計と、現金・銀行・クレジットカード・デビットカード・電子マネー・その他の順に並ぶ資産別残高一覧
- 資産の登録・設定、種別による分類、論理削除
- クレジットカードの締め日・支払日・支払月・引落口座を資産設定で一つのフォームから編集
- カード利用日を基準に導出する締め済み未払い額と、通常の銀行→カード振替としての決済記録
- 完全なカード設定に基づく期限日 catch-up（設定作成日以降）と、同一銀行に紐づくカード決済予定の合計
- 取引・振替の資産による絞り込みと、絞り込み画面からの資産設定
- 手入力の収入・支出で資産を任意に指定（未指定も可）
- カテゴリ別支出の集計
- 月、種別、カテゴリ、資産による取引の絞り込み
- パソコンとスマートフォンに対応した日本語 UI
- 「らくな家計簿」の Excel エクスポートファイルからのインポート

## 現在の制限

現在は 1 つの家計を管理する構成です。ユーザー認証や家計の切り替えにはまだ対応していません。

- Android 版「らくな家計簿」の日本語 Excel 形式のみ対応
- 振替の登録には2つ以上の削除されていない資産が必要
- カード請求の期間・期限は現在のカード設定から再計算され、設定変更前の履歴や初期残高は保持しません。全期間（台帳導入前の日付を含む）の取引・振替を FIFO で計算します
- カードの同月締め・支払日が不正または設定不足の場合、請求期間・期限は表示せず設定画面へ誘導します
- 自動決済は `auto_payment_starts_on` 以降の期限日（境界日を含む）を対象とし、引落口座が不正・不足なら blocked として次回再試行します。自動作成済み振替を削除しても再作成しません
- 初期残高（開始残高）の設定には未対応
- 資産の種別を追加・改名・並び替えする UI は提供していません。種別は固定順で表示します
- 資産の削除は `deleted_at` を使う論理削除です。資産の状態、過去の取引・振替・カード設定は保持します

認証がないため、インターネットへ直接公開せず、ローカルネットワークや VPN 内で使ってください。

## 「らくな家計簿」から取り込む

Realbyte「らくな家計簿」Android 日本語版からエクスポートした Excel ファイルを取り込めます。

取引画面の「取り込む」からファイルを選び、プレビューを確認してください。収入・支出・振替、期間、件数、新しいカテゴリ、新しい資産を確認してから確定します。同じ取り込み内では同じ提供元資産を一つの新規資産にまとめます。過去の取り込みとは照合せず、別の取り込み操作では同じファイルも毎回新しい資産・取引として追加され、重複分も収支と残高に反映されます。同じ確定操作の二重送信では重複しません。

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
- `apps/worker`：自動決済の期限日 catch-up と冪等なバックグラウンド処理
- `packages/db`：PostgreSQL、Drizzle ORM、migration、入力検証、元帳・資産・取り込み
- `compose.yaml`：ローカル実行用の Docker Compose 構成

## コントリビューション

kobako は現在、個人利用を目的に開発しています。Issue や Pull Request は受け付けていません。

## License

Copyright (C) 2026 takano536

kobako is licensed under the GNU Affero General Public License v3.0 or later. See [LICENSE](LICENSE).
