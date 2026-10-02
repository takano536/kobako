import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import {
  GITHUB_ACTIONS_APP_ID,
  GITHUB_ACTIONS_APP_SLUG,
  RELEASE_BRANCH,
  REQUIRED_CHECKS,
  formatGitHubApiError,
  isSafeMergeConflict,
  isVerifiedWebFlowCommitter,
  selectCanonicalMergedReleasePr,
  selectCanonicalOpenReleasePr,
  selectLatestRequiredChecks,
  selectLatestWorkflowRun,
  validateCanonicalReleasePr,
  decideReleaseAssociation,
  decideReleasePrLabelRepair,
  validateReleasePrBeforeMerge,
  validateReleaseAppConfiguration,
  validateMainPushReleasePleaseEvidence,
  validateMainPushWorkflowRun,
  validateReleaseChangedPaths,
  validateReleasePrSnapshot,
  validateReleasePrMetadataSnapshot,
  validateMainReleaseAncestry,
  validateWorkflowRunMetadata,
} from './release-automation.mjs';
import { classifyReleaseTarget } from './verify-release-target.mjs';

const sha = (letter) => letter.repeat(40);
const repository = 'takano536/kobako';
const mainSha = sha('a');
const headSha = sha('b');
const mergeSha = sha('c');

function releasePr(overrides = {}) {
  return {
    number: 42,
    state: 'open',
    draft: false,
    merged_at: null,
    title: 'chore(main): release 9.8.7',
    body: '---\n## 9.8.7\n---',
    user: { login: 'release-bot[bot]', type: 'Bot' },
    labels: [{ name: 'autorelease: pending' }],
    head: {
      ref: RELEASE_BRANCH,
      sha: headSha,
      repo: { full_name: repository },
    },
    base: {
      ref: 'main',
      sha: mainSha,
      repo: { full_name: repository },
    },
    ...overrides,
  };
}

function mergedReleasePr(overrides = {}) {
  return releasePr({
    state: 'closed',
    merged_at: '2026-01-01T00:00:00Z',
    merge_commit_sha: mergeSha,
    merged_by: { login: 'release-bot[bot]', type: 'Bot' },
    ...overrides,
  });
}

function successfulCheck(name, id, overrides = {}) {
  return {
    id,
    name,
    app: { id: GITHUB_ACTIONS_APP_ID, slug: GITHUB_ACTIONS_APP_SLUG },
    status: 'completed',
    conclusion: 'success',
    started_at: `2026-01-01T00:0${id % 10}:00Z`,
    ...overrides,
  };
}

function successfulChecks() {
  return REQUIRED_CHECKS.map((name, index) => successfulCheck(name, index + 1));
}

