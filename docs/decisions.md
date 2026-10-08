# 技術的判断

## Stack versions

Node.js 24.21.0（`.node-version`）と pnpm 12.6.0 を固定します。TypeScript は 6.0.3 を採用しました。`typescript-eslint` 8.70.1 の peer range が TypeScript 6.1 未満であるため、TypeScript 7 は peer range が対応するまで保留します。Next.js 16.3.6、React 19.3.0、Drizzle ORM 0.45.3、Drizzle Kit 0.31.11、Zod 4.6.5、Vitest 5.0.2、Playwright 1.63.0 を lockfile で固定しています。

PostgreSQL の Compose image は `postgres:18.6-alpine3.24`、Node image は `node:24.21.0-bookworm-slim` とし、`latest` は使いません。

## postgres.js over pg

接続 client は postgres.js を選びました。単純な query/migration と少数 worker 接続に必要な API が小さく、Drizzle の postgres-js adapter と組み合わせられます。health query には接続 timeout と query の短い上限を設けます。

## 家計簿の所有境界

認証導入前でも取引を将来のユーザーへ安全に紐付けられるよう、`households` を明示的な所有境界として先に導入します。固定 well-known UUID と slug `local` の一つだけを idempotent に初期化し、users、sessions、members、invitations、家計切り替え UI は追加しません。将来の認証は household への関連を追加するだけにします。

`@kobako/db` の query/mutation 関数（`listCategories`、`getCategory`、`listTransactions`、`getTransaction`、`getMonthlyTotals`、`getExpenseCategoryTotals`、`createTransaction`、`updateTransaction`、`deleteTransaction`）は `householdId` を明示引数として要求し、内部で `DEFAULT_HOUSEHOLD_ID` を決め打ちしません。共有 package を「単一家計専用」に固定してしまうと、認証導入時に package 内部の書き換えが必要になるためです。household の解決は `apps/web/src/lib/ledger-data.ts` の `getCurrentHouseholdId()` という一箇所だけに閉じ込め、Web 側のすべての Server Component/Server Action がそこを経由します。将来の認証は、この関数の実装をセッションからの導出に差し替えるだけで済みます。

## 金額と日付の型

金額は JPY の `integer` とし、`-999,999,999`〜`999,999,999` 円（0 を含む）に制約します。この上限なら PostgreSQL `int4` に収まり、画面入力の小数・浮動小数点誤差を排除できます。負数は返金・訂正などの符号付き取引に使います。入力の完成形は共有する ASCII パターン（区切りなしの整数、または `1,200` のような 3 桁区切り、先頭の `-` は 1 個）だけとし、全角文字、通貨記号、空白、小数、指数表記、崩れた桁区切り、途中や複数の `-` は拒否します。クライアントは不正文字を別の値へ除去せず元の値を保ち、Server Action は同じ文字列を schema で再検証します。sum は PostgreSQL で `bigint` になるため、query は文字列へ cast し、差額は JavaScript の `BigInt` で算術を行います。

台帳日付は PostgreSQL `date` と Drizzle の `{ mode: 'string' }` を使い、`YYYY-MM-DD` を文字列のまま処理します。`Date` へ変換して UTC/JST で日付がずれることを避けます。新規登録の初期値は、`?month=` が今月なら `Intl.DateTimeFormat` の `Asia/Tokyo` で求めた今日、それ以外の対象月なら `{month}-01` です。

日付・月が扱う年は 1900〜9998 年に制限します（`packages/db/src/month.ts` の `MIN_SUPPORTED_YEAR`/`MAX_SUPPORTED_YEAR`）。PostgreSQL `date` 自体はこれより広い範囲（紀元前後〜西暦 5874897 年）を扱えますが、`0000-01` のような極端な年が URL 改ざんや壊れたクライアントから届いた場合に PostgreSQL がエラーを返し 500 になることを避けるため、アプリケーション層で安全な範囲へあらかじめ制限し、日本語エラーメッセージで拒否します。`isValidMonth`/`isCalendarDate`/`parseMonth`/`shiftMonth` すべてがこの範囲を守ります。

## カテゴリ整合性

支出カテゴリと収入カテゴリの `type`（支出/収入）と household 所有を UI だけに任せず、`transactions(category_id, household_id, type)` から `categories(id, household_id, type)` への複合 FK で DB に強制します。categories 側には複合 FK 用の一意キーを置き、transaction amount、参照、memo 長も not-null/FK/CHECK/varchar で検証します。

