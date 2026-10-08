# Changelog
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