describe('workflow-run metadata and App fail-closed policy', () => {
  it('accepts only a successful native pull_request run on the exact release branch and repository', () => {
    const result = validateWorkflowRunMetadata(
      {
        event: 'pull_request',
        conclusion: 'success',
        head_branch: RELEASE_BRANCH,
        head_sha: headSha,
        head_repository: { full_name: repository },
      },
      { repository, headSha },
    );
    assert.deepEqual(result, { ok: true, errors: [] });
  });

  it('rejects workflow_dispatch even when its gates passed', () => {
    const result = validateWorkflowRunMetadata(
      {
        event: 'workflow_dispatch',
        conclusion: 'success',
        head_branch: RELEASE_BRANCH,
        head_sha: headSha,
        head_repository: { full_name: repository },
      },
      { repository, headSha },
    );
    assert.equal(result.ok, false);
    assert.match(result.errors.join('; '), /event must be pull_request/);
  });

  it('rejects incomplete App configuration without a token fallback', () => {
    assert.throws(
      () => validateReleaseAppConfiguration({ clientId: '123', botLogin: '', privateKey: '' }),
      /refusing GITHUB_TOKEN fallback/,
    );
    assert.equal(
      validateReleaseAppConfiguration({
        clientId: '123',
        botLogin: 'release-bot[bot]',
        privateKey: 'fixture-key',
      }),
      true,
    );
  });

  it('reports missing App permissions as an actionable 403', () => {
    assert.match(formatGitHubApiError('pulls/42/merge', 403), /required permission/);
    assert.match(formatGitHubApiError('pulls/42/merge', 409), /409/);
  });
  it('requires successful latest main push Release Please evidence before stale-base merge', () => {
    const run = {
      name: 'CI',
      event: 'push',
      status: 'completed',
      conclusion: 'success',
      head_branch: 'main',
      head_sha: mainSha,
      head_repository: { full_name: repository },
    };
    const pending = validateMainPushReleasePleaseEvidence({
      run,
      jobs: [{ name: 'release-please', status: 'in_progress', conclusion: null, run_attempt: 2 }],
      repository,
      headSha: mainSha,
    });
    assert.equal(pending.ok, false);
    assert.match(pending.error, /release-please job is in_progress/);
    const success = validateMainPushReleasePleaseEvidence({
      run,
      jobs: [
        { name: 'release-please', status: 'completed', conclusion: 'success', run_attempt: 2 },
      ],
      repository,
      headSha: mainSha,
    });
    assert.equal(success.ok, true);
  });

  it('accepts only a successful main push CI run as push-trigger evidence', () => {
    const result = validateMainPushWorkflowRun(
      {
        name: 'CI',
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        head_branch: 'main',
        head_sha: mainSha,
        head_repository: { full_name: repository },
      },
      { repository, headSha: mainSha },
    );
    assert.deepEqual(result, { ok: true, errors: [] });
    const pending = validateMainPushWorkflowRun(
      {
        name: 'CI',
        event: 'push',
        status: 'in_progress',
        conclusion: null,
        head_branch: 'main',
        head_sha: mainSha,
      },
      { repository, headSha: mainSha },
    );
    assert.equal(pending.ok, false);
    assert.match(pending.errors.join('; '), /status is not completed/);
    assert.equal(
      validateMainPushWorkflowRun(
        {
          name: 'CI',
          event: 'push',
          status: 'completed',
          conclusion: 'success',
          head_branch: 'main',
          head_sha: mainSha,
        },
        { repository, headSha: mainSha },
      ).ok,
      true,
    );
    assert.equal(
      validateMainPushWorkflowRun(
        {
          name: 'CI',
          event: 'pull_request',
          conclusion: 'success',
          head_branch: RELEASE_BRANCH,
          head_sha: headSha,
        },
        { repository, headSha: mainSha },
      ).ok,
      false,
    );
  });

  it('uses the latest workflow attempt and treats no open Release PR as a no-op', () => {
    const latest = selectLatestWorkflowRun(
      [
        {
          id: 1,
          name: 'CI',
          event: 'push',
          head_branch: 'main',
          head_sha: mainSha,
          run_attempt: 1,
          updated_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 2,
          name: 'CI',
          event: 'push',
          head_branch: 'main',
          head_sha: mainSha,
          run_attempt: 2,
          updated_at: '2026-01-01T00:01:00Z',
        },
      ],
      { repository, event: 'push', headSha: mainSha, headBranch: 'main' },
    );
    assert.equal(latest.id, 2);
    assert.equal(
      selectCanonicalOpenReleasePr([], { repository, appBotLogin: 'release-bot[bot]' }),
      null,
    );
  });
  it('stops on an invalid branch-matched open Release PR instead of treating it as absent', () => {
    assert.throws(
      () =>
        selectCanonicalOpenReleasePr(
          [releasePr({ base: { ...releasePr().base, ref: 'develop' } })],
          {
            repository,
            appBotLogin: 'release-bot[bot]',
          },
        ),
      /no canonical open Release PR/,
    );
  });
});