## Mutation と再検証

Mutation 機構は Next.js Server Actions に統一します。登録・編集フォームは React 19 の `useActionState` でサーバーから返した入力値と日本語フィールドエラーを表示し、フォーム送信時はクライアント側でも同じ Zod schema を検証しますが（`event.preventDefault()` で不正な送信そのものを止めます）、Server Action は必ず同じ schema と DB 上のカテゴリ照合で再検証します。成功時は対象月の一覧へ redirect し、`revalidatePath` を呼びます。削除は `<details>` の確認開示を使い、`confirm=delete` を含む送信だけを受け付けます。確認値がない直接送信は削除せず、JavaScript 無効でも 2 回目の送信で確定できます。`deleteTransaction` は対象行を `SELECT FOR UPDATE` でカード請求ロックと同じ transaction に保持してから `DELETE ... RETURNING occurred_on` を実行し、行が返らなければ `notFound()` を呼びます。削除後は対象月一覧へ redirect して削除済み URL には戻りません。Route Handler、optimistic update、追加キャッシュは使いません。

## 入力拒否とフォーカス可能な日付欄

不正な金額のキー入力・貼り付けは、別の数値へ変換せず元の値を保持して小さな `role="alert"` を再マウントします。見た目の date button と送信用 native input は、後者を `tabIndex=-1` にして Tab stop を一つにし、button のラベルと focus ring を維持します。mouse/touch と keyboard の picker 起動は native date input に委譲します。

## server-only パッケージ

`server-only` パッケージは依存に追加していません。DB client と household 解決は `apps/web/src/lib/ledger-data.ts` に置き、`apps/web/app/transactions/import/actions.ts` は `'use server'` で XLSX 解析と DB 操作を実行します。`import-form.tsx` は Server Action の参照と型だけを持ち、`state.ts` は型 import だけです。`page.tsx` は Server Component です。

## Worker

worker は起動時 DB check 後に期限日までのカード自動決済を catch-up し、一定間隔の tick で期限到来分と blocked run を再試行します。worker 停止中の期限日も復帰後に処理し、`SIGTERM`/`SIGINT` では tick を停止して DB client を閉じ、正常終了します。

## Integration test の DB 安全性

integration test は `TEST_DATABASE_URL` を必須とし、`NODE_ENV=production` または非 loopback host を拒否します。対象 database name は `test`/`tests` token を含む test-designated 名に限定し、`DATABASE_URL` とは host alias（`localhost`/`127.0.0.1`/`::1`）、既定 port 5432、database name を正規化した identity が一致しないことを確認します。schema の drop と各テストの truncate の直前には test 接続で `current_database()` と PostgreSQL system identifier を取得します。`DATABASE_URL` が設定されている場合は接続・identity query も成功しなければならず、到達不能、query failure、permission denied、identity 欠落など検証不能な状態では generic error で fail closed します。正常に検証できた場合だけ同じ `(system_identifier, current_database())` でないことを確認します。これにより beforeEach の reset は test DB identity が確認された後だけ実行されます。`pg_control_system()` の system identifier query は実行権限を要求し、環境によって superuser/`pg_monitor` 相当が必要です。PostgreSQL 18 の検証 image では非 superuser role の query を確認し、権限を revoke した場合は `could not verify DATABASE_URL database identity` で fail closed します。

## E2E データベースの安全性

`apps/web/e2e/ledger.spec.ts` は schema/table を truncate しません。各実行で UUID から `e2e:<UUID>:<test>` の marker を生成し、9000〜9997 年の run-specific な候補月と翌月が default household 内で空であることを DB で確認してから、画面操作の日付に使います。候補が埋まっている場合は既存行を削除せず別候補を探し、空きがなければ失敗します。E2E は `TEST_DATABASE_URL` に専用の test DB を指定し、起動時と後処理 DELETE の直前に `assertSafeTestDatabaseTarget` と `verifySafeTestDatabaseConnection` を通します。後処理の DELETE は default household・同じ遠未来範囲・現在 run の marker prefix に限定し、guard が成功しない場合は実行しません。クラッシュした別 run の残骸や同じ年の利用者データを年だけで削除しません。

## Renovate

