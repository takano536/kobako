# Changelog
## [0.20.0](https://github.com/takano536/kobako/compare/v0.19.0...v0.20.0) (2026-10-31)


### Features

* **web:** 固定費と残高の集計を PageSummary に統一 ([#46](https://github.com/takano536/kobako/issues/46)) ([fce7ca2](https://github.com/takano536/kobako/commit/fce7ca2e72de2c8d6dfa1932e4cc10a6e46832a5))


### Bug Fixes

* **web:** remove stale fixed-cost select class ([#45](https://github.com/takano536/kobako/issues/45)) ([d43996d](https://github.com/takano536/kobako/commit/d43996dad59785047af17c8a4a5d577cbfdc1be3))

## [0.19.0](https://github.com/takano536/kobako/compare/v0.18.0...v0.19.0) (2026-10-31)


### Features

* 固定費の登録と自動記録を追加 ([#38](https://github.com/takano536/kobako/issues/38)) ([be8002a](https://github.com/takano536/kobako/commit/be8002a13a4baf5d7dcb8247434033ec524c3d0a))

## [0.18.0](https://github.com/takano536/kobako/compare/v0.17.0...v0.18.0) (2026-10-27)


### Features

* **web:** 取引のフィルタを常時表示のチップに統一し、設定に資産一覧を追加 ([#26](https://github.com/takano536/kobako/issues/26)) ([4258c91](https://github.com/takano536/kobako/commit/4258c9115399e3960400978229e07b45e1090e71))

## [0.17.0](https://github.com/takano536/kobako/compare/v0.16.4...v0.17.0) (2026-10-26)


### Features

* **api:** 外部エージェント向けの取引 API v1 ([#23](https://github.com/takano536/kobako/issues/23)) ([74b2ecc](https://github.com/takano536/kobako/commit/74b2ecca85942907e9f59e646b885b32e4b6304c))
* **web:** API から入った取引のバッジと、即時反映するフィルタ ([#20](https://github.com/takano536/kobako/issues/20)) ([11a8169](https://github.com/takano536/kobako/commit/11a81694b0994fee9559cfb450c46ab2e397e5cd))

## [0.16.4](https://github.com/takano536/kobako/compare/v0.16.3...v0.16.4) (2026-10-24)


### Bug Fixes

* **web:** Android で選択ダイアログを閉じるタップがピッカーや適用に届かないようにする ([#19](https://github.com/takano536/kobako/issues/19)) ([d39fff4](https://github.com/takano536/kobako/commit/d39fff46e9f04edc22bf2f5cb6d2432c57ec6a3e))
* **web:** フィルタの「適用」を項目と同じ行の右端に揃える ([#21](https://github.com/takano536/kobako/issues/21)) ([4ef262f](https://github.com/takano536/kobako/commit/4ef262fa245f2beaaee76c45200672ff595092a0))

## [0.16.3](https://github.com/takano536/kobako/compare/v0.16.2...v0.16.3) (2026-10-23)


### Bug Fixes

* **web:** カード見出しの文字でも戻れるようにする ([#17](https://github.com/takano536/kobako/issues/17)) ([d60e6ef](https://github.com/takano536/kobako/commit/d60e6efee6c5a0a9b9cc553af11f76001510d396))

## [0.16.2](https://github.com/takano536/kobako/compare/v0.16.1...v0.16.2) (2026-10-23)


### Bug Fixes

* **web:** カードの外側をタップしてもカードを閉じない ([#15](https://github.com/takano536/kobako/issues/15)) ([e4eaf61](https://github.com/takano536/kobako/commit/e4eaf61776f2fa66f2262847a71f8ad5bb9ddee6))

## [0.16.1](https://github.com/takano536/kobako/compare/v0.16.0...v0.16.1) (2026-10-23)


### Bug Fixes

* **web:** タッチ端末でカードを開いたときにキーボードを出さない ([#13](https://github.com/takano536/kobako/issues/13)) ([933edae](https://github.com/takano536/kobako/commit/933edaef2d5886f726849f7db11451828d39e1a1))

## [0.16.0](https://github.com/takano536/kobako/compare/v0.15.3...v0.16.0) (2026-10-23)


### Features

* **web:** ダークテーマと設定の外観選択を追加する ([#11](https://github.com/takano536/kobako/issues/11)) ([f42944d](https://github.com/takano536/kobako/commit/f42944d791c3c6f4382f2969ccd21cc0ad37433f))

## [0.15.3](https://github.com/takano536/kobako/compare/v0.15.2...v0.15.3) (2026-10-23)


### Bug Fixes

* **web:** ナビの連打を直列化し、遷移先の外枠を先に表示する ([#8](https://github.com/takano536/kobako/issues/8)) ([b6482d9](https://github.com/takano536/kobako/commit/b6482d9f042363a119f61bf848ba1370b3278692))

## [0.15.2](https://github.com/takano536/kobako/compare/v0.15.1...v0.15.2) (2026-10-23)


### Performance Improvements

* **web:** カードの枠を内容より先に描画する ([#6](https://github.com/takano536/kobako/issues/6)) ([602b827](https://github.com/takano536/kobako/commit/602b8277c0146b2ecff69bf8776c9fea94329c43))

## [0.15.1](https://github.com/takano536/kobako/compare/v0.15.0...v0.15.1) (2026-10-23)


### Bug Fixes

* **ci:** authenticate the worker deletion with the curl bearer flag ([#98](https://github.com/takano536/kobako/issues/98)) ([fb20890](https://github.com/takano536/kobako/commit/fb20890178743983632a5976b2a0bef3e13fb507))
* **web:** align the month switcher and page shell across screens ([#2](https://github.com/takano536/kobako/issues/2)) ([7ec2763](https://github.com/takano536/kobako/commit/7ec2763cf39f7d26ffc966c21cb2587ab9ff3362))
* **web:** animate delete modal scrim ([#3](https://github.com/takano536/kobako/issues/3)) ([8b8a834](https://github.com/takano536/kobako/commit/8b8a8345638caa03eefe177034e0a54104b66277))
* **web:** animate overlay cards and drop the blurred scrim ([#1](https://github.com/takano536/kobako/issues/1)) ([7acc351](https://github.com/takano536/kobako/commit/7acc3517904b2884b60b732f7088321677614b36))

## [0.15.0](https://github.com/takano536/kobako/compare/v0.14.0...v0.15.0) (2026-10-21)


### Features

* **ci:** split the public demo from pull request previews ([#88](https://github.com/takano536/kobako/issues/88)) ([82b26ec](https://github.com/takano536/kobako/commit/82b26ec6a6f10b609e30ddd2203eb14ac487d10f))
* **web:** give every demo visitor their own household ([#87](https://github.com/takano536/kobako/issues/87)) ([c434953](https://github.com/takano536/kobako/commit/c4349532fe8ba3dc7cdbdf8460562386be7f3fa3))

## [0.14.0](https://github.com/takano536/kobako/compare/v0.13.4...v0.14.0) (2026-10-19)


### Features

* **web:** refresh paper notebook UI ([#83](https://github.com/takano536/kobako/issues/83)) ([a648744](https://github.com/takano536/kobako/commit/a6487445586fc0c6fbb544ee22b3a21ea1220253))

## [0.13.4](https://github.com/takano536/kobako/compare/v0.13.3...v0.13.4) (2026-10-17)


### Bug Fixes

* **web:** center transaction detail blocks ([#81](https://github.com/takano536/kobako/issues/81)) ([7498567](https://github.com/takano536/kobako/commit/7498567afd351190c6117334a70220ac1f4468a8))

## [0.13.3](https://github.com/takano536/kobako/compare/v0.13.2...v0.13.3) (2026-10-16)


### Bug Fixes

* **web:** link balance rows and use pencil edit icon ([#78](https://github.com/takano536/kobako/issues/78)) ([2bbeed7](https://github.com/takano536/kobako/commit/2bbeed7329be1eafce9fd919fc702e43919e29bc))

## [0.13.2](https://github.com/takano536/kobako/compare/v0.13.1...v0.13.2) (2026-10-16)


### Bug Fixes

* **web:** share balance font size with asset names ([#76](https://github.com/takano536/kobako/issues/76)) ([f699f86](https://github.com/takano536/kobako/commit/f699f86ff4bb664b2171f3f516874123d0e01aae))

## [0.13.1](https://github.com/takano536/kobako/compare/v0.13.0...v0.13.1) (2026-10-16)


### Bug Fixes

* **web:** remove asset category labels from transactions ([#75](https://github.com/takano536/kobako/issues/75)) ([5cdb2d0](https://github.com/takano536/kobako/commit/5cdb2d07a59a2334da77a72b85c47d11ff7e5b05))

## [0.13.0](https://github.com/takano536/kobako/compare/v0.12.0...v0.13.0) (2026-10-15)


### Features

* **web:** move import screen into settings ([#73](https://github.com/takano536/kobako/issues/73)) ([72c3719](https://github.com/takano536/kobako/commit/72c371982ac6f78dcae6bee9f1c899dc440b2d85))

## [0.12.0](https://github.com/takano536/kobako/compare/v0.11.0...v0.12.0) (2026-10-15)


### Features

* **web:** move main navigation to bottom bar on mobile and header on desktop ([#71](https://github.com/takano536/kobako/issues/71)) ([1ced75f](https://github.com/takano536/kobako/commit/1ced75fcd73ff0ddbd6c54aed314e5a171fbca29))


### Bug Fixes

* **web:** unify balance amount font sizes ([#69](https://github.com/takano536/kobako/issues/69)) ([91e61c0](https://github.com/takano536/kobako/commit/91e61c0f9c0abffe35694e578755a44499ed7a3e))

## [0.11.0](https://github.com/takano536/kobako/compare/v0.10.3...v0.11.0) (2026-10-13)


### Features

* **web:** manage custom asset categories ([#67](https://github.com/takano536/kobako/issues/67)) ([4356bb0](https://github.com/takano536/kobako/commit/4356bb04e7d7f415144c1ea9da99d13693543ccf))

## [0.10.3](https://github.com/takano536/kobako/compare/v0.10.2...v0.10.3) (2026-10-12)


### Bug Fixes

* **web:** align category page headers ([#65](https://github.com/takano536/kobako/issues/65)) ([839883b](https://github.com/takano536/kobako/commit/839883b0d57ee6d3173a89e9e26b68cef4cd706c))

## [0.10.2](https://github.com/takano536/kobako/compare/v0.10.1...v0.10.2) (2026-10-10)


### Bug Fixes

* **web:** link child screen headings back to their parents ([#63](https://github.com/takano536/kobako/issues/63)) ([0a722a5](https://github.com/takano536/kobako/commit/0a722a5926a0caf45a83dcc2e6f3864bea6d665d))

## [0.10.1](https://github.com/takano536/kobako/compare/v0.10.0...v0.10.1) (2026-10-10)


### Bug Fixes

* **web:** link settings child headings back to settings ([#61](https://github.com/takano536/kobako/issues/61)) ([d5965b9](https://github.com/takano536/kobako/commit/d5965b9ed08cf0ef783dc19ab58c7d89bc97a97f))

## [0.10.0](https://github.com/takano536/kobako/compare/v0.9.4...v0.10.0) (2026-10-09)


### Features

* **web:** add settings with category management and data reset ([#59](https://github.com/takano536/kobako/issues/59)) ([2a16f12](https://github.com/takano536/kobako/commit/2a16f12eaf6d7c585293111338f8c27a12898319))

## [0.9.4](https://github.com/takano536/kobako/compare/v0.9.3...v0.9.4) (2026-10-09)


### Bug Fixes

* **web:** show transaction asset names and compact typography ([#57](https://github.com/takano536/kobako/issues/57)) ([e958cb6](https://github.com/takano536/kobako/commit/e958cb67cbc0ccd94aaa947324f628943c7ff7bb))

## [0.9.3](https://github.com/takano536/kobako/compare/v0.9.2...v0.9.3) (2026-10-08)


### Bug Fixes

* **web:** 取引表示の資産カテゴリを正しく表示 ([#55](https://github.com/takano536/kobako/issues/55)) ([a65303d](https://github.com/takano536/kobako/commit/a65303d7130d58f039aa8705a6b047238f1f8ab4))

## [0.9.2](https://github.com/takano536/kobako/compare/v0.9.1...v0.9.2) (2026-10-08)


### Bug Fixes

* **ci:** classify releases and retry automerge safely ([#54](https://github.com/takano536/kobako/issues/54)) ([8003858](https://github.com/takano536/kobako/commit/8003858bf87cba8ff2936be2070f0376fafa1002))
* **deps:** bump next to 16.3.8 with pnpm-lock.yaml update ([#53](https://github.com/takano536/kobako/issues/53)) ([25e5099](https://github.com/takano536/kobako/commit/25e50998a15739759fb2a1e4ced5cb9a18da5e81))
* **web:** split transaction rows into two detail columns ([#50](https://github.com/takano536/kobako/issues/50)) ([31f14f4](https://github.com/takano536/kobako/commit/31f14f4b2a7104347b863b997f575a763da224ca))

## [0.9.1](https://github.com/takano536/kobako/compare/v0.9.0...v0.9.1) (2026-10-08)


### Bug Fixes

* **web:** preserve selected month across navigation ([#47](https://github.com/takano536/kobako/issues/47)) ([766bd4c](https://github.com/takano536/kobako/commit/766bd4c152710f21c0a557a781646cb89b5043ca))

## [0.9.0](https://github.com/takano536/kobako/compare/v0.8.1...v0.9.0) (2026-10-07)


### Features

* **web:** show all matching entries in the transactions list ([#45](https://github.com/takano536/kobako/issues/45)) ([618f5ad](https://github.com/takano536/kobako/commit/618f5ad05a7ac48ffeb19834f1d9090c8ee50ec0))

## [0.8.1](https://github.com/takano536/kobako/compare/v0.8.0...v0.8.1) (2026-10-07)


### Bug Fixes

* remove account kind change confirmation ([#43](https://github.com/takano536/kobako/issues/43)) ([051c5ac](https://github.com/takano536/kobako/commit/051c5ac9060c492461fea49730e7c638b17dc447))

## [0.8.0](https://github.com/takano536/kobako/compare/v0.7.1...v0.8.0) (2026-10-07)


### Features

* add credit card payment schedules and auto payments ([#40](https://github.com/takano536/kobako/issues/40)) ([43b4853](https://github.com/takano536/kobako/commit/43b485392b3669425974670b498addc2ebe49592))

## [0.7.1](https://github.com/takano536/kobako/compare/v0.7.0...v0.7.1) (2026-10-06)


### Bug Fixes

* **web:** show mobile balance summary as columns ([#39](https://github.com/takano536/kobako/issues/39)) ([9c6aab4](https://github.com/takano536/kobako/commit/9c6aab44c06ea6600281c6c8777dfc6bf956a02c))

## [0.7.0](https://github.com/takano536/kobako/compare/v0.6.0...v0.7.0) (2026-10-04)


### Features

* simplify asset management and always-append imports ([#37](https://github.com/takano536/kobako/issues/37)) ([e562933](https://github.com/takano536/kobako/commit/e562933316baf432a6a0e10bf3068d46a76445a5))

## [Unreleased]

### Features

* unify asset registration and settings, add debit-card assets, logical deletion, and current card-condition editing
* create new assets for each import operation, grouping the same provider asset only within that operation
* add migration coverage for fresh databases and upgrades from the previous account schema
* allow separate re-imports of the same file as new data (including monthly totals and balances) while making the same operation key idempotent
* derive card payment schedules from usage-date FIFO balances, aggregate bank schedules across cards, and run idempotent payments from an explicit migration-safe start boundary

### Bug Fixes

* make asset and current card-condition saves atomic and reject updates to logically deleted assets
* keep the mobile balance summary compact and show long amounts without truncation
* fix credit-card balance columns to show scheduled bills and current-period unbilled usage separately


## [0.6.0](https://github.com/takano536/kobako/compare/v0.5.1...v0.6.0) (2026-10-03)


### Features

* publish a single image with bundled migration ([#35](https://github.com/takano536/kobako/issues/35)) ([79d98a1](https://github.com/takano536/kobako/commit/79d98a12294302bfdf5a5fd73dcf30bc019105e4))

## [0.5.1](https://github.com/takano536/kobako/compare/v0.5.0...v0.5.1) (2026-10-03)


### Bug Fixes

* **ci:** harden release finalization permissions ([#33](https://github.com/takano536/kobako/issues/33)) ([57b8b28](https://github.com/takano536/kobako/commit/57b8b283ab0ec7c08720ba957bbab34e7ef5cf30))

## [0.5.0](https://github.com/takano536/kobako/compare/v0.4.1...v0.5.0) (2026-10-03)


### Features

* **web:** add balances page with asset/liability summary ([#31](https://github.com/takano536/kobako/issues/31)) ([b0b61f2](https://github.com/takano536/kobako/commit/b0b61f2b50ae93a6613b951e3e8c6e57b34ed949))

## [0.4.1](https://github.com/takano536/kobako/compare/v0.4.0...v0.4.1) (2026-10-02)


### Bug Fixes

* **ci:** isolate release tests from repository variables ([#27](https://github.com/takano536/kobako/issues/27)) ([7d03a33](https://github.com/takano536/kobako/commit/7d03a3367a33e10bb880fcde6d63d03900ae74ff))
* **release:** classify ordinary main pushes before PR validation ([#28](https://github.com/takano536/kobako/issues/28)) ([697d8f8](https://github.com/takano536/kobako/commit/697d8f8b4b88b7135091cc06efed56d0a2e6c018))
* **release:** require native PR checks and support scoped App auth ([#24](https://github.com/takano536/kobako/issues/24)) ([9046cb0](https://github.com/takano536/kobako/commit/9046cb0136a12332d3a162b9f0421f91b772b35e))
* **release:** run Release PR automation with native CI ([#26](https://github.com/takano536/kobako/issues/26)) ([3584db7](https://github.com/takano536/kobako/commit/3584db711efb6f421ea76515a1abd52073baa556))
* **release:** validate web-flow committer against REST commit shape ([#30](https://github.com/takano536/kobako/issues/30)) ([d7f3fa0](https://github.com/takano536/kobako/commit/d7f3fa0aeb108b33d62c70effc91a0494e1732c9))

## [0.4.0](https://github.com/takano536/kobako/compare/v0.3.1...v0.4.0) (2026-10-02)


### Features

* **web:** unify ledger page layout ([#19](https://github.com/takano536/kobako/issues/19)) ([420fa47](https://github.com/takano536/kobako/commit/420fa4748f0f9fd15228b61c915c997e0f8ff77c))


### Bug Fixes

* **release:** accept verified GitHub web-flow committer ([#23](https://github.com/takano536/kobako/issues/23)) ([0222239](https://github.com/takano536/kobako/commit/0222239e244828aa181e95baa2b82133cb293a47))
* **release:** isolate target verification tests from package version ([#21](https://github.com/takano536/kobako/issues/21)) ([fb94a3d](https://github.com/takano536/kobako/commit/fb94a3d9a9a2e35d9106a555c6ca556718f7a766))

## [0.3.1](https://github.com/takano536/kobako/compare/v0.3.0...v0.3.1) (2026-10-01)


### Bug Fixes

* **web:** show type choice focus ring only for keyboard focus ([#16](https://github.com/takano536/kobako/issues/16)) ([76cc3b1](https://github.com/takano536/kobako/commit/76cc3b1e699122be1c69b7c75a8d2b09d1bb80a3))

## [0.3.0](https://github.com/takano536/kobako/compare/v0.2.1...v0.3.0) (2026-10-01)


### Features

* 振替の作成・編集・削除に対応 ([#14](https://github.com/takano536/kobako/issues/14)) ([3f1df80](https://github.com/takano536/kobako/commit/3f1df804bee0c7a3ebab343735f95fdf142b4c37))

## [0.2.1](https://github.com/takano536/kobako/compare/v0.2.0...v0.2.1) (2026-09-30)


### Bug Fixes

* web 起動前に DB migration を自動適用する ([#12](https://github.com/takano536/kobako/issues/12)) ([d8453b1](https://github.com/takano536/kobako/commit/d8453b107938f837b917db9f6f30dfa4ed88eaf3))

## [0.2.0](https://github.com/takano536/kobako/compare/v0.1.1...v0.2.0) (2026-09-30)


### Features

* らくな家計簿 Android Excel の取り込み ([#10](https://github.com/takano536/kobako/issues/10)) ([ca8b88d](https://github.com/takano536/kobako/commit/ca8b88d09c29b0dc16613f4ed10dfffd654b3a2f))

## [0.1.1](https://github.com/takano536/kobako/compare/v0.1.0...v0.1.1) (2026-09-28)


### Bug Fixes

* gate releases on successful quality checks ([#8](https://github.com/takano536/kobako/issues/8)) ([1454d47](https://github.com/takano536/kobako/commit/1454d4728000d2cd56a8441048ca09c310b3b4d5))

## 0.1.0 (2026-09-28)


### Features

* add minimal household ledger ([#2](https://github.com/takano536/kobako/issues/2)) ([e36f420](https://github.com/takano536/kobako/commit/e36f4201406fdfae9ea6745bf19e709f225f778e))
* publish versioned private GHCR images with Release Please ([87f8a6c](https://github.com/takano536/kobako/commit/87f8a6cfc71498e791769fa3a38f13986060dcfc))
* **web:** redesign household ledger as a minimal notebook ([#3](https://github.com/takano536/kobako/issues/3)) ([408314b](https://github.com/takano536/kobako/commit/408314b8c0da197fe6fd3abdc719353758edc385))