describe('native required check selection', () => {
  it('requires exactly the newest successful GitHub Actions check for every gate', () => {
    const checks = selectLatestRequiredChecks(successfulChecks());
    assert.equal(checks.ok, true);
    assert.deepEqual(Object.keys(checks.selected).sort(), [...REQUIRED_CHECKS].sort());
  });

  it('rejects missing, pending, failed, cancelled, skipped and wrong-app checks with reasons', () => {
    for (const conclusion of ['failure', 'cancelled', 'skipped', 'neutral', undefined]) {
      const checks = successfulChecks();
      checks[0] = successfulCheck('lint', 90, {
        status: conclusion ? 'completed' : 'queued',
        conclusion,
      });
      const result = selectLatestRequiredChecks(checks);
      assert.equal(result.ok, false);
      assert.match(result.errors.join('; '), /lint/);
    }
    const missing = selectLatestRequiredChecks(successfulChecks().slice(1));
    assert.match(missing.errors.join('; '), /lint: missing/);
    const wrongApp = successfulChecks();
    wrongApp[0].app = { id: 999, slug: 'untrusted-app' };
    assert.match(selectLatestRequiredChecks(wrongApp).errors.join('; '), /not GitHub Actions/);
  });

  it('chooses the newest pending run over an older success', () => {
    const checks = [
      ...successfulChecks(),
      successfulCheck('lint', 100, {
        started_at: '2027-01-01T00:00:00Z',
        status: 'in_progress',
        conclusion: null,
      }),
    ];
    const result = selectLatestRequiredChecks(checks);
    assert.equal(result.ok, false);
    assert.match(result.errors.join('; '), /lint: in_progress/);
  });
  it('stops push-triggered evaluation when the current Release PR checks are pending', () => {
    const checks = successfulChecks();
    checks[0] = successfulCheck('lint', 101, {
      status: 'queued',
      conclusion: null,
    });
    const result = selectLatestRequiredChecks(checks);
    assert.equal(result.ok, false);
    assert.match(result.errors.join('; '), /lint: queued\/missing/);
  });
});

