# アーキテクチャ

## 境界

kobako は pnpm workspace の modular monolith として始めます。

- `apps/web`: Next.js App Router。家計簿の表示・フォーム・Server Actions と health endpoint を提供します。
- `apps/worker`: 将来の非同期処理のプロセス境界。現段階では起動時の DB check 後に待機し、job 実装は持ちません。
- `packages/db`: PostgreSQL 接続、Drizzle schema、migration、家計簿 query、入力 validation、環境変数検証を提供します。

依存方向は apps → packages です。package から app へ依存しません。ブラウザに DB 接続や秘密情報が入らないよう、`@kobako/db` の client/query は Server Component と Server Action から利用し、Client Component は validation のサブパスだけを import します。

## 家計簿ドメイン

認証導入前の ownership boundary として `households` を一つ持ちます。固定 UUID のローカル家計（slug `local`）を migration 後の idempotent initialization で作成し、ユーザー・session・member・invitation はまだ持ちません。将来は認証側からこの household にユーザーを関連付けますが、取引テーブルを作り直さずに済む境界です。

`@kobako/db` の `ledger.ts` は household を暗黙に固定しません。`listCategories`・`getCategory`・`listTransactions`・`getTransaction`・`getMonthlyTotals`・`getExpenseCategoryTotals`・`createTransaction`・`updateTransaction`・`deleteTransaction` はすべて `householdId` を最初の明示引数として受け取ります。`DEFAULT_HOUSEHOLD_ID`/`DEFAULT_HOUSEHOLD_SLUG` は `initializeDefaultLedger` の seed データ専用の定数として残し、query/mutation 本体からは参照しません。Web 側は `apps/web/src/lib/ledger-data.ts` の `getCurrentHouseholdId()` 一箇所だけで対象 household を解決し、すべての Server Component/Server Action がそこを経由します。将来の認証実装は、この一箇所をセッションから household を導出する実装に差し替えるだけで済みます。

```text
households (1) ──< categories
     │                │
     └──────────────< transactions >── (category, type, household)
```

- `categories`: `household_id`、`type`（`expense`/`income`）、表示名、並び順。`(household_id, type, name)` を一意にし、初期カテゴリを支出 9 種・収入 3 種登録します。
- `transactions`: `household_id`、`type`、JPY の ASCII 整数 `amount`（`-999,999,999`〜`999,999,999`、0/負数を含む）、カレンダー日付 `occurred_on`、`category_id`、空文字を許容する `memo`、作成・更新時刻を持ちます。`household_id` の FK に加えて `(category_id, household_id, type)` の複合 FK を categories の一意キーへ張り、別家計カテゴリや種別違いカテゴリを DB で拒否します。金額 CHECK は `packages/db/drizzle/0002_bitter_stryfe.sql` で旧 positive-only 制約から `transactions_amount_limit_check` へ置き換えました。
- 全ての Web query は呼び出し元が渡す household を条件に含めます（現状は常に `getCurrentHouseholdId()` の値）。月次範囲は `YYYY-MM-01` 以上、翌月 1 日未満の half-open range です。
- 月・日付が扱う年は 1900〜9998 年（`packages/db/src/month.ts` の `MIN_SUPPORTED_YEAR`/`MAX_SUPPORTED_YEAR`）に制限します。PostgreSQL `date`/`YYYY-MM` 自体はこれより広い範囲を扱えますが、`0000-01` のような極端な値が migration 未対応のクライアント入力や URL 改ざんから届いても 500 にならないよう、`isValidMonth`/`isCalendarDate`/`parseMonth`/`shiftMonth` すべてでこの範囲を検証・フォールバックします。

初期データは `packages/db/src/ledger.ts` の `initializeDefaultLedger` が `ON CONFLICT DO NOTHING` で登録します。`runMigrations` が Drizzle migration の後に呼び出すため、空 DB と再実行の両方で同じ結果になります。

## データベース

接続には `postgres`（postgres.js）と Drizzle ORM を使います。`system_healthchecks` は migration と読み書きの疎通確認を保つための domain-neutral なテーブルです。家計簿 query は `@kobako/db` の `ledger.ts` に集約し、Web から全行をクライアントへロードしません。月次合計・カテゴリ別合計は SQL で集計し、PostgreSQL の `bigint` 結果を文字列で受け、差額も `BigInt` で計算します。

DB URL の検証は `@kobako/db` の関数を呼び出した時にだけ行います。そのため Next.js build は runtime credentials を必要としません。health endpoint は成功時・失敗時とも `{status: ...}` だけを返し、サーバーログも URL の credential/query を redaction します。

## 表示と mutation

概要と一覧は Server Component で URL query (`month`、`type`、`category`) を読み、DB へ条件を渡します。不正な `month` は Asia/Tokyo の現在月へフォールバックし、未来月は空のまま表示します。

登録・編集・削除は Server Actions だけで行います。Client Component のフォームは React 19 `useActionState`/`useFormStatus` で pending とフィールドエラーを表示しますが、同じ厳格な金額形式を含む Zod schema を Server Action でも必ず再検証します。成功時は対象月へ redirect し、`/` と `/transactions` を `revalidatePath` して読み取りを新しくします。削除は `<details>` の確認開示と `confirm=delete` の hidden field を持つ専用フォームで、確認値なしでは削除せず、JavaScript 無効でも 2 回目の送信だけが実行されます。削除後に削除 URL へ戻りません。
表示側は signed amount を種別ごとに SQL 合計し、収支差額を `income - expense` として `BigInt` で計算します。取引行では 0 を `0円`、支出の負数を返金・訂正として `＋`、収入の負数を `−` で表示します。カテゴリ別支出の構成比は支出合計が 0 以下またはカテゴリ合計が負なら `—`、カテゴリ合計が 0 なら `0%` とし、バー幅は非正の値で 0 です。

日付欄は表示用 button と送信用 native date input の二重構造を持ちますが、overlay input に `tabIndex=-1` を設定して Tab stop を 1 つにします。表示 button はラベル、フォーカスリングを持ち、mouse/touch と Enter/Space の keyboard 操作から native picker を開きます。

## 実行モデル

Next.js は `output: 'standalone'` で build し、Docker では non-root の `node` user で起動します。Compose では PostgreSQL healthy → migration completed（schema + 初期データ）→ web/worker の順に依存させます。

worker は busy loop やダミー job を持ちません。DB check が成功した後、signal を解決条件とする promise を待ちます。`SIGTERM`/`SIGINT` で DB client を閉じ、正常終了します。
