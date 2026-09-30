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
households (1) ──< accounts
     │                │
     ├──< categories  ├──< transactions (income/expense)
     │                │          │
     │                └──────< transfers (from/to accounts)
     │
     └──< transaction_imports  [fingerprint: (household, source, sha256)]
```

- `accounts`: 家計ごとの資産・口座名。`(household_id, name)` を一意にし、`(id, household_id)` の複合キーを複合 FK の参照先にします。家計削除は cascade、取引または振替から参照されている口座の削除は restrict です。
- `categories`: `household_id`、`type`（`expense`/`income`）、表示名、並び順。`(household_id, type, name)` を一意にし、初期カテゴリを支出 9 種・収入 3 種登録します。
- `transactions`: 収入・支出だけを保存する既存の台帳です。`account_id` は nullable で、手入力の取引は口座を持たないため nullable です。`(account_id, household_id)` の複合 FK と account lookup index を持ち、カテゴリ FK と合わせて別家計の参照を DB で拒否します。
- `transfers`: 振替を一つの追跡可能な行として保存し、`from_account_id`、`to_account_id`、正の JPY `amount`、`occurred_on`、`memo` を持ちます。送金元と送金先は CHECK で異なることを強制し、両端に household を含む複合 FK を張ります。日付・送金元・送金先の各 lookup index を持ち、家計削除は cascade、口座削除は restrict です。振替は収入・支出・カテゴリ集計に入れません。
- `transaction_imports`: `household_id`、`source`（`realbyte-money-manager`）、raw ファイルバイト列の SHA-256、元ファイル名、全件数、種別ごとの件数、作成日時を保存します。`(household_id, source, sha256)` を一意制約として重複ファイルを防ぎ、ファイル本体とセルデータは保存しません。
- 全ての Web query は呼び出し元が渡す household を条件に含めます（現状は常に `getCurrentHouseholdId()` の値）。月次範囲は `YYYY-MM-01` 以上、翌月 1 日未満の half-open range です。
- 月・日付が扱う年は 1900〜9998 年（`packages/db/src/month.ts` の `MIN_SUPPORTED_YEAR`/`MAX_SUPPORTED_YEAR`）に制限します。PostgreSQL `date`/`YYYY-MM` 自体はこれより広い範囲を扱えますが、`0000-01` のような極端な値が migration 未対応のクライアント入力や URL 改ざんから届いても 500 にならないよう、`isValidMonth`/`isCalendarDate`/`parseMonth`/`shiftMonth` すべてでこの範囲を検証・フォールバックします。

初期データは `packages/db/src/ledger.ts` の `initializeDefaultLedger` が `ON CONFLICT DO NOTHING` で登録します。`runMigrations` が Drizzle migration の後に呼び出すため、空 DB と再実行の両方で同じ結果になります。

`migrate.ts` は Drizzle migrator に `drizzle` フォルダを渡し、migration を順番に適用します。

## データベース

接続には `postgres`（postgres.js）と Drizzle ORM を使います。`system_healthchecks` は migration と読み書きの疎通確認を保つための domain-neutral なテーブルです。家計簿 query は `@kobako/db` の `ledger.ts` に集約し、Web から全行をクライアントへロードしません。月次合計・カテゴリ別合計は SQL で集計し、PostgreSQL の `bigint` 結果を文字列で受け、差額も `BigInt` で計算します。

DB URL の検証は `@kobako/db` の関数を呼び出した時にだけ行います。そのため Next.js build は runtime credentials を必要としません。health endpoint は成功時・失敗時とも `{status: ...}` だけを返し、サーバーログも URL の credential/query を redaction します。

## 表示と mutation

概要と一覧は Server Component で URL query (`month`、`type`、`category`) を読み、DB へ条件を渡します。不正な `month` は Asia/Tokyo の現在月へフォールバックし、未来月は空のまま表示します。

`/transactions` は `listLedgerEntries` で通常取引と振替を日付順に混ぜ、振替を単一の read-only 行（`振替`、`移動元 → 移動先`）として表示します。種別またはカテゴリの filter 中は振替を表示せず、振替は収入・支出の全 totals から除外します。

登録・編集・削除は Server Actions だけで行います。Client Component のフォームは React 19 `useActionState`/`useFormStatus` で pending とフィールドエラーを表示しますが、同じ厳格な金額形式を含む Zod schema を Server Action でも必ず再検証します。成功時は対象月へ redirect し、`/` と `/transactions` を `revalidatePath` して読み取りを新しくします。削除は `<details>` の確認開示と `confirm=delete` の hidden field を持つ専用フォームで、確認値なしでは削除せず、JavaScript 無効でも 2 回目の送信だけが実行されます。削除後に削除 URL へ戻りません。
表示側は signed amount を種別ごとに SQL 合計し、収支差額を `income - expense` として `BigInt` で計算します。取引行では 0 を `0円`、支出の負数を返金・訂正として `＋`、収入の負数を `−` で表示します。カテゴリ別支出の構成比は支出合計が 0 以下またはカテゴリ合計が負なら `—`、カテゴリ合計が 0 なら `0%` とし、バー幅は非正の値で 0 です。

`getAccountBalances` は口座ごとの残高を `income - expense - transfersOut + transfersIn` で計算し、口座を持たない手入力の取引を除外します。

日付欄は表示用 button と送信用 native date input の二重構造を持ちますが、overlay input に `tabIndex=-1` を設定して Tab stop を 1 つにします。表示 button はラベル、フォーカスリングを持ち、mouse/touch と Enter/Space の keyboard 操作から native picker を開きます。

## インポート・ファイル読み込み

「らくな家計簿」（Realbyte Money Manager）Android 版の Excel エクスポートからインポートできます。Web の `/transactions/import` では、ファイルを選択してプレビューを確認し、同じファイルをもう一度送信して確定します。JavaScript が無効でも同じフォームを二回送信できます。

`@kobako/db` では、入力の正規化、XLSX の解析、データベース操作を分離しています。

- `packages/db/src/money-manager-format.ts` はセル値の検証と金額・日付・カテゴリの正規化を担当します。データベースには接続しない純粋な関数です。
- `packages/db/src/money-manager-xlsx.ts` は OOXML と ZIP を解析します。yauzl でエントリを必要な時に読み込み、saxes で XML を解析し、数式セル、DTD、外部実体を拒否します。`MONEY_MANAGER_XLSX_LIMITS` で ZIP のエントリ数を 128、エントリごとの未圧縮サイズを 8 MiB、全体の未圧縮サイズを 32 MiB、共有文字列を 100,000 件かつ 8 MiB までに制限します。ワークシートの取引行は読み込み時に 10,000 行まで、金額・日付シリアルの数値表記は 64 文字までです。共有文字列の参照先が不正な場合はファイルエラーにします。
- `packages/db/src/imports.ts` はデータベース操作を担当します。`findMoneyManagerImport()` で重複を確認し、`commitMoneyManagerImport()` で一つのトランザクションとして確定します。家計を `SELECT FOR UPDATE` でロックし、カテゴリの並び順を 10 刻みで割り当てる処理もロック内で行います。
- `packages/db/src/money-manager.ts` はインポート関連の公開サブパスを再エクスポートします。

`apps/web/next.config.ts` では Server Action のリクエスト本文の上限を 6 MB に設定し、5 MiB のファイルと multipart の付加分を受け付けます。`yauzl` と `saxes` は Node.js サーバーの外部パッケージとして扱います。

プレビューでは `moneyManagerImportAction` が `intent=preview` のファイルを受け取り、元のバイト列から SHA-256 ハッシュを計算して `parseMoneyManagerXlsx()` で正規化します。`findMoneyManagerImport()` によって同じ家計、提供元、ハッシュの記録を確認し、`money-manager-import-contract.ts` のシリアライズ可能な型で、ファイル名・サイズ・期間・収入/支出/振替の件数と合計・新規カテゴリ・新規口座・上限付きサンプル・ファイルエラー・行エラーを返します。既存記録は `alreadyImported` と前回日時で表し、ハッシュの詳細を UI に要求しません。

確認では同じフォームから選択中のファイルをもう一度送信します。サーバーアクションはファイルを読み直して上限を検証し、ハッシュと内容を比較してから `commitMoneyManagerImport()` を呼びます。問題がなければ家計のロック、インポート記録、カテゴリ・口座の作成または再利用、収入/支出と振替の追加を一つのトランザクションで行います。振替行は「引き出し」を振替元 B「資産」、振替先 C「分類」、金額 F として保存します。J は JPY の確認に使い、保存しません。I/K も保存しません。手数料は推測しません。完了画面の一覧リンクは、取り込んだ期間の最新月を開きます。

対応する形式は Android 版だけです。先頭 11 列は日付、資産、分類、小分類、内容、JPY、収入/支出、メモ、金額、通貨、資産の順で、日付は 1900 年方式の Excel シリアル値、金額は `/^-?\d+(?:\.0+)?$/` に一致する整数または `.0` で終わる値だけを受け付けます。通貨は行ごとに JPY を確認します。通常行の B は口座名、振替行の B/C は元先口座名です。空の口座名、同一の元先口座、未知の種別、日付・金額不正は行エラーにし、未知だが空でない口座名はプレビューに新規口座として表示して確定時に作成します。

`transaction_imports` にはファイル本体ではなく、ハッシュ、元ファイル名、提供元、全件数、種別ごとの件数、作成日時だけを保存します。SHA-256 は 64 文字の小文字 16 進数として CHECK で検証します。ZIP の過剰な展開は yauzl のサイズ検証で防ぎ、saxes は DOCTYPE を拒否します。数式セルも行エラーとして扱います。パーサーはサーバー側だけで動作し、ファイル本体をディスクへ書き込みません。

## 実行モデル

Next.js は `output: 'standalone'` で build し、Docker では non-root の `node` user で起動します。Compose では PostgreSQL が healthy になってから `web` を起動し、web image に同梱した migration（schema + 初期データ）を Next.js の起動前に適用します。`worker` は `web` の health check 後に起動するため、通常構成に終了済みのワンショット `migrate` サービスはありません。PostgreSQL の health check は接続可能になるまでを、web の entrypoint は migration の成否をそれぞれ担当します。

migration 中に受け取った `SIGTERM`/`SIGINT` は、Compose の `init: true` でも `--init` なしの `docker run` でも entrypoint から migrator に転送され、Next.js を起動せずに非ゼロで終了します。

Drizzle の postgres-js migrator は migration SQL と journal の記録を一つの transaction で実行します（schema と migration table の準備はその前です）。そのため migration が失敗すると、その migration の SQL と記録はまとめて rollback されます。

worker は busy loop やダミー job を持ちません。DB check が成功した後、signal を解決条件とする promise を待ちます。`SIGTERM`/`SIGINT` で DB client を閉じ、正常終了します。