describe('canonical Release PR and provenance guards', () => {
  it('accepts a same-repository pending Release PR and rejects spoofed identities', () => {
    assert.equal(
      validateCanonicalReleasePr(releasePr(), {
        repository,
        expectedHeadSha: headSha,
        appBotLogin: 'release-bot[bot]',
      }).ok,
      true,
    );
    const fixtures = [
      [releasePr({ user: { login: 'attacker', type: 'User' } }), /author/],
      [
        releasePr({ head: { ...releasePr().head, repo: { full_name: 'fork/evil' } } }),
        /head repository/,
      ],
      [releasePr({ head: { ...releasePr().head, ref: 'feature' } }), /head ref/],
      [releasePr({ labels: [] }), /label/],
    ];
    for (const [fixture, reason] of fixtures) {
      assert.match(
        validateCanonicalReleasePr(fixture, { repository, expectedHeadSha: headSha }).errors.join(
          '; ',
        ),
        reason,
      );
    }
  });
  it('revalidates the live PR identity immediately before merge', () => {
    assert.doesNotThrow(() =>
      validateReleasePrBeforeMerge(releasePr(), {
        repository,
        expectedHeadSha: headSha,
        appBotLogin: 'release-bot[bot]',
      }),
    );
    const changed = [
      [releasePr({ base: { ...releasePr().base, ref: 'develop' } }), /base ref/],
      [releasePr({ head: { ...releasePr().head, ref: 'feature' } }), /head ref/],
      [releasePr({ head: { ...releasePr().head, sha: sha('d') } }), /head SHA/],
      [releasePr({ draft: true }), /draft/],
      [releasePr({ state: 'closed' }), /not open/],
      [releasePr({ labels: [] }), /label/],
      [releasePr({ user: { login: 'attacker', type: 'User' } }), /author/],
    ];
    for (const [fixture, reason] of changed) {
      assert.throws(
        () =>
          validateReleasePrBeforeMerge(fixture, {
            repository,
            expectedHeadSha: headSha,
            appBotLogin: 'release-bot[bot]',
          }),
        reason,
      );
    }
  });
  it('rejects refetched Release PR title and body changes before merge', () => {
    assert.doesNotThrow(() => validateReleasePrMetadataSnapshot(releasePr(), '9.8.7'));
    assert.throws(
      () =>
        validateReleasePrMetadataSnapshot(
          releasePr({ title: 'chore(main): release 9.8.8' }),
          '9.8.7',
        ),
      /title/,
    );
    assert.throws(
      () => validateReleasePrMetadataSnapshot(releasePr({ body: '---\n## 9.8.8\n---' }), '9.8.7'),
      /body/,
    );
  });
  it('repairs pending labels only for the canonical merged Release PR', () => {
    const pending = decideReleasePrLabelRepair(mergedReleasePr(), {
      repository,
      expectedMergeSha: mergeSha,
      appBotLogin: 'release-bot[bot]',
    });
    assert.deepEqual(pending, {
      action: 'repair',
      add: ['autorelease: tagged'],
      remove: ['autorelease: pending'],
      labels: ['autorelease: pending'],
    });

    const tagged = decideReleasePrLabelRepair(
      mergedReleasePr({ labels: [{ name: 'autorelease: tagged' }] }),
      { repository, expectedMergeSha: mergeSha, appBotLogin: 'release-bot[bot]' },
    );
    assert.deepEqual(tagged, {
      action: 'noop',
      add: [],
      remove: [],
      labels: ['autorelease: tagged'],
    });

    const nonCanonical = decideReleasePrLabelRepair(
      mergedReleasePr({ base: { ...releasePr().base, ref: 'develop' } }),
      { repository, expectedMergeSha: mergeSha, appBotLogin: 'release-bot[bot]' },
    );
    assert.equal(nonCanonical.action, 'refuse');
    assert.match(nonCanonical.errors.join('; '), /base ref/);
  });

  it('accepts only the allowlisted Release Please files', () => {
    const allowlist = [
      'CHANGELOG.md',
      '.release-please-manifest.json',
      'package.json',
      'apps/web/package.json',
    ];
    assert.equal(validateReleaseChangedPaths(allowlist, allowlist), true);
    assert.throws(
      () => validateReleaseChangedPaths([...allowlist, 'apps/web/src/evil.ts'], allowlist),
      /non-Release Please files.*apps\/web\/src\/evil.ts/,
    );
  });

  it('requires a verified web-flow committer when the bot did not sign directly', () => {
    assert.equal(
      isVerifiedWebFlowCommitter({
        login: 'web-flow',
        type: 'User',
        commit: { verification: { verified: true, reason: 'valid' } },
      }),
      true,
    );
    assert.equal(isVerifiedWebFlowCommitter({ login: 'web-flow', type: 'User' }), false);
  });
});

