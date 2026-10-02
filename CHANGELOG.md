# Changelog

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
