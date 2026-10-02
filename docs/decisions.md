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

カテゴリの `type`（支出/収入）と household 所有を UI だけに任せず、`transactions(category_id, household_id, type)` から `categories(id, household_id, type)` への複合 FK で DB に強制します。categories 側には複合 FK 用の一意キーを置き、transaction amount、参照、memo 長も not-null/FK/CHECK/varchar で検証します。

## Mutation と再検証

Mutation 機構は Next.js Server Actions に統一します。登録・編集フォームは React 19 の `useActionState` でサーバーから返した入力値と日本語フィールドエラーを表示し、フォーム送信時はクライアント側でも同じ Zod schema を検証しますが（`event.preventDefault()` で不正な送信そのものを止めます）、Server Action は必ず同じ schema と DB 上のカテゴリ照合で再検証します。成功時は対象月の一覧へ redirect し、`revalidatePath` を呼びます。削除は `<details>` の確認開示を使い、`confirm=delete` を含む送信だけを受け付けます。確認値がない直接送信は削除せず、JavaScript 無効でも 2 回目の送信で確定できます。`deleteTransaction` は単一の `DELETE ... RETURNING occurred_on` で削除対象の日付を取得し（削除前に別 query で存在確認しません）、行が返らなければ `notFound()` を呼びます。削除後は対象月一覧へ redirect して削除済み URL には戻りません。Route Handler、optimistic update、追加キャッシュは使いません。

## 入力拒否とフォーカス可能な日付欄

不正な金額のキー入力・貼り付けは、別の数値へ変換せず元の値を保持して小さな `role="alert"` を再マウントします。見た目の date button と送信用 native input は、後者を `tabIndex=-1` にして Tab stop を一つにし、button のラベルと focus ring を維持します。mouse/touch と keyboard の picker 起動は native date input に委譲します。

## server-only パッケージ

`server-only` パッケージは依存に追加していません。DB client と household 解決は `apps/web/src/lib/ledger-data.ts` に置き、`apps/web/app/transactions/import/actions.ts` は `'use server'` で XLSX 解析と DB 操作を実行します。`import-form.tsx` は Server Action の参照と型だけを持ち、`state.ts` は型 import だけです。`page.tsx` は Server Component です。

## Worker

worker は今すぐ job を処理しませんが、web request と将来の Import/Export 等を分離するプロセス境界には価値があります。そのため、起動時 DB check、signal による graceful shutdown、idle 待機だけを実装しました。

## Integration test の DB 安全性

integration test は `TEST_DATABASE_URL` を必須とし、`NODE_ENV=production` または非 loopback host を拒否します。対象 database name は `test`/`tests` token を含む test-designated 名に限定し、`DATABASE_URL` とは host alias（`localhost`/`127.0.0.1`/`::1`）、既定 port 5432、database name を正規化した identity が一致しないことを確認します。schema の drop と各テストの truncate の直前には test 接続で `current_database()` と PostgreSQL system identifier を取得します。`DATABASE_URL` が設定されている場合は接続・identity query も成功しなければならず、到達不能、query failure、permission denied、identity 欠落など検証不能な状態では generic error で fail closed します。正常に検証できた場合だけ同じ `(system_identifier, current_database())` でないことを確認します。これにより beforeEach の reset は test DB identity が確認された後だけ実行されます。`pg_control_system()` の system identifier query は実行権限を要求し、環境によって superuser/`pg_monitor` 相当が必要です。PostgreSQL 18 の検証 image では非 superuser role の query を確認し、権限を revoke した場合は `could not verify DATABASE_URL database identity` で fail closed します。

## E2E データベースの安全性

`apps/web/e2e/ledger.spec.ts` は schema/table を truncate しません。各実行で UUID から `e2e:<UUID>:<test>` の marker を生成し、9000〜9997 年の run-specific な候補月と翌月が default household 内で空であることを DB で確認してから、画面操作の日付に使います。候補が埋まっている場合は既存行を削除せず別候補を探し、空きがなければ失敗します。E2E は `TEST_DATABASE_URL` に専用の test DB を指定し、起動時と後処理 DELETE の直前に `assertSafeTestDatabaseTarget` と `verifySafeTestDatabaseConnection` を通します。後処理の DELETE は default household・同じ遠未来範囲・現在 run の marker prefix に限定し、guard が成功しない場合は実行しません。クラッシュした別 run の残骸や同じ年の利用者データを年だけで削除しません。