describe('evaluator merge snapshot', () => {
  const workflowRun = {
    event: 'pull_request',
    conclusion: 'success',
    head_branch: RELEASE_BRANCH,
    head_sha: headSha,
    head_repository: { full_name: repository },
  };
  const headCommit = {
    author: { login: 'release-bot[bot]', type: 'Bot' },
    committer: {
      login: 'web-flow',
      type: 'User',
      commit: { verification: { verified: true, reason: 'valid' } },
    },
    parents: [{ sha: mainSha }],
  };
  const args = (overrides = {}) => ({
    workflowRun,
    pr: releasePr(),
    repository,
    mainSha,
    headSha,
    headCommit,
    checkRuns: successfulChecks(),
    changedPaths: ['CHANGELOG.md', '.release-please-manifest.json', 'package.json'],
    allowedPaths: ['CHANGELOG.md', '.release-please-manifest.json', 'package.json'],
    appBotLogin: 'release-bot[bot]',
    ...overrides,
  });

  it('accepts completed native checks and stops pending, moved, and spoofed inputs', () => {
    assert.equal(validateReleasePrSnapshot(args()).checks.ok, true);
    const pending = successfulChecks();
    pending[0] = successfulCheck('lint', 99, { status: 'in_progress', conclusion: null });
    assert.throws(
      () => validateReleasePrSnapshot(args({ checkRuns: pending })),
      /required native PR checks are not complete.*lint/,
    );
    assert.throws(() => validateReleasePrSnapshot(args({ headSha: sha('d') })), /head SHA/);
    assert.throws(
      () => validateReleasePrSnapshot(args({ changedPaths: ['CHANGELOG.md', 'evil.ts'] })),
      /non-Release Please files/,
    );
    assert.throws(
      () =>
        validateReleasePrSnapshot(
          args({
            headCommit: { ...headCommit, committer: { login: 'web-flow', type: 'User' } },
          }),
        ),
      /verified GitHub web-flow/,
    );
  });
  it('rejects a newer pending native check rerun before merge', () => {
    const rerun = successfulChecks();
    rerun[0] = successfulCheck('lint', 99, {
      started_at: '2026-01-01T00:11:00Z',
      status: 'in_progress',
      conclusion: null,
    });
    const latest = selectLatestRequiredChecks(rerun);
    assert.equal(latest.ok, false);
    assert.match(latest.errors.join('; '), /lint: in_progress/);
  });
  it('accepts a stale Release Please base only when the verified merge base is the sole parent', () => {
    const staleBase = sha('d');
    const staleHead = {
      ...headCommit,
      parents: [{ sha: staleBase }],
    };
    assert.doesNotThrow(() =>
      validateReleasePrSnapshot(
        args({
          headCommit: staleHead,
          mergeBaseSha: staleBase,
          allowStaleBase: true,
        }),
      ),
    );
    assert.throws(
      () =>
        validateReleasePrSnapshot(
          args({
            headCommit: staleHead,
            mergeBaseSha: staleBase,
          }),
        ),
      /live main.*verified merge base/,
    );
    assert.throws(
      () =>
        validateReleasePrSnapshot(
          args({
            headCommit: staleHead,
            mergeBaseSha: sha('e'),
            allowStaleBase: true,
          }),
        ),
      /live main.*verified merge base/,
    );
  });
});