Dependabot と Renovate の二重運用は避け、Renovate を採用します。pnpm lockfile、workspace、GitHub Actions、Docker base image を更新対象にし、dependency dashboard と grouping は設定しますが、自動 merge は行いません。
Dependabot の security update が npm ecosystem の workspace root (`/`) を対象とするよう `.github/dependabot.yml` で設定します。`open-pull-requests-limit: 0` で version update を無効化し、通常の dependency version update は引き続き Renovate が担当します。Dependabot が生成する security PR への実際の効果は未検証で、実際の bot PR はまだ観測していません。デプロイ済み Dependabot の pnpm 12.6.0 対応も未確認です。

## Shared packages

validation、calendar helper、家計簿 schema/query は Web の Server Component/Action と integration test が実際に共有するため `@kobako/db` に置きます。ブラウザ用フォームは DB client を import せず、validation サブパスだけを import します。空の抽象 package は増やしません。

## Release version source

Release Please は root `.` の単一 version として扱います。root `package.json` を正 canonical version とし、`.release-please-manifest.json`、apps/web、apps/worker、packages/db の version を同じ version に保ちます。pnpm lockfile は workspace package の version を記録しないため、version bump による lockfile 更新は行いません。`CHANGELOG.md` と manifest は Release Please の生成物として Prettier から除外し、quality gate の validator で構文と整合性を確認します。generic extra-file を追加する場合も、その marker を validator で検証します。`latest` は main の最新成功 build の試用用とし、正式版を追跡する利用側は完全な SemVer を使います。`v0.1.0` は quality gate 失敗前に作成された履歴なので再利用せず、次の正常な候補は `v0.1.1` です。

## Release automation

Release PR の自動 merge は title/branch名だけを信頼せず、同一 repository、bot author、`main` base、exact Release Please branch、`autorelease: pending`、open/non-draft、head SHA、main tip/base/sole-parentをRESTで確認します。Release Please v17.6.0 は既存PRのbodyが変わらない main pushではbranchをforce-updateしないため、headのsole parentがlive mainでない場合はAPIが返すverified merge-baseがlive mainの祖先であること、merge-baseからheadまでがRelease Please allowlistだけであることを確認してstale baseを許可します。repository rulesetはbranchを最新にするstrict status checkを要求しません。変更範囲は trusted な main checkout の `release-please-config.json` から導出した Release Please allowlistだけに限定し、JSON version file、manifest、CHANGELOGの形式を検証します。committerは GitHub APIの署名検証が `verified=true`・`reason=valid` の `web-flow` Userだけを許可します。required status checksはhead SHAの最新recordをnameごとに選び、GitHub Actions app `15368` / `github-actions` の `completed/success`だけを受け付けます。
committer の provenance は REST commit 応答の top-level `committer.login=web-flow`・`id=19864447`・`type=User`、nested `commit.committer.name=GitHub`・`email=noreply@github.com`、sibling `commit.verification.verified=true`・`reason=valid` を全て完全一致で検証します。欠落、型違い、name/emailだけの一致、substring、署名検証の省略は許可しません。

GITHUB_TOKENで作成・更新したPRはnative `pull_request` workflowが承認待ちになるため、main pushのRelease Pleaseはrepository-scoped GitHub App tokenを使います。Release Please job自身の `GITHUB_TOKEN` は `contents: read`、`actions: read`、`pull-requests: read` に絞り、pre-checkのmerged PR・Actions run・tag/Release readに使います。App tokenはRelease PR作成/更新のwriteにだけ渡します。evaluatorのAPI readは Actions / Checks / Contents / Pull requests readを持つjob `GITHUB_TOKEN`で行い、App tokenは Contents / Pull requests writeだけを持つmerge `PUT`に限定します。release_finalizeの `GITHUB_TOKEN` は `contents: write`、`issues: write`、`pull-requests: write`だけを持ち、tag/Release作成と検証済みPR label repairに使います。Appは `takano536/kobako` のみにinstallし、Release Please jobのAppだけが Issues RW label permissionを使います。未設定・403はGITHUB_TOKENへfallbackせずfail closedします。
`release_please` pre-check は M の push CI run と `release_finalize` jobを bounded lookupします。activeな別runにterminal finalizer jobがなければ後続NのRelease Pleaseだけを `deferred` としてskipし、M自身のcurrent runはpending labelをbounded retryで再取得してclear/staleを決めます。completed runにjobが見えない `unknown` とfinalize済みpendingの `stale` はfail closedし、`publish_main` のordinary image公開を許可しません。
pre-checkのmerged PR scanはRelease Please v17.6.0の `pullRequestIterator(main, 'MERGED', 200, false)` と同じREST `pulls` の `updated desc` 順で最初の200件のmerged結果を対象にします。200件到達をpagination exhaustionとして扱わないのは、Release Please本体のscan windowと同じ範囲を保ち、repoの履歴増加でpre-checkだけが停止しないようにするためです。