## Renovate

Dependabot と Renovate の二重運用は避け、Renovate を採用します。pnpm lockfile、workspace、GitHub Actions、Docker base image を更新対象にし、dependency dashboard と grouping は設定しますが、自動 merge は行いません。

## Shared packages

validation、calendar helper、家計簿 schema/query は Web の Server Component/Action と integration test が実際に共有するため `@kobako/db` に置きます。ブラウザ用フォームは DB client を import せず、validation サブパスだけを import します。空の抽象 package は増やしません。

## Release version source

Release Please は root `.` の単一 version として扱います。root `package.json` を正 canonical version とし、`.release-please-manifest.json`、apps/web、apps/worker、packages/db の version を同じ version に保ちます。pnpm lockfile は workspace package の version を記録しないため、version bump による lockfile 更新は行いません。`CHANGELOG.md` と manifest は Release Please の生成物として Prettier から除外し、quality gate の validator で構文と整合性を確認します。generic extra-file を追加する場合も、その marker を validator で検証します。`latest` は main の最新成功 build の試用用とし、正式版を追跡する利用側は完全な SemVer を使います。`v0.1.0` は quality gate 失敗前に作成された履歴なので再利用せず、次の正常な候補は `v0.1.1` です。

## Release automation

Release PR の自動 merge は title/branch名だけを信頼せず、Release Please v17.6.1 の pinned source/patternに従って、bot authorと、botまたはGitHub APIの署名検証が `verified=true`・`reason=valid` の `web-flow` User committer、同一 repository head、`main` base、exact head branch、`autorelease: pending`、open/non-draft、head SHA、main tip/base/sole-parentの一致をRESTで確認します。変更範囲は main checkout の `release-please-config.json` から導出した Release Please allowlistだけに限定し、各JSON version fileは `version` 以外、manifestは `.` 以外をbaseとheadで変更できず、CHANGELOGは共有する先頭の `# Changelog` 見出し直後へのtarget versionのwell-formedな新release section挿入だけを許可します。既存履歴は挿入後にbyte-identicalであること、見出し重複・編集・削除・並べ替え・誤った挿入位置を拒否することも確認します。title `chore(main): release X.Y.Z`、body root section、package/manifest versionも照合します。required status checksはChecks APIでhead SHAごとに最新recordを選び、GitHub Actions app id `15368` / slug `github-actions` の6 gateが `completed/success` であることを要求します。PUT mergeには検証済みhead SHAと`squash`を渡し、admin bypassやruleset変更は行いません。

GITHUB_TOKENが作るpushはworkflowを起動しないため、merge commit `M`に `release-verify/<M>` refを作成してworkflow_dispatchします。全gateはrunの`github.sha`をcheckoutし、入力SHAを代わりにcheckoutしません。release_pr_mergeのvalidatorも常にlive `refs/heads/main`をcheckoutし、`git rev-parse HEAD == PR base SHA == live main tip`を確認します。verify runの`M`がmainの祖先で、同じrunの6 gateが成功した場合だけ、Release Pleaseを明示的な`target-branch: main`、`skip-github-pull-request: true`でtag/Releaseに使います。Release finalize直前には live main の config、manifest、各 package version、extra-files の blob SHA が `M` と一致することを確認します。不一致なら action を実行せず、main metadata を hold/revert して同じ `M` を recovery dispatchします。main runのRelease Pleaseは常に`skip-github-release: true`です。人間mergeのnormal main runはSHA imageだけをpublishし、versioned image/tag/Releaseは作りません。

Release Please sourceは merged pending PR が残ると新PR作成を中断するため、main成功runごとに merged pending canonical PRのverify ref/runを自己修復します。refが別SHAを指す場合は停止し、同じSHAの成功/実行中runは重複dispatchしません。verify失敗時はrefを残し、成功時だけ削除します。`release-heal.yml` のscheduled/manual healerは gates なしで、対象SHAの workflow_dispatch verify run が一つもないときだけ ref作成とdispatchを行い、失敗runを再dispatchしません。Release PR branch dispatchもnon-cancellableで、pending runだけを置き換えます。mainがMより先に進んだ場合もMを検証・releaseでき、`latest` promotionは専用の `kobako-latest-promotion` lock内でmain tipをREST再確認した場合だけ実行します。