describe('merged Release PR selection and idempotency', () => {
  it('accepts a live main tip ahead of the finalized merge SHA', () => {
    const advancedMainSha = sha('d');
    assert.doesNotThrow(() =>
      validateMainReleaseAncestry({
        mergeSha,
        mainSha: advancedMainSha,
        mergeBaseSha: mergeSha,
        status: 'ahead',
      }),
    );
    assert.doesNotThrow(() =>
      validateMainReleaseAncestry({
        mergeSha,
        mainSha: mergeSha,
        mergeBaseSha: mergeSha,
        status: 'identical',
      }),
    );
    assert.throws(
      () =>
        validateMainReleaseAncestry({
          mergeSha,
          mainSha: advancedMainSha,
          mergeBaseSha: mergeSha,
          status: 'behind',
        }),
      /must be identical to or ahead/,
    );
  });
  it('selects the exact merge commit among multiple older tagged PRs', () => {
    const old = mergedReleasePr({
      number: 1,
      merge_commit_sha: sha('d'),
      labels: [{ name: 'autorelease: tagged' }],
    });
    const current = mergedReleasePr({ number: 2 });
    assert.equal(
      selectCanonicalMergedReleasePr([old, current], mergeSha, {
        repository,
        appBotLogin: 'release-bot[bot]',
      }).pr.number,
      2,
    );
  });

  it('rejects duplicate canonical PRs for one merge SHA', () => {
    assert.throws(
      () =>
        selectCanonicalMergedReleasePr(
          [mergedReleasePr(), mergedReleasePr({ number: 43 })],
          mergeSha,
          { repository, appBotLogin: 'release-bot[bot]' },
        ),
      /expected one canonical merged Release PR/,
    );
  });

  it('treats a rerun after an already merged PR as a no-op candidate', () => {
    const result = selectCanonicalMergedReleasePr([mergedReleasePr()], mergeSha, {
      repository,
      appBotLogin: 'release-bot[bot]',
    });
    assert.equal(result.identity.isMerged, true);
  });
  it('treats an ordinary merged PR API response as a non-release push', async () => {
    const mergeSha = sha('d');
    const parentSha = sha('e');
    const headSha = sha('f');
    const pullRequest = {
      number: 27,
      state: 'closed',
      draft: false,
      merged_at: '2026-10-02T17:39:04Z',
      title: 'fix(ci): isolate release tests from repository variables',
      body: '',
      user: { login: 'takano536', type: 'User' },
      labels: [],
      head: {
        ref: 'fix/release-tests-env-isolation',
        sha: headSha,
        repo: { full_name: repository },
      },
      base: { ref: 'main', sha: parentSha, repo: { full_name: repository } },
      merge_commit_sha: mergeSha,
    };
    const blobs = {
      '.release-please-manifest.json': sha('1'),
      'package.json': sha('2'),
      'apps/web/package.json': sha('3'),
      'apps/worker/package.json': sha('4'),
      'packages/db/package.json': sha('5'),
    };
    const fixture = { mergeSha, parentSha, pullRequest, blobs };
    const tempDirectory = await mkdtemp(join(tmpdir(), 'kobako-release-candidate-'));
    const fakeGhPath = join(tempDirectory, 'gh');
    const githubOutputPath = join(tempDirectory, 'github-output');
    await writeFile(githubOutputPath, '', 'utf8');
    const fakeGh = `#!/usr/bin/env node
const fixture = ${JSON.stringify(fixture)};
const args = process.argv.slice(2);
const endpoint = args[1] || '';
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
if (args[0] !== 'api' || args.includes('--method')) {
  fail('unexpected non-read GitHub API invocation');
}
const contentPrefix = 'repos/takano536/kobako/contents/';
const endpointPath = endpoint.split('?')[0];
if (endpointPath.startsWith(contentPrefix)) {
  const relativePath = decodeURIComponent(endpointPath.slice(contentPrefix.length));
  const blob = fixture.blobs[relativePath];
  if (!blob) fail('unexpected contents path: ' + relativePath);
  console.log(JSON.stringify({ sha: blob }));
} else if (endpoint === 'repos/takano536/kobako/commits/' + fixture.mergeSha) {
  console.log(JSON.stringify({ sha: fixture.mergeSha, parents: [{ sha: fixture.parentSha }] }));
} else if (endpoint === 'repos/takano536/kobako/commits/' + fixture.mergeSha + '/pulls?per_page=100') {
  console.log(JSON.stringify([[fixture.pullRequest]]));
} else if (endpoint === 'repos/takano536/kobako/pulls/27') {
  console.log(JSON.stringify(fixture.pullRequest));
} else {
  fail('unexpected GitHub API endpoint: ' + endpoint);
}
`;
    await writeFile(fakeGhPath, fakeGh, 'utf8');
    await chmod(fakeGhPath, 0o755);
    const env = {
      ...process.env,
      GH_TOKEN: 'fixture-token',
      GITHUB_REPOSITORY: repository,
      MERGE_SHA: mergeSha,
      GITHUB_EVENT_NAME: 'push',
      RELEASE_APP_BOT_LOGIN: 'kobako-release[bot]',
      GITHUB_OUTPUT: githubOutputPath,
      PATH: `${tempDirectory}:${process.env.PATH || ''}`,
    };
    try {
      execFileSync(
        process.execPath,
        [
          fileURLToPath(new URL('./release-automation.mjs', import.meta.url)),
          'classify-main-release',
        ],
        { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', env },
      );
      const output = await readFile(githubOutputPath, 'utf8');
      assert.match(output, /^is_release=false$/m);
      assert.match(output, /^pr_number=$/m);
      assert.match(output, /^version=$/m);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });
  it('fails closed when a release version path lacks a canonical PR association', () => {
    assert.deepEqual(
      decideReleaseAssociation({
        changedPaths: ['.release-please-manifest.json'],
        releaseVersionPaths: ['.release-please-manifest.json', 'package.json'],
      }),
      { action: 'refuse', touchesVersionPath: true },
    );
    assert.deepEqual(
      decideReleaseAssociation({
        changedPaths: ['README.md'],
        releaseVersionPaths: ['.release-please-manifest.json', 'package.json'],
      }),
      { action: 'ordinary', touchesVersionPath: false },
    );
    const largeOrdinaryDiff = Array.from(
      { length: 301 },
      (_, index) => `src/generated-${index}.ts`,
    );
    assert.deepEqual(
      decideReleaseAssociation({
        changedPaths: largeOrdinaryDiff,
        releaseVersionPaths: ['.release-please-manifest.json', 'package.json'],
      }),
      { action: 'ordinary', touchesVersionPath: false },
    );
    assert.deepEqual(
      decideReleaseAssociation({
        changedPaths: ['package.json'],
        releaseVersionPaths: ['.release-please-manifest.json', 'package.json'],
        hasCanonical: true,
      }),
      { action: 'release', touchesVersionPath: true },
    );
  });
  it('classifies a human CHANGELOG-only commit as ordinary', () => {
    assert.deepEqual(
      decideReleaseAssociation({
        changedPaths: ['CHANGELOG.md'],
        releaseVersionPaths: ['.release-please-manifest.json', 'package.json'],
      }),
      { action: 'ordinary', touchesVersionPath: false },
    );
  });

  it('classifies conflicts and stale head/base responses as safe stops', () => {
    assert.equal(isSafeMergeConflict('HTTP 409 head changed'), true);
    assert.equal(isSafeMergeConflict('HTTP 405 base changed'), true);
    assert.equal(isSafeMergeConflict('permission denied'), false);
  });
});

describe('release target and image decisions use synthetic fixture versions', () => {
  it('requires tags and Release to target the exact merge SHA', () => {
    assert.equal(
      classifyReleaseTarget({ tagSha: mergeSha, releaseExists: true, expectedSha: mergeSha }),
      'matching',
    );
    assert.equal(
      classifyReleaseTarget({ tagSha: sha('d'), releaseExists: true, expectedSha: mergeSha }),
      'mismatch',
    );
    assert.equal(
      classifyReleaseTarget({ tagSha: null, releaseExists: false, expectedSha: mergeSha }),
      'absent',
    );
  });

  it('publishes versioned and sha tags for a release, and sha/latest for ordinary main push', () => {
    const script = './scripts/compute-release-tags.sh';
    const release = execFileSync('bash', [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REF: 'refs/heads/main',
        GITHUB_SHA: mergeSha,
        RELEASE_CREATED: 'true',
        RELEASE_TAG: 'v9.8.7',
      },
    });
    assert.match(release, /mode=release/);
    assert.match(release, /web_tag=9\.8\.7/);
    assert.match(release, /sha_tag=sha-c{40}/);
    const ordinary = execFileSync('bash', [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REF: 'refs/heads/main',
        GITHUB_SHA: mainSha,
        RELEASE_CREATED: 'false',
        RELEASE_TAG: '',
      },
    });
    assert.match(ordinary, /mode=main/);
    assert.match(ordinary, /promote_latest=true/);
    assert.match(ordinary, /sha_tag=sha-a{40}/);
    assert.match(release, /version=9\.8\.7/);
    assert.match(ordinary, /version=sha-a{40}/);
  });
});