`release-automerge.yml` はCIの `workflow_run` completed eventでtrusted main validatorを実行します。PR headをcheckoutせず、event/conclusion、同一repository、exact branch、current head、base、label、provenance、6 native checksを確認してからApp tokenで `sha=H` squash mergeします。concurrencyは `workflow_run.id` ごとの non-cancellable groupでイベントを捨てず、sha-pinned mergeとidempotency guardで重複を安全に停止します。PR CI完了イベントだけでなくmain push CI完了イベントでもlive mainのcanonical open Release PRを再取得し、push CIの `release-please` job成功と現在のPR head native checksを確認します。cron、manual dispatch、release-verify refはありません。
evaluatorはPR CI完了側とmain push完了側のどちらからでもcanonical open Release PRを評価します。相手側のCIが `queued` / `in_progress` またはまだAPIに現れていない場合は、古いsnapshotをmergeせず `deferred=true` で成功終了し、相手側の完了イベントに再評価を任せます。live main移動や安全な405/409 conflictは最大3回、main・PR・workflow run・checks・file validationを取り直して再評価し、試行上限後も安全なdeferになります。

App tokenのmergeはmain push CIを実際のsquash SHA `M`で起動します。push runは `github.sha` ごとのconcurrency groupで後続pushにpending置換されず、`commits/M/pulls` の `merge_commit_sha == M`、`merged_by`、canonical metadata/provenance、main ancestry、sole parentを検証します。canonical releaseならRelease Pleaseが `M == GITHUB_SHA` のtag/Releaseを作成し、target検証後に同じcanonical merged PRの `autorelease: tagged` を付与して `autorelease: pending` を削除します。既にtaggedならno-opです。`publish_release`だけがweb/migrateのversionedと`sha-M` imagesを公開します。通常のmain pushは`publish_main`だけがsha imageとlatestを公開し、latestはlive main tip確認後だけpromoteします。

