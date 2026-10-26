# 外部エージェント向け API v1

外部プログラムから取引と振替を読み書きするための API です。エンドポイントは `/api/v1/**` にあります。

## 認証

すべてのエンドポイントで、次のヘッダーを送ります。

```http
Authorization: Bearer <KOBAKO_API_TOKEN>
```

`KOBAKO_API_TOKEN` が未設定または空の場合は、HTTP 503 と `api_disabled` を返します。`DEMO_MODE=1` の配備では、トークンを設定していても常に同じ応答になります。トークンが未指定、または一致しない場合は HTTP 401 と `unauthorized` を返します。エラーは次の形です。

```json
{ "error": { "code": "api_disabled", "message": "この API は無効です。" } }
```

## エンドポイント

| メソッド | パス                       | 内容                                               |
| -------- | -------------------------- | -------------------------------------------------- |
| GET      | `/api/v1`                  | 利用可能なリソースと API の注意事項                |
| GET      | `/api/v1/accounts`         | 削除されていない資産の一覧（`id`、`name`、`kind`） |
| GET      | `/api/v1/categories`       | カテゴリ一覧（`id`、`name`、`type`）               |
| GET      | `/api/v1/transactions`     | 取引・振替の一覧                                   |
| POST     | `/api/v1/transactions`     | 取引・振替の一括登録                               |
| PATCH    | `/api/v1/transactions/:id` | 取引の部分更新                                     |
| DELETE   | `/api/v1/transactions/:id` | 取引の削除（204）                                  |
| GET      | `/api/v1/transfers`        | 振替の一覧                                         |
| POST     | `/api/v1/transfers`        | 振替の一括登録                                     |
| PATCH    | `/api/v1/transfers/:id`    | 振替の部分更新                                     |
| DELETE   | `/api/v1/transfers/:id`    | 振替の削除（204）                                  |

一覧のレスポンスは `{ "items": [...], "count": ... }` です。取引の項目には `id`、`type`、`amount`、`occurredOn`、`categoryId`、`categoryName`、`accountId`、`accountName`、`memo`、`origin` が含まれます。振替の項目には `id`、`type`（`transfer`）、`amount`、`occurredOn`、`fromAccountId`、`fromAccountName`、`toAccountId`、`toAccountName`、`memo`、`origin` が含まれます。

## 一覧のクエリ

`GET /api/v1/transactions` は次のクエリを受け付けます。`GET /api/v1/transfers` は `month` と `origin` だけを受け付け、常に振替を返します。

| クエリ                             | 内容とデフォルト                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `month=YYYY-MM` または `month=all` | 省略時は Asia/Tokyo の現在月。`YYYY-MM` は 1900〜9998 年の有効な月だけを指定できます。`all` は全期間です。 |
| `type=expense\|income\|transfer`   | 取引の種別。省略時は種別で絞りません。`transfer` のときは振替だけを返し、`category` は適用されません。     |
| `category=<id>`                    | カテゴリ ID による絞り込み。省略時は絞り込みません。                                                       |
| `account=<id>`                     | 資産 ID による絞り込み。通常取引はその資産、振替は元または先の資産が対象です。                             |
| `origin=api`                       | API で登録した行だけに絞り込みます。省略時はすべての登録元が対象です。                                     |
| `limit=<整数>`                     | 先頭から返す件数。省略時は上限なし。指定時は 1〜2,147,483,647 です。`count` は limit 適用前の件数です。    |

`type`、`month`、ID、`limit` が不正な場合は HTTP 400 です。取引一覧は日付の降順で返ります。

## 登録

リクエスト本文は JSON です。`POST /api/v1/transactions` は `transactions` と `transfers` の少なくとも一方に1件以上を含めます。`POST /api/v1/transfers` は `transfers` を必須とし、1回の配列につき最大500行です。`/transactions` の `transactions` 配列と `transfers` 配列も、それぞれ最大500行です。

カテゴリと資産は ID ではなく名前で指定します。名前は登録済みのものと照合されます。

### 取引の行

`transactions` の各行で指定できるフィールドは次のとおりです。

- `type`: `expense` または `income`
- `amount`: 整数の金額（`-999999999`〜`999999999`）
- `occurredOn`: `YYYY-MM-DD`（年は1900〜9998）
- `category`: カテゴリ名
- `account`: 資産名（省略可。未指定の取引にできます）
- `memo`: メモ（省略可）
- `externalId`: 外部側の識別子（省略可、最大200文字）

### 振替の行

`transfers` の各行で指定できるフィールドは次のとおりです。

- `amount`: 正の整数の金額（1円以上、上限999999999円）
- `occurredOn`: `YYYY-MM-DD`（年は1900〜9998）
- `from`: 振替元の資産名
- `to`: 振替先の資産名（`from` と同じ資産は指定できません）
- `memo`: メモ（省略可）
- `externalId`: 外部側の識別子（省略可、最大200文字）

本文には共通で `label`（省略可、最大120文字）を指定できます。登録例です。

```http
POST /api/v1/transactions?dry_run=1
Authorization: Bearer <KOBAKO_API_TOKEN>
Content-Type: application/json
Idempotency-Key: agent-run-2026-10-26

{
  "transactions": [
    {
      "type": "expense",
      "amount": 1200,
      "occurredOn": "2026-10-26",
      "category": "食費",
      "account": "現金",
      "memo": "昼食",
      "externalId": "lunch-2026-10-26"
    }
  ]
}
```

`dry_run=1` では書き込みを行わず、作成予定の行は `would_create` として返します。`Idempotency-Key` を付けた通常の登録は同じキー（同じ家計内）で再送すると `replayed` になり、同じバッチを再作成しません。`externalId` が既存行と重複した場合もエラーではなく `skipped` になります。

`externalId` を省略した行は、指紋を `externalId` の代わりに使って重複排除します。同じ内容を再送すると `skipped` になります。同一リクエスト内の同じ内容の行は、出現順のサフィックスを付けて別行として扱います。取引の指紋は種別・日付・金額・カテゴリ・資産・メモから、振替の指紋は日付・金額・振替元・振替先・メモから生成されます。

登録結果には `created`、`skipped`、`errors`、`rows` が含まれます。少なくとも1行を書き込めた場合は HTTP 201、dry run または書き込みがない場合は HTTP 200 です。書き込める行が1つもなくエラーだけの場合は HTTP 400（`rows_rejected`）です。

## 更新と削除

更新本文は部分更新です。省略したフィールドは既存値を保持します。

- `PATCH /api/v1/transactions/:id`: `type`、`amount`、`occurredOn`、`category`、`account`、`memo`。`account: null` で資産を外します。
- `PATCH /api/v1/transfers/:id`: `amount`、`occurredOn`、`from`、`to`、`memo`。`from` と `to` は資産名で指定します。
- `DELETE` は成功時に本文なしの HTTP 204 を返します。

更新時のカテゴリ・資産も登録済みの名前で指定してください。存在しない名前、存在しない ID、振替元と振替先が同じ場合はエラーになります。
