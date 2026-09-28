# リリース運用

kobako は Conventional Commits と Semantic Versioning (SemVer) を使い、Release Please の Release PR を唯一の正式リリース起点にします。Release PR を merge するまでは、Git tag、GitHub Release、SemVer 付き GHCR image は作成されません。

## バージョンと commit

通常の PR と Release Please の Release PR は squash merge します。main に残る squash 後の PR title が Conventional Commit として解析されるため、title は変更の実態に合う prefix を付けます。

| prefix                                         | 0.x.y                     | 1.0.0 以降   |
| ---------------------------------------------- | ------------------------- | ------------ |
| `fix:`                                         | patch (`0.1.0` → `0.1.1`) | patch        |
| `feat:`                                        | minor (`0.1.1` → `0.2.0`) | minor        |
| `feat!:` または `BREAKING CHANGE:`             | minor (`0.2.0` → `0.3.0`) | major        |
| `docs:`、`test:`、`ci:`、`chore:`、`refactor:` | リリースなし              | リリースなし |

`0.x` の breaking change は `bump-minor-pre-major: true` で minor とします。実際の不具合修正をリリース抑制のために `chore:` や `ci:` へ偽装してはいけません。複数の `fix:` が main に蓄積した場合も、同じ Release PR にまとめて一度 squash merge すれば patch bump は一度だけです。

安定版への移行では独自 prefix を作らず、`Release-As` footer で明示します。これは今回の実装では実行しません。

```sh
git commit --allow-empty \
  -m "chore: prepare stable release" \
  -m "Release-As: 1.0.0"
```

## Release Please と tag

`.release-please-manifest.json` は root (`.`) だけを一つの version として管理します。初回は manifest を空にし、`initial-version: 0.1.0` によって初回 Release PR が必ず `0.1.0` を提案します。Release PR が merge されて `v0.1.0` tag が作成された後は manifest の release version と通常の Conventional Commit bump が使われ、固定の `release-as` を残す方式ではありません。
Release Please が使う `autorelease: pending` と `autorelease: tagged` label は事前に repository へ作成しておく必要があります。削除された場合は `issues: write` 権限を追加せず、同じ名前の label を再作成してください。初回実行でなお label permission error が発生した場合だけ、権限を再検討するシグナルとします。

Release PR は `GITHUB_TOKEN` で作成されるため、`pull_request` の CI は自動実行されません。マージ前のチェックを実行する場合は、ユーザー操作で Release PR を close して reopen します。

Release PR の merge 後は `release-ci` job が全 quality gates を再実行し、すべて成功してから X.Y.Z image を公開します。

root `package.json`、`apps/web`、`apps/worker`、`packages/db` の version と self-host Compose の image tag は Release PR で同じ version に更新されます。workspace package の version は pnpm lockfile に記録されないため、lockfile の変更は発生しません。

Release PR を merge すると、Release Please は tag と GitHub Release を作成します。その同じ Release Please workflow run の `release-ci` job が `ci.yml` を `release_tag` とともに呼び、全 quality gates を再実行します。すべて成功した場合だけ、`ci.yml` の publish job が同じ commit から次の GHCR image を `X.Y.Z` tag で公開します。

- Git tag / GitHub Release: `vX.Y.Z`
- GHCR web: `ghcr.io/takano536/kobako-web:X.Y.Z`
- GHCR migrate: `ghcr.io/takano536/kobako-migrate:X.Y.Z`

`web` と `migrate` は常に同じ version、同じ commit revision で公開し、異なる version を組み合わせて deploy しません。self-host Compose の初回 tag は `0.1.0` ですが、0.1.0 image は初回 Release PR を merge した後にだけ存在します。

## GHCR tag の用途

- `X.Y.Z`: Release PR merge 後に release workflow が公開する正式版。self-host の本番 Compose と Renovate はこれだけを追跡します。
- `sha-<full commit SHA>`: main の品質ゲートを通った build の調査、厳密な pin、rollback 用。同じ publish job が web/migrate の両方へ付けます。
- `latest`: main の最新成功 build を指す可変 tag。試用・手動確認専用で、正式版の release job は `latest` を更新しません。本番 Compose や Renovate では使いません。

`X.Y` や `X` のような可変 SemVer tag は作成しません。2 つの package の tag 更新は atomic ではないため、web/migrate の整合性が必要な更新や rollback では完全な SemVer または同一 `sha-<SHA>` を指定します。

private GHCR の pull には `read:packages` 権限が必要です。deploy host では、権限を持つ token を使って次のように login します。token は Compose や repository に保存しません。

```sh
printf '%s' "$GHCR_READ_PACKAGES_TOKEN" \
  | docker login ghcr.io --username YOUR_GITHUB_USERNAME --password-stdin
```

## DB migration と rollback

既存データを維持する additive migration は内容に応じて patch または minor とします。列削除、互換性のない型変更、データ損失、手動手順が必要な migration は breaking change とし、PR と CHANGELOG に明記します。rollback 不能または旧 version に戻せない migration は Release notes にも明記します。

rollback では以前の完全な `X.Y.Z`、または調査時点の `sha-<full commit SHA>` へ web と migrate を一緒に pin します。migration は forward-only の場合があるため、古い image に戻しても schema の変更は取り消されません。schema を戻す必要がある場合は、先に DB backup を復元します。

## Renovate (利用側)

この repository には利用側の Renovate 設定を追加しません。利用側は Docker datasource で完全な SemVer を検出し、private GHCR の hostRules 認証を設定してください。`kobako-web` と `kobako-migrate` は同じ PR にまとめます。README に利用側の `packageRule` 例を示しています。
