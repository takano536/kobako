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
households (1) ──< account_groups ──< accounts
     │                                      │
     ├──< categories  ├──< transactions ────┘
     │                │
     │                └──< transfers (from/to accounts)
     │
     ├──< account_import_mappings
     ├──< account_card_conditions (account/debit account)
     └──< transaction_imports  [fingerprint: (household, source, sha256)]
```

- `account_groups`: 家計ごとの口座グループ。標準 5 グループは idempotent に seed し、口座とは独立して並び順を持ちます。空のカスタムグループだけ削除できます。
- `accounts`: 家計ごとの口座名、`kind`（`cash`/`bank`/`electronic_money`/`credit_card`/`other`）、`status`（`active`/`closed`：利用中／利用終了）、グループ、並び順を持ちます。口座名は一意ではなく、同名登録は警告後に別口座として許可します。取引・振替・取り込み・別カードの引落口座として参照されている口座は削除できません。口座自身のカード条件履歴は削除時に同時に削除されます。
- `categories`: `household_id`、`type`（`expense`/`income`）、表示名、並び順。`(household_id, type, name)` を一意にし、初期カテゴリを支出 9 種・収入 3 種登録します。
- `transactions`: 収入・支出だけを保存する既存の台帳です。`account_id` は nullable で、口座を持たない取引も許可します。`(account_id, household_id)` の複合 FK と account lookup index を持ち、カテゴリ FK と合わせて別家計の参照を DB で拒否します。
- `transfers`: 振替を一つの追跡可能な行として保存し、`from_account_id`、`to_account_id`、正の JPY `amount`、`occurred_on`、`memo` を持ちます。送金元と送金先は CHECK で異なることを強制し、両端に household を含む複合 FK を張ります。日付・送金元・送金先の各 lookup index を持ち、家計削除は cascade、口座削除は restrict です。振替は収入・支出・カテゴリ集計に入れません。
- `account_import_mappings`: インポート提供元の安定した口座 ID（なければ名前）を家計内口座へ対応付けます。既存の対応付けは次回以降静かに再利用し、口座情報を上書きしません。
- `account_card_conditions`: クレジットカードの締め日・支払日・支払月ずれ・引落口座を `effective_from`（適用開始日）付き履歴として保存します。計算や自動振替は行いません。
- `transaction_imports`: `household_id`、`source`（`realbyte-money-manager`）、元ファイルのバイト列の SHA-256、元ファイル名、全件数、種別ごとの件数、作成日時を保存します。`(household_id, source, sha256)` を一意制約として重複ファイルを防ぎ、ファイル本体とセルデータは保存しません。
- 全ての Web query は呼び出し元が渡す household を条件に含めます（現状は常に `getCurrentHouseholdId()` の値）。月次範囲は `YYYY-MM-01` 以上、翌月 1 日未満の half-open range です。
- 月・日付が扱う年は 1900〜9998 年（`packages/db/src/month.ts` の `MIN_SUPPORTED_YEAR`/`MAX_SUPPORTED_YEAR`）に制限します。PostgreSQL `date`/`YYYY-MM` 自体はこれより広い範囲を扱えますが、`0000-01` のような極端な値が migration 未対応のクライアント入力や URL 改ざんから届いても 500 にならないよう、`isValidMonth`/`isCalendarDate`/`parseMonth`/`shiftMonth` すべてでこの範囲を検証・フォールバックします。

初期データは `packages/db/src/ledger.ts` の `initializeDefaultLedger` が `ON CONFLICT DO NOTHING` で登録します。`runMigrations` が Drizzle migration の後に呼び出すため、空 DB と再実行の両方で同じ結果になります。

`migrate.ts` は Drizzle migrator に `drizzle` フォルダを渡し、migration を順番に適用します。

## データベース

接続には `postgres`（postgres.js）と Drizzle ORM を使います。`system_healthchecks` は migration と読み書きの疎通確認を保つための domain-neutral なテーブルです。家計簿 query は `@kobako/db` の `ledger.ts` に集約し、Web から全行をクライアントへロードしません。月次合計・カテゴリ別合計は SQL で集計し、PostgreSQL の `bigint` 結果を文字列で受け、差額も `BigInt` で計算します。

DB URL の検証は `@kobako/db` の関数を呼び出した時にだけ行います。そのため Next.js build は runtime credentials を必要としません。health endpoint は成功時・失敗時とも `{status: ...}` だけを返し、サーバーログも URL の credential/query を redaction します。

## 表示と mutation

概要と一覧は Server Component で URL query (`month`、`type`、`category`、`account`、`page`) を読み、DB へ条件を渡します。不正な `month` は Asia/Tokyo の現在月へフォールバックし、未来月は空のまま表示します。

`/transactions` は `listLedgerEntries` で通常取引と振替を日付順に混ぜ、同じ通常行レイアウトで振替を `振替元 → 振替先` として表示します。種別で「振替」を選ぶと振替だけを表示し、カテゴリの絞り込みは振替では無効です。口座による絞り込みは通常取引の `account_id` と振替の from/to の両方を一つの query で対象にし、ページング・月・種別・カテゴリと組み合わせても重複を出しません。振替は収入・支出の全 totals から除外します。

登録・編集・削除は Server Actions だけで行います。Client Component の統合フォームは React 19 `useActionState`/`useFormStatus` で支出・収入・振替を切り替え、同じ厳格な金額形式を含む Zod schema を Server Action でも必ず再検証します。通常取引の口座は利用中の候補だけを表示し、利用終了の口座を参照する編集画面ではその口座を「利用終了」と表示して保持します。新規・編集で振替を選んだ場合、振替元・振替先の候補は初期状態では利用中の口座だけに絞り、「利用終了の口座も表示」をオンにすると利用終了の口座も「利用終了」と表示して選択できます。すでに選択中の利用終了の振替端点はトグルがオフでも保持します。口座による絞り込みの一覧では利用終了の口座も「利用終了」と表示します。保存時に種別を変更した場合、`convertTransactionToTransfer` または `convertTransferToTransaction` が一つの DB transaction 内で新しい行を作成して元行を削除します。成功時は対象月へ redirect し、`/`、`/transactions`、`/balances` を `revalidatePath` して読み取りを新しくします。振替の DB mutation は household と両口座を明示的に照合し、別家計の口座や同一口座を拒否します。削除は `<details>` の確認開示と `confirm=delete` の hidden field を持つ専用フォームで、確認値なしでは削除せず、JavaScript 無効でも 2 回目の送信だけが実行されます。削除後に削除 URL へ戻りません。

- 口座管理は `/accounts` と Server Action で行い、標準グループ、カスタムグループ、口座の並び順・種類・利用状態を管理します。種類を変更すると口座残高の解釈が変わる場合があるため明示確認を求め、取引や振替などの既存行は書き換えません。参照のある口座は削除せず理由を表示します。
- `getAccountBalances` は全期間の取引から口座ごとの計算上の残高を `income - expense - transfersOut + transfersIn` で計算し、未来日付の取引も含めます。初期残高は持たず、口座を持たない手入力の取引を除外します。現金・銀行・電子マネーは計算上の残高を資産として表示し、クレジットカードは計算上の残高の符号を反転して負債として表示します。カードの過払い（計算上の残高 > 0）は明示し、集計の純資産は常に計算上の残高の総和です。

表示側は符号付き金額を種別ごとに SQL 合計し、収支差額を `income - expense` として `BigInt` で計算します。取引行では 0 を `0円`、支出の負数を返金・訂正として `＋`、収入の負数を `−` で表示します。カテゴリ別支出の構成比は支出合計が 0 以下またはカテゴリ合計が負なら `—`、カテゴリ合計が 0 なら `0%` とし、バー幅は非正の値で 0 です。

日付欄は表示用 button と送信用 native date input の二重構造を持ちますが、overlay input に `tabIndex=-1` を設定して Tab stop を 1 つにします。表示 button はラベル、フォーカスリングを持ち、mouse/touch と Enter/Space の keyboard 操作から native picker を開きます。

## UI レイアウト規則

画面の順序、見出しレベル、リンクの役割、共通コンポーネント、余白・行間トークンは [UI レイアウト規則](ui.md) にまとめます。

## インポート・ファイル読み込み

「らくな家計簿」（Realbyte Money Manager）Android 版の Excel エクスポートからインポートできます。Web の `/transactions/import` では、ファイルを選択してプレビューを確認し、同じファイルをもう一度送信して確定します。JavaScript が無効でも同じフォームを二回送信できます。

`@kobako/db` では、入力の正規化、XLSX の解析、データベース操作を分離しています。

- `packages/db/src/money-manager-format.ts` はセル値の検証と金額・日付・カテゴリの正規化を担当します。データベースには接続しない純粋な関数です。
- `packages/db/src/money-manager-xlsx.ts` は OOXML と ZIP を解析します。yauzl でエントリを必要な時に読み込み、saxes で XML を解析し、数式セル、DTD、外部実体を拒否します。`MONEY_MANAGER_XLSX_LIMITS` で ZIP のエントリ数を 128、エントリごとの未圧縮サイズを 8 MiB、全体の未圧縮サイズを 32 MiB、共有文字列を 100,000 件かつ 8 MiB までに制限します。ワークシートの取引行は読み込み時に 10,000 行まで、金額・日付シリアルの数値表記は 64 文字までです。共有文字列の参照先が不正な場合はファイルエラーにします。
- `packages/db/src/imports.ts` はデータベース操作を担当します。`findMoneyManagerImport()` で重複を確認し、`commitMoneyManagerImport()` で一つのトランザクションとして確定します。家計を `SELECT FOR UPDATE` でロックし、カテゴリの並び順を 10 刻みで割り当てる処理もロック内で行います。
- `packages/db/src/money-manager.ts` はインポート関連の公開サブパスを再エクスポートします。

`apps/web/next.config.ts` では Server Action のリクエスト本文の上限を 6 MB に設定し、5 MiB のファイルと multipart の付加分を受け付けます。`yauzl` と `saxes` は Node.js サーバーの外部パッケージとして扱います。

プレビューでは `moneyManagerImportAction` が `intent=preview` のファイルを受け取り、元のバイト列から SHA-256 ハッシュを計算して `parseMoneyManagerXlsx()` で正規化します。`findMoneyManagerImport()` によって同じ家計、提供元、ハッシュの記録を確認し、`money-manager-import-contract.ts` のシリアライズ可能な型で、ファイル名・サイズ・期間・収入/支出/振替の件数と合計・新規カテゴリ・新規口座・口座ごとの取り込み先候補・上限付きサンプル・ファイルエラー・行エラーを返します。既存記録は `alreadyImported` と前回日時で表し、ハッシュの詳細を UI に要求しません。

取り込み元に安定した口座 ID があればそれを、なければ口座名を対応付けの識別子とします。未対応付け口座は既存名でも自動統合せず、各行で「新規作成」を既定にして既存口座（利用終了は表示付き）を選べます。同名の別口座を選択した場合も口座名や種類などの口座情報は上書きしません。既存の対応付けは次回以降静かに再利用します。

確認では同じフォームから選択中のファイルをもう一度送信します。サーバーアクションはファイルを読み直して上限を検証し、ハッシュと内容を比較してから `commitMoneyManagerImport()` を呼びます。問題がなければ家計のロック、インポート記録、カテゴリ・口座の作成または選択済み口座の再利用、収入/支出と振替の追加を一つのトランザクションで行います。振替行は「引き出し」を振替元 B「資産」、振替先 C「分類」、金額 F として保存します。J は JPY の確認に使い、保存しません。I/K も保存しません。手数料は推測しません。完了画面の一覧リンクは、取り込んだ期間の最新月を開きます。

対応する形式は Android 版だけです。先頭 11 列は日付、資産、分類、小分類、内容、JPY、収入/支出、メモ、金額、通貨、資産の順で、日付は 1900 年方式の Excel シリアル値、金額は `/^-?\d+(?:\.0+)?$/` に一致する整数または `.0` で終わる値だけを受け付けます。通貨は行ごとに JPY を確認します。通常行の B は口座名、振替行の B/C は元先口座名です。空の口座名、同一の元先口座、未知の種別、日付・金額不正は行エラーにし、未知だが空でない口座名はプレビューで選択を求め、確定時に既定では新規口座を作成します。

`transaction_imports` にはファイル本体ではなく、ハッシュ、元ファイル名、提供元、全件数、種別ごとの件数、作成日時だけを保存します。SHA-256 は 64 文字の小文字 16 進数として CHECK で検証します。ZIP の過剰な展開は yauzl のサイズ検証で防ぎ、saxes は DOCTYPE を拒否します。数式セルも行エラーとして扱います。パーサーはサーバー側だけで動作し、ファイル本体をディスクへ書き込みません。

## 実行モデル

Next.js は `output: 'standalone'` で build し、Docker では non-root の `node` user で起動します。Compose では PostgreSQL が healthy になってから `web` を起動し、web image に同梱した migration（schema + 初期データ）を Next.js の起動前に適用します。`worker` は `web` の health check 後に起動するため、通常構成に終了済みのワンショット `migrate` サービスはありません。PostgreSQL の health check は接続可能になるまでを、web の entrypoint は migration の成否をそれぞれ担当します。

migration 中に受け取った `SIGTERM`/`SIGINT` は、Compose の `init: true` でも `--init` なしの `docker run` でも entrypoint から migrator に転送され、Next.js を起動せずに非ゼロで終了します。

Drizzle の postgres-js migrator は migration SQL と journal の記録を一つの transaction で実行します（schema と migration table の準備はその前です）。そのため migration が失敗すると、その migration の SQL と記録はまとめて rollback されます。

worker は busy loop やダミー job を持ちません。DB check が成功した後、signal を解決条件とする promise を待ちます。`SIGTERM`/`SIGINT` で DB client を閉じ、正常終了します。
