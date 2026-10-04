# アーキテクチャ

## 境界

kobako は pnpm workspace の modular monolith として始めます。

- `apps/web`: Next.js App Router。家計簿の表示・フォーム・Server Actions と health endpoint を提供します。
- `apps/worker`: 将来の非同期処理のプロセス境界。現段階では起動時の DB check 後に待機し、job 実装は持ちません。
- `packages/db`: PostgreSQL 接続、Drizzle schema、migration、家計簿 query、入力 validation、環境変数検証を提供します。

依存方向は apps → packages です。package から app へ依存しません。ブラウザに DB 接続や秘密情報が入らないよう、`@kobako/db` の client/query/parser は Server Component と Server Action から利用し、Client Component はサーバーアクション参照以外で DB/parser を直接 import しません。

## 家計簿ドメイン

認証導入前の ownership boundary として `households` を一つ持ちます。固定 UUID のローカル家計（slug `local`）を migration 後の idempotent initialization で作成し、ユーザー・session・member・invitation はまだ持ちません。将来は認証側からこの household にユーザーを関連付けます。

`@kobako/db` の `ledger.ts` は household を暗黙に固定しません。`listCategories`・`getCategory`・`listTransactions`・`getTransaction`・`getMonthlyTotals`・`getExpenseCategoryTotals`・`createTransaction`・`updateTransaction`・`deleteTransaction` はすべて `householdId` を最初の明示引数として受け取ります。`DEFAULT_HOUSEHOLD_ID`/`DEFAULT_HOUSEHOLD_SLUG` は `initializeDefaultLedger` の seed データ専用の定数として残し、query/mutation 本体からは参照しません。Web 側は `apps/web/src/lib/ledger-data.ts` の `getCurrentHouseholdId()` 一箇所だけで対象 household を解決し、すべての Server Component/Server Action がそこを経由します。将来の認証実装は、この一箇所をセッションから household を導出する実装に差し替えるだけで済みます。

```text
households (1) ──< accounts ──< transactions
     │             │             └──< transfers (from/to accounts)
     │             ├──< account_card_conditions (migration source)
     │             └──< account_card_settings (current, one row)
     └──< transaction_imports
```

- `accounts` の `kind`（`cash`/`bank`/`credit_card`/`debit_card`/`electronic_money`/`other`）を唯一の表示分類として扱い、同名資産を許可します。
- `accounts` は `status`（`active`/`closed`）、`deleted_at`、並び順を持ちます。論理削除後も取引・振替・カード設定の参照を保持します。
- `account_card_conditions` は移行元データを保持するだけで、実行時には参照しません。`account_card_settings` に移行時点の条件を一行だけ保存し、現在値を上書きします。
- `transaction_imports` はファイルハッシュと結果件数を保存します。別の `operation_key` の再取込は新しいデータとして追加し、同じ `operation_key` の再送信だけ同じ結果を返します。
- 全ての Web query は呼び出し元が渡す household を条件に含めます（現状は常に `getCurrentHouseholdId()` の値）。月次範囲は `YYYY-MM-01` 以上、翌月 1 日未満の half-open range です。
- 月・日付が扱う年は 1900〜9998 年（`packages/db/src/month.ts` の `MIN_SUPPORTED_YEAR`/`MAX_SUPPORTED_YEAR`）に制限します。PostgreSQL `date`/`YYYY-MM` 自体はこれより広い範囲を扱えますが、`0000-01` のような極端な値が migration 未対応のクライアント入力や URL 改ざんから届いても 500 にならないよう、`isValidMonth`/`isCalendarDate`/`parseMonth`/`shiftMonth` すべてでこの範囲を検証・フォールバックします。

初期データは `packages/db/src/ledger.ts` の `initializeDefaultLedger` が `ON CONFLICT DO NOTHING` で登録します。`runMigrations` が Drizzle migration の後に呼び出すため、空 DB と再実行の両方で同じ結果になります。

`migrate.ts` は Drizzle migrator に `drizzle` フォルダを渡し、migration を順番に適用します。

## データベース

接続には `postgres`（postgres.js）と Drizzle ORM を使います。`system_healthchecks` は migration と読み書きの疎通確認を保つための domain-neutral なテーブルです。家計簿 query は `@kobako/db` の `ledger.ts` に集約し、Web から全行をクライアントへロードしません。月次合計・カテゴリ別合計は SQL で集計し、PostgreSQL の `bigint` 結果を文字列で受け、差額も `BigInt` で計算します。

DB URL の検証は `@kobako/db` の関数を呼び出した時にだけ行います。そのため Next.js build は runtime credentials を必要としません。health endpoint は成功時・失敗時とも `{status: ...}` だけを返し、サーバーログも URL の credential/query を redaction します。

## 表示と mutation

概要と一覧は Server Component で URL query (`month`、`type`、`category`、`account`、`page`) を読み、DB へ条件を渡します。不正な `month` は Asia/Tokyo の現在月へフォールバックし、未来月は空のまま表示します。

`/transactions` は `listLedgerEntries` で通常取引と振替を日付順に混ぜます。資産の絞り込みは通常取引の `account_id` と振替の from/to の両方を対象にし、ページング・月・種別・カテゴリと組み合わせても重複を出しません。

- 登録・編集・削除は Server Actions だけで行います。Client Component の統合フォームは React 19 `useActionState`/`useFormStatus` で支出・収入・振替を切り替え、Zod schema を Server Action でも再検証します。新規操作の資産候補は削除されていない資産にし、既存取引を編集する場合は参照中の削除済み資産を保持します。新規振替も削除されていない資産を受け付けます。
- 資産登録は `/accounts/new`、設定は `/accounts/[id]/edit` の Server Action で行います。専用の資産一覧はなく、取引一覧で資産を絞り込んだときだけ削除されていない資産に設定歯車を表示します。資産設定フォームは名前・種別・カード現在条件をまとめて扱い、論理削除は `accounts.deleted_at` に日時を設定して参照行を保持します。

