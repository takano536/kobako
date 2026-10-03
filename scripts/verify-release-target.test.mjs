import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'vitest';

import {
  classifyReleaseTarget,
  decideReleaseFinalizeOutcome,
  parseReleaseTag,
  validateReleaseObject,
} from './verify-release-target.mjs';
const expectedSha = 'c'.repeat(40);

describe('release tag validation', () => {
  it('accepts only plain non-retired vX.Y.Z tags', () => {
    assert.deepEqual(parseReleaseTag('v1.2.3'), { tag: 'v1.2.3', version: '1.2.3' });
    assert.equal(parseReleaseTag('v0.1.0'), null);
    assert.equal(parseReleaseTag('v01.2.3'), null);
    assert.equal(parseReleaseTag('v1.2.3-rc.1'), null);
    assert.equal(parseReleaseTag('1.2.3'), null);
  });
});

describe('immutable release target states', () => {
  it('distinguishes absent, matching, incomplete, and mismatched objects', () => {
    assert.equal(
      classifyReleaseTarget({ tagSha: null, releaseExists: false, expectedSha }),
      'absent',
    );
    assert.equal(
      classifyReleaseTarget({ tagSha: expectedSha, releaseExists: true, expectedSha }),
      'matching',
    );
    assert.equal(
      classifyReleaseTarget({ tagSha: expectedSha, releaseExists: false, expectedSha }),
      'incomplete',
    );
    assert.equal(
      classifyReleaseTarget({ tagSha: 'd'.repeat(40), releaseExists: true, expectedSha }),
      'mismatch',
    );
  });
});
describe('Release finalize action outcome', () => {
  it('tolerates an action failure only after a matching immutable target is verified', () => {
    assert.equal(
      decideReleaseFinalizeOutcome({ actionOutcome: 'failure', targetState: 'matching' }),
      'tolerated-failure',
    );
    assert.equal(
      decideReleaseFinalizeOutcome({ actionOutcome: 'failure', targetState: 'absent' }),
      'fail',
    );
    assert.equal(
      decideReleaseFinalizeOutcome({ actionOutcome: 'failure', targetState: 'mismatch' }),
      'fail',
    );
  });
});

describe('published Release metadata', () => {
  it('accepts a matching published Release with an exact target SHA', () => {
    assert.doesNotThrow(() =>
      validateReleaseObject(
        {
          draft: false,
          prerelease: false,
          tag_name: 'v1.2.3',
          target_commitish: expectedSha,
        },
        'v1.2.3',
        expectedSha,
      ),
    );
  });

  it.each([
    ['draft', { draft: true, prerelease: false, tag_name: 'v1.2.3' }],
    [
      'branch target',
      { draft: false, prerelease: false, tag_name: 'v1.2.3', target_commitish: 'main' },
    ],
    ['tag mismatch', { draft: false, prerelease: false, tag_name: 'v9.9.9' }],
    [
      'target SHA mismatch',
      {
        draft: false,
        prerelease: false,
        tag_name: 'v1.2.3',
        target_commitish: 'd'.repeat(40),
      },
    ],
  ])('rejects %s Release metadata', (_name, release) => {
    assert.throws(() => validateReleaseObject(release, 'v1.2.3', expectedSha));
  });
});

const verifyTargetScript = path.resolve('scripts/verify-release-target.mjs');

async function makeVerifyTargetFake(release, tagSha = expectedSha, version = '0.3.1') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kobako-release-target-'));
  const bin = path.join(directory, 'bin');
  await mkdir(bin);
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ version }));
  await writeFile(path.join(directory, 'release.json'), JSON.stringify(release));
  await writeFile(path.join(bin, 'gh'), '#!/bin/sh\ncat "$FAKE_RELEASE_FILE"\n', 'utf8');
  await writeFile(
    path.join(bin, 'git'),
    `#!/bin/sh
case "$1" in
  ls-remote)
    if [ -n "$FAKE_TAG_SHA" ]; then printf '%s\\t%s\\n' "$FAKE_TAG_SHA" "$4"; fi
    ;;
  fetch) exit 0 ;;
  rev-parse) printf '%s\\n' "$FAKE_TAG_SHA" ;;
  *) echo "unexpected git invocation: $*" >&2; exit 2 ;;
esac
`,
    'utf8',
  );
  await chmod(path.join(bin, 'gh'), 0o755);
  await chmod(path.join(bin, 'git'), 0o755);
  return { directory, releaseFile: path.join(directory, 'release.json'), tagSha };
}