Release objectは `draft=false`、`prerelease=false`、strict `tag_name`、`target_commitish` が40桁SHAで `M` と完全一致することを要求します。既存tag、Release、imageが別revisionやpartialの場合は上書きせず停止します。image publishやquality gate failureは同じ `M` のpush runのfailed jobsだけを再実行し、別commitへversion tagを移しません。release_finalizeはimmutable target probeで既存matching tag/Releaseを再利用します。
Release Please v17.6.0の [`src/manifest.ts#L890-L897`](https://github.com/googleapis/release-please/blob/v17.6.0/src/manifest.ts#L890-L897) `manifest.createPullRequests` は、mergedかつ `autorelease: pending` のRelease PRを検出すると `There are untagged, merged release PRs outstanding - aborting` として次のPR作成を中止します。`release_please` はこの状態をAPIで先に検出して通常のno-changeと区別してfailし、canonical releaseのtag/Release finalize成功後は同じpush runのGITHUB_TOKENで検証済みcanonical PRのpending→tagged repairを先に冪等実行してからApp-token Release Please step（`skip-github-release: true`）をlive mainに対して実行します。tag/Release finalizeの作成stepがコメント投稿後に失敗しても、immutable targetがMに一致する場合だけ検証を通し、missing / partial / mismatch は停止します。tag/Release finalize側の [`manifest.createReleases`](https://github.com/googleapis/release-please/blob/v17.6.0/src/manifest.ts) はmerged release candidateの `release.sha` を [`github-api.ts`](https://github.com/googleapis/release-please/blob/v17.6.0/src/github-api.ts) のtag SHAと `target_commitish`に渡すため、live mainがMより先へ進んでもtagはM固定です。Release candidate associationが一時的に空でも、Mのparentとの差分がmanifestまたはrelease-owned version pathを含む場合は数回再取得してfail closedし、ordinary publishへ分類しません。

`classify-main-release` はMの各parentに対してmanifestの `.` とconfigured JSON extra-fileの `$.version` を含む各package JSONのversion値だけを比較します。CHANGELOG.mdやpackage.jsonのdependencyなどversion値以外だけを変更したhuman/non-canonical PRはordinaryとして扱い、巨大なordinary diffでもcompare APIのファイル上限で失敗しません。対象fileがparentまたはmerge commitで欠落した場合は変更扱いにしてfail closedします。canonical release mergeの厳密なallowlist検証だけは従来どおり完全なcompare file listを使います。human/non-canonical PRがversion値を変更した場合はordinaryへ分類せず、関連PRが見えていればcanonical author不一致の `no canonical merged Release PR ...`、association indexingが空の場合はbounded retry後の `release-owned version files changed ...` で停止します。

この provenance/file checkは意図しない変更やRelease Please生成物からの逸脱を検出する guardであり、悪意あるwrite-access collaboratorへの防御ではありません。repository write accessがtrust boundaryであり、release branchをbot/限定maintainerだけに更新させるrulesetはoptional hardeningです。

## Next.js generated guidance

Next.js 16 の `next dev` が生成する `apps/web/AGENTS.md` と `apps/web/CLAUDE.md` は、ファイル内の指示どおり削除せず commit します。将来の Next.js 開発時に、該当バージョンの公式ガイドを確認するための開発者向け案内です。

## Money Manager のインポートで使うパーサー

XLSX パーサーは exceljs、xlsx/SheetJS CE、read-excel-file、fflate も比較しました。exceljs は依存関係が大きく UUID に関する脆弱性があり、xlsx/SheetJS CE は npm での更新が滞り、既知の脆弱性と配布元の検証上の懸念があります。read-excel-file は数式のキャッシュ値を受け入れ、展開時の上限を十分に設けにくく、fflate の `unzipSync` も展開前の検査が必要です。比較の結果、yauzl 3.4.0 と saxes 6.0.0 を採用しました。yauzl はエントリを必要な時に読み込み、`validateEntrySizes` とファイル名の厳格な検証を使えます。`fromBufferPromise` で入力バイト列から読み込み、saxes で XML を狭い範囲の機能だけ解析します。エントリ数、個別の展開量、全体の展開量をアプリケーション側で制限できるため、パーサーはサーバー側だけで使用します。

## インポート形式と振替の扱い

対応するのは「らくな家計簿」Android 版の Excel エクスポートだけです。先頭 11 列は日付、資産、分類、小分類、内容、JPY、収入/支出、メモ、金額、通貨、資産の順です。F が正本金額で、J は JPY の確認に使い、保存しません。I と K も保存せず、手数料は推測しません。

振替は収入・支出の組にはせず、`accounts` と `transfers` の一行として保存します。送金元と送金先は削除されていない資産から選び、空の資産名・同一の振替元先・不正な日付や金額・未知の種別は行エラーにします。空でない新しい資産名はプレビューで選択させず、確定時に取込単位で一度だけ作成します。

## 資産・振替のデータモデル

`accounts` は household ごとの資産です。`kind` は現金、銀行、クレジットカード、デビットカード、電子マネー、その他を持ち、`status`（`active`/`closed`）とは別に nullable な `deleted_at` で論理削除を表し、参照行を保持します。残高画面と資産作成時の資産カテゴリは `kind` を使います。`transactions.account_id` は nullable ですが、設定される場合は household を含む複合 FK で別家計を拒否します。`transfers` は from/to の両方に同じ複合 FK、`from <> to` CHECK、正の金額 CHECK を持ちます。`getAccountBalances` は資産ごとに `income - expense - transfersOut + transfersIn` を返します。

## 取込操作の冪等性と世帯ロック

ファイル本体のバイト列から SHA-256 ハッシュを計算し、監査用の値として保存します。ハッシュ自体は一意制約にせず、同じファイルを別の取込操作で再登録できます。各プレビューにランダムな `operation_key` を割り当て、`transaction_imports(household_id, source='realbyte-money-manager', operation_key)` の部分一意制約で同じ操作の二重送信だけを冪等に処理します。SHA-256 は 64 文字の小文字 16 進数として DB の CHECK で検証します。

確定処理では、まず家計の行を `SELECT FOR UPDATE` でロックし、次に `transaction_imports` を `operation_key` と一緒に追加します。追加時の operation key 一意制約違反は同じ操作として既存の取込結果を返します。別の operation key なら、取込内の各提供元資産を新規資産へ一度だけ割り当て、必要なカテゴリを再利用・作成した後、取引と振替を一つのトランザクションで追加します。カード資産を含む行では影響するカード設定行（設定がなければカード資産行）もロックします。別操作で同じファイルを取り込んだ分も月次収支と残高に反映します。

## 再アップロードによる確定

`moneyManagerImportAction` はプレビュー時にファイルのハッシュと `operation_key` を計算し、正規化を行います。返すのはファイル名、集計値、先頭の取引行、エラー、新しいカテゴリ・資産などに限られ、ファイル本体は保存しません。

確定時は同じファイルをサーバーで読み直し、ハッシュ・操作キー・上限を再検証してから `commitMoneyManagerImport()` を呼びます。プレビュー後にファイルが変わっていれば確定せず、ファイル本体はリクエスト処理中のメモリだけに置きます。別操作の再アップロードでは同じデータを追加し、同じ操作キーでの二重送信だけを冪等に処理します。既存資産の名前・資産カテゴリ・カード条件は変更しません。

## インポートの上限

`MONEY_MANAGER_XLSX_LIMITS` は ZIP のエントリ数を 128、エントリごとの未圧縮サイズを 8 MiB、全体の未圧縮サイズを 32 MiB に制限します。共有文字列は 100,000 件、合計 8 MiB までです。ワークシートの取引行は読み込み時に `MONEY_MANAGER_MAX_ROWS` の 10,000 行まで、金額・日付シリアルの数値表記は 64 文字までです。共有文字列の参照先が範囲外ならファイルエラーにします。アップロードするファイル本体は 5 MiB、XML の深さは 64 までです。yauzl のサイズ検証で過剰な展開を防ぎ、saxes は DOCTYPE を拒否します。数式セルは検出して行エラーにします。

## インポート schema

schema は `packages/db/src/schema.ts` に定義し、`0008` までの migration を空 DB・既存 migration 適用済み DB の両方へ適用する integration test で確認します。

## 統合フォームでの振替入力

振替は通常の支出・収入と同じ登録・編集フォームの種別選択肢に含め、amount/date/memo を共有します。振替を選んだときだけ元資産・先資産を表示し、カテゴリは表示しません。新規振替は削除されていない資産（`deleted_at` が null、`status` が `closed` でも可）だけを受け付け、資産未選択や同一資産などの入力エラーはクライアント・サーバー検証と DB 制約で拒否します。

## クレジットカード請求と自動決済

カードの費用は利用日（`transactions.occurred_on`）に認識し、支払日は費用を新たに認識しない。支払は銀行口座からカード口座への通常の振替として元帳に記録する。締め済みの期間へ、カードへの振替・カードからの振替を日付順 FIFO で割り当てて未払い額を導出するため、支払の allocation/link 行は作らない。過払いは次の期間へ繰り越し、支払時に支出を二重計上しない。

自動決済の ON/OFF 列は持たない。`account_card_settings` の行が存在し、締め日・支払日・支払月・引落口座が有効なカードだけを対象にする。catch-up の下限は `auto_payment_starts_on` とし、`due_on >= 下限` かつ当日までの支払日を対象にする（境界日の支払日は含む）。0008 migration は既存の設定行へ migration 適用時点の東京日付を設定し、新規設定行も作成時の東京日付を保存する。設定行が不完全な状態から完全な状態へ更新されたときは更新時点の東京日付へ境界を進め、完全な設定の値変更や不完全なままの編集では境界を維持する。これにより、既存ユーザーの導入前履歴や不完全な設定を後から完成した時点より前の履歴を一括決済しない。設定行を削除して再作成した場合も、新しい作成日の境界になる。

worker は起動時と一定間隔で期限到来分を処理する。`(household_id, card_account_id, due_on)` の一意制約と設定行の `FOR UPDATE` ロックで再実行・再起動・並行実行を冪等にする。既存の手動振替やインポート振替を含む現在の FIFO 残額だけを振替額とし、残額が 0 以下なら `settled` run のみ記録する。自動作成済み振替が通常 UI で編集・削除されても completed run は再作成せず、意図しない追加決済を防ぐ。

引落口座が未設定、資産カテゴリが銀行でない、削除済み、またはカード条件が不足している場合は口座を推測せず、transfer を作らない。期限ごとの `blocked` run に理由を保存し、設定修正後の tick で再試行する。銀行残高の不足はブロック理由にせず、通常の振替として残高をマイナスにする。期間境界は締め日を含み翌日から次期間、日付 31 は短い月の末日、月末・年跨ぎも同じ calendar helper で解決する。