`getAccountBalances` は全期間の取引から資産ごとの計算上の残高を `income - expense - transfersOut + transfersIn` で計算します。残高画面は保存済み `kind` の順（現金、銀行、クレジットカード、デビットカード、電子マネー、その他）で表示します。現金・銀行・デビットカードは資産、クレジットカードは符号を反転して負債として表示します。

日付欄は表示用 button と送信用 native date input の二重構造を持ちますが、overlay input に `tabIndex=-1` を設定して Tab stop を 1 つにします。表示 button はラベル、フォーカスリングを持ち、mouse/touch と Enter/Space の keyboard 操作から native picker を開きます。

## UI レイアウト規則

画面の順序、見出しレベル、リンクの役割、共通コンポーネント、余白・行間トークンは [UI レイアウト規則](ui.md) にまとめます。

## インポート・ファイル読み込み

「らくな家計簿」（Realbyte Money Manager）Android 版の Excel エクスポートからインポートできます。Web の `/transactions/import` では、ファイルを選択してプレビューを確認し、同じファイルをもう一度送信して確定します。JavaScript が無効でも同じフォームを二回送信できます。

`@kobako/db` では、入力の正規化、XLSX の解析、データベース操作を分離しています。

- `packages/db/src/money-manager-format.ts` はセル値の検証と金額・日付・カテゴリの正規化を担当します。データベースには接続しない純粋な関数です。
- `packages/db/src/money-manager-xlsx.ts` は OOXML と ZIP を解析します。yauzl でエントリを必要な時に読み込み、saxes で XML を解析し、数式セル、DTD、外部実体を拒否します。`MONEY_MANAGER_XLSX_LIMITS` で ZIP のエントリ数を 128、エントリごとの未圧縮サイズを 8 MiB、全体の未圧縮サイズを 32 MiB、共有文字列を 100,000 件かつ 8 MiB までに制限します。ワークシートの取引行は読み込み時に 10,000 行まで、金額・日付シリアルの数値表記は 64 文字までです。共有文字列の参照先が不正な場合はファイルエラーにします。
- `packages/db/src/imports.ts` はデータベース操作を担当します。家計行を `SELECT FOR UPDATE` でロックし、カテゴリ・資産・取引・振替・取込結果を一つのトランザクションで確定します。資産は取込単位で新規作成し、同じ `operation_key` の再送信だけを冪等に処理します。
- `packages/db/src/money-manager.ts` はインポート関連の公開サブパスを再エクスポートします。

`apps/web/next.config.ts` では Server Action のリクエスト本文の上限を 6 MB に設定し、5 MiB のファイルと multipart の付加分を受け付けます。`yauzl` と `saxes` は Node.js サーバーの外部パッケージとして扱います。

プレビューでは `moneyManagerImportAction` が `intent=preview` のファイルを受け取り、元のバイト列から SHA-256 ハッシュと取込操作キーを生成して `parseMoneyManagerXlsx()` で正規化します。ハッシュは監査用に保存しますが再取込の判定には使わず、ファイル名・サイズ・期間・収入/支出/振替の件数と合計・新規カテゴリ・資産名・上限付きサンプル・ファイルエラー・行エラーを返します。

一回の確定では、取込元の同じ資産を同じ新規資産にまとめます。別の `operation_key` で同じファイルを確定すると、新しい資産・取引として追加され、重複分も月次収支と残高に反映されます。既存資産や既存カード設定は変更しません。

対応する形式は Android 版だけです。先頭 11 列は日付、資産、分類、小分類、内容、JPY、収入/支出、メモ、金額、通貨、資産の順です。空の資産名、同一の振替元先、未知の種別、日付・金額不正は行エラーにし、未知だが空でない資産名は新規資産として扱います。

`transaction_imports` にはファイル本体ではなく、ハッシュ、取込操作キー、元ファイル名、提供元、全件数、種別ごとの件数、作成日時だけを保存します。ハッシュは 64 文字の小文字 16 進数として CHECK で検証します。別操作の同じファイルは履歴・資産・取引を重複追加し、同じ操作キーの二重送信だけを部分一意制約で防ぎます。ZIP の過剰な展開は yauzl のサイズ検証で防ぎ、saxes は DOCTYPE を拒否します。数式セルも行エラーとして扱います。パーサーはサーバー側だけで動作し、ファイル本体をディスクへ書き込みません。

## 実行モデル

Next.js は `output: 'standalone'` で build し、Docker では non-root の `node` user で起動します。Compose では PostgreSQL が healthy になってから `web` を起動し、web image に同梱した migration（schema + 初期データ）を Next.js の起動前に適用します。`worker` は `web` の health check 後に起動するため、通常構成に終了済みのワンショット `migrate` サービスはありません。PostgreSQL の health check は接続可能になるまでを、web の entrypoint は migration の成否をそれぞれ担当します。

migration 中に受け取った `SIGTERM`/`SIGINT` は、Compose の `init: true` でも `--init` なしの `docker run` でも entrypoint から migrator に転送され、Next.js を起動せずに非ゼロで終了します。

Drizzle の postgres-js migrator は migration SQL と journal の記録を一つの transaction で実行します（schema と migration table の準備はその前です）。そのため migration が失敗すると、その migration の SQL と記録はまとめて rollback されます。

worker は busy loop やダミー job を持ちません。DB check が成功した後、signal を解決条件とする promise を待ちます。`SIGTERM`/`SIGINT` で DB client を閉じ、正常終了します。