Release objectは `draft=false`、`prerelease=false`、`tag_name` exact、`target_commitish` が40桁SHAで `M` と完全一致することを要求し、branch名を拒否します。Read-only APIで確認した既存Releaseは `v0.3.0=f404557eed862e4a8d1428016d25054a3a459cab`、`v0.3.1=c44f2d1694530b62e3c9a2d6c1c94f5c2069f4ed` でした。`autorelease: tagged` 後の image publish failure は ensure/heal で自動再試行せず、残った `release-verify/<M>` を同じSHAの rerun/recovery dispatchで処理します。DELETEの404は既に削除済みとして扱い、cleanupはpromotion jobを待ちません。verify refは conflict/mismatch時にrepointせず削除・recoveryし、一覧は `gh api repos/takano536/kobako/git/matching-refs/heads/release-verify/` で確認します。
write accessを持つ actor に限定した残余 window は、`verify-release-inputs` 直後からRelease Please actionまでのPR title/bodyまたはmain config変更、merge base TOCTOU、文字通りの `release-verify` branch namespace conflictです。pending PRのrefを手動削除しfailed runだけが残る場合、scheduled healerは再dispatchしないため、同じ `M` のref再作成とmanual dispatchが必要です。
この provenance/file check は意図しない変更や Release Please が生成した内容からの逸脱を検出する guard であり、悪意ある write-access collaborator への防御ではありません。`workflow_dispatch` は release branch 上の `ci.yml` を実行するため、repository write access を持つ actor は release branchを書き換えて validator 自体を迂回できます。trust boundary は repository write access であり、release-branch ruleset はその境界を harden する optional 対策です。

merge前の base-tip/sole-parent check はGitHub merge APIに compare-and-swap がないため原子的な保証ではありません。mainのrulesetでは `strict_required_status_checks_policy: true` を推奨しますが、通常PRが最新mainを取り込んでからmergeする運用コストがあります。Release PR branchをbot/限定maintainerだけが更新できるrulesetも optional hardening（未適用）です。

## Next.js generated guidance

Next.js 16 の `next dev` が生成する `apps/web/AGENTS.md` と `apps/web/CLAUDE.md` は、ファイル内の指示どおり削除せず commit します。将来の Next.js 開発時に、該当バージョンの公式ガイドを確認するための開発者向け案内です。

## Money Manager のインポートで使うパーサー

XLSX パーサーは exceljs、xlsx/SheetJS CE、read-excel-file、fflate も比較しました。exceljs は依存関係が大きく UUID に関する脆弱性があり、xlsx/SheetJS CE は npm での更新が滞り、既知の脆弱性と配布元の検証上の懸念があります。read-excel-file は数式のキャッシュ値を受け入れ、展開時の上限を十分に設けにくく、fflate の `unzipSync` も展開前の検査が必要です。比較の結果、yauzl 3.4.0 と saxes 6.0.0 を採用しました。yauzl はエントリを必要な時に読み込み、`validateEntrySizes` とファイル名の厳格な検証を使えます。`fromBufferPromise` で入力バイト列から読み込み、saxes で XML を狭い範囲の機能だけ解析します。エントリ数、個別の展開量、全体の展開量をアプリケーション側で制限できるため、パーサーはサーバー側だけで使用します。

## インポート形式と振替の扱い

対応するのは「らくな家計簿」Android 版の Excel エクスポートだけです。iOS 版、PC Manager、CSV、`.xls`、`.mmbak` は対象外です。先頭 11 列は、日付、資産、分類、小分類、内容、JPY、収入/支出、メモ、金額、通貨、資産の順です。通常行の B は使用口座、振替（`引き出し`）行の B は送金元、C は送金先です。F が正本金額で、J は JPY の確認に使い、保存しません。I と K も保存せず、手数料は推測しません。

振替は収入+支出の組にはせず、`accounts` と `transfers` の一行として保存します。振替は正の整数 JPY で、送金元と送金先を別口座に限定します。通常行の B/C はそれぞれ口座名/分類名として扱い、空の口座名・同一の振替元先・不正な日付や金額・未知の種別は、日本語の修正案付き行エラーにします。空でない新しい口座名はエラーではなくプレビューの新規口座一覧に出し、確定時に household 内で一度だけ作成します。