describe('workflow cutover', () => {
  it('uses workflow_run/native pull_request only and has no dispatch or verify-heal path', async () => {
    const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const evaluator = await readFile(
      new URL('../.github/workflows/release-automerge.yml', import.meta.url),
      'utf8',
    );
    const automation = await readFile(new URL('./release-automation.mjs', import.meta.url), 'utf8');
    const releasePleaseJob = ci.slice(
      ci.indexOf('  release_please:'),
      ci.indexOf('  release_finalize:'),
    );
    const releaseFinalizeJob = ci.slice(
      ci.indexOf('  release_finalize:'),
      ci.indexOf('  publish_main:'),
    );
    assert.match(ci, /pull_request:/);
    assert.match(ci, /push:/);
    assert.doesNotMatch(ci, /workflow_dispatch/);
    assert.doesNotMatch(ci, /release-verify|release_pr_merge|dispatch-release-pr/);
    assert.match(evaluator, /workflow_run:/);
    assert.match(evaluator, /workflow_run\.event == 'pull_request'/);
    assert.match(evaluator, /workflow_run\.event == 'push'/);
    assert.match(evaluator, /ref: refs\/heads\/main/);
    assert.doesNotMatch(evaluator, /ref:.*release-please--branches/);
    assert.match(ci, /permission-contents: write/);
    assert.match(ci, /permission-issues: write/);
    assert.match(ci, /permission-pull-requests: write/);
    assert.match(evaluator, /actions: read/);
    assert.match(evaluator, /checks: read/);
    assert.match(evaluator, /contents: read/);
    assert.match(evaluator, /pull-requests: read/);
    assert.match(
      evaluator,
      /group: kobako-release-pr-run-\$\{\{ github\.event\.workflow_run\.id \}\}/,
    );
    assert.match(evaluator, /GH_TOKEN: \$\{\{ github\.token \}\}/);
    assert.match(evaluator, /MERGE_GH_TOKEN: \$\{\{ steps\.release_app\.outputs\.token \}\}/);
    assert.match(evaluator, /permission-contents: write/);
    assert.match(evaluator, /permission-pull-requests: write/);
    assert.doesNotMatch(evaluator, /permission-issues:/);
    assert.match(automation, /tokenEnv: 'MERGE_GH_TOKEN'/);
    assert.match(
      automation,
      /const currentPr = getPullRequest\(repository, pr\.number\)[\s\S]*selectLatestRequiredChecks\(getCheckRuns\(repository, headSha\)\)/,
    );
    assert.match(evaluator, /cancel-in-progress: false/);
    assert.match(ci, /skip-github-release: false/);
    assert.match(ci, /skip-github-pull-request: true/);
    assert.match(ci, /run: node scripts\/verify-release-target\.mjs verify/);
    assert.match(
      releaseFinalizeJob,
      /issues: write[\s\S]*Verify tag and Release target[\s\S]*Ensure canonical Release PR is tagged[\s\S]*repair-release-label/,
    );
    assert.match(ci, /needs\.publish_release\.outputs\.web_tag/);
    assert.match(ci, /needs\.publish_main\.outputs\.web_tag/);
    assert.match(
      ci,
      /publish_main:[\s\S]*?needs\.release_candidate\.outputs\.is_release != 'true'/,
    );
    assert.match(releasePleaseJob, /needs: .*release_finalize/);
    assert.match(releasePleaseJob, /always\(\)/);
    assert.match(
      releasePleaseJob,
      /RELEASE_CANDIDATE: \$\{\{ needs\.release_candidate\.outputs\.is_release \}\}/,
    );
    assert.match(releasePleaseJob, /ref: refs\/heads\/main/);
    assert.match(releasePleaseJob, /skip-github-release: true/);
    assert.match(releasePleaseJob, /contents: read/);
    assert.doesNotMatch(releasePleaseJob, /^\s+issues: write$/m);
    assert.doesNotMatch(releasePleaseJob, /^\s+pull-requests: write$/m);
    assert.doesNotMatch(ci, /STRICT_INSPECT/);
  });
});