async function runVerifyTarget(fake, actionOutcome = '') {
  try {
    return spawnSync(process.execPath, [verifyTargetScript, 'verify'], {
      cwd: fake.directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${path.join(fake.directory, 'bin')}:${process.env.PATH}`,
        FAKE_RELEASE_FILE: fake.releaseFile,
        FAKE_TAG_SHA: fake.tagSha,
        GITHUB_REPOSITORY: 'takano536/kobako',
        EXPECTED_SHA: expectedSha,
        RELEASE_TAG: '',
        GITHUB_OUTPUT: '',
        RELEASE_ACTION_OUTCOME: actionOutcome,
      },
    });
  } finally {
    await rm(fake.directory, { recursive: true, force: true });
  }
}

describe('verify command metadata validation', () => {
  it.each(['0.3.1', '0.4.0', '1.2.3'])(
    'accepts matching Release metadata for isolated package version %s',
    async (version) => {
      const fake = await makeVerifyTargetFake(
        {
          draft: false,
          prerelease: false,
          tag_name: `v${version}`,
          target_commitish: expectedSha,
        },
        expectedSha,
        version,
      );
      const result = await runVerifyTarget(fake);
      assert.equal(result.status, 0, result.stderr || result.stdout);
    },
  );

  it.each([
    ['draft', { draft: true, prerelease: false, tag_name: 'v0.3.1' }],
    ['prerelease', { draft: false, prerelease: true, tag_name: 'v0.3.1' }],
    ['tag mismatch', { draft: false, prerelease: false, tag_name: 'v9.9.9' }],
    [
      'target SHA mismatch',
      {
        draft: false,
        prerelease: false,
        tag_name: 'v0.3.1',
        target_commitish: 'd'.repeat(40),
      },
    ],
  ])('fails closed for %s Release object', async (_name, release) => {
    const fake = await makeVerifyTargetFake(release);
    const result = await runVerifyTarget(fake);
    assert.notEqual(result.status, 0);
    const expectedError = {
      draft: /must be published/,
      prerelease: /must be published/,
      'tag mismatch': /release tag_name v9\.9\.9 does not equal v0\.3\.1/,
      'target SHA mismatch': /target_commitish .* does not equal/,
    }[_name];
    assert.match(result.stderr, expectedError);
  });

  it('rejects a matching Release when the tag itself points elsewhere', async () => {
    const fake = await makeVerifyTargetFake(
      {
        draft: false,
        prerelease: false,
        tag_name: 'v0.3.1',
        target_commitish: expectedSha,
      },
      'd'.repeat(40),
    );
    const result = await runVerifyTarget(fake);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release tag v0\.3\.1 points at .* expected/);
  });
  it('tolerates a Release Please action failure after the immutable target matches', async () => {
    const fake = await makeVerifyTargetFake({
      draft: false,
      prerelease: false,
      tag_name: 'v0.3.1',
      target_commitish: expectedSha,
    });
    const result = await runVerifyTarget(fake, 'failure');
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });

  it('fails an action failure when the immutable target is partial', async () => {
    const fake = await makeVerifyTargetFake(
      {
        draft: false,
        prerelease: false,
        tag_name: 'v0.3.1',
        target_commitish: expectedSha,
      },
      '',
    );
    const result = await runVerifyTarget(fake, 'failure');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /only partially present/);
  });
});