## 口座・振替のデータモデル

`accounts` は household ごとに `(household_id, name)` を一意にし、`(id, household_id)` を複合 FK の参照キーにします。`transactions.account_id` は nullable ですが、設定される場合は household を含む複合 FK で別家計を拒否します。`transfers` は from/to の両方に同じ複合 FK、`from <> to` CHECK、正の金額 CHECK を持ち、家計削除は cascade、参照中の口座削除は restrict です。取引の日付/口座、振替の日付/from/to に lookup index を持ちます。`getAccountBalances` は口座ごとに `income - expense - transfersOut + transfersIn` を文字列で返し、口座を持たない手入力の取引を除外します。月次収入・支出・カテゴリ集計は transfers を参照しません。

## 重複検知と世帯ロック

ファイル本体のバイト列から SHA-256 ハッシュを計算し、内容を識別する値として使います。`transaction_imports(household_id, source='realbyte-money-manager', sha256)` の一意制約で、同じ家計・提供元・ファイル内容の組み合わせを重複としてデータベース側でも防ぎます。SHA-256 は 64 文字の小文字 16 進数として DB の CHECK でも検証します。プレビューではこの記録を読み取り専用で確認します。

確定処理では、まず家計の行を `SELECT FOR UPDATE` でロックし、次に `transaction_imports` を追加します。追加時の一意制約違反は重複として扱います。重複でなければ、取引に必要なカテゴリを種別と名前でまとめ、既存カテゴリを再利用し、新しいカテゴリには既存の最大 `sort_order` に 10 を加えた並び順を割り当てます。その後、取引を 500 行ずつ追加します。記録の追加を取引追加より先にロック内で行うため、同じファイルを同時に確定した場合も片方だけが登録されます。

## 再アップロードによる確定

`moneyManagerImportAction` はプレビュー時にファイルのハッシュを計算し、正規化と重複確認を行います。返すのはファイル名、集計値、先頭の取引行、エラー、新しく作るカテゴリなどに限られ、ファイル本体は保存しません。完了画面の一覧リンクは、取り込んだ期間の最新月を開きます。

確定時は、画面に選択されたままのファイルを同じフォームからもう一度送信します。JavaScript が無効でも同じフォームを二回送信できます。サーバーはファイルを読み直してハッシュと上限を検証し、プレビュー時のハッシュと比較します。選択ファイルが変わっている場合やクライアントが保持する状態と一致しない場合は確定しません。ファイル本体はリクエスト処理中のメモリだけに置き、ディスクや `.tmp`、`public` には書き込みません。Next.js の `experimental.serverActions.bodySizeLimit` は multipart の付加分を含めて 6 MB に設定しています。

## インポートの上限

`MONEY_MANAGER_XLSX_LIMITS` は ZIP のエントリ数を 128、エントリごとの未圧縮サイズを 8 MiB、全体の未圧縮サイズを 32 MiB に制限します。共有文字列は 100,000 件、合計 8 MiB までです。ワークシートの取引行は読み込み時に `MONEY_MANAGER_MAX_ROWS` の 10,000 行まで、金額・日付シリアルの数値表記は 64 文字までです。共有文字列の参照先が範囲外ならファイルエラーにします。アップロードするファイル本体は 5 MiB、XML の深さは 64 までです。yauzl のサイズ検証で過剰な展開を防ぎ、saxes は DOCTYPE を拒否します。数式セルは検出して行エラーにします。

## インポート schema

schema は `packages/db/src/schema.ts` に定義し、`0003` は drizzle-kit で生成します。空 DB に全 migration を適用する integration test で確認します。

## 統合フォームでの振替入力

振替は通常の支出・収入と同じ登録・編集フォームの種別選択肢に含め、amount/date/memo を共有します。振替を選んだときだけ元口座・先口座を表示し、カテゴリは表示せず、口座数にかかわらず保存を試行できます。口座未選択や同一口座などの入力エラーは既存のクライアント・サーバー検証で拒否し、DB の制約も維持します。種別変更の保存は DB transaction 内で新しい行を作成して元行を削除するため、変換途中の二重計上や消失を防ぎます。
