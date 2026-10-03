import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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
  decideReleasePrSearchPage,
  decideReleaseFinalizeState,
  decideReleasePleaseState,
  decideStaleReleaseState,
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
const appBotLogin = 'kobako-release[bot]';
const webFlowCommitterId = 19864447;
const realRestHeadCommit = {
  sha: headSha,
  node_id: 'C_kwDOUsf1mdoALmV0YWRhdGE',
  url: `https://api.github.com/repos/${repository}/commits/${headSha}`,
  html_url: `https://github.com/${repository}/commit/${headSha}`,
  comments_url: `https://api.github.com/repos/${repository}/commits/${headSha}/comments`,
  commit: {
    url: `https://api.github.com/repos/${repository}/git/commits/${headSha}`,
    author: {
      name: appBotLogin,
      email: '337035226+kobako-release[bot]@users.noreply.github.com',
      date: '2026-10-02T18:02:44Z',
    },
    committer: {
      name: 'GitHub',
      email: 'noreply@github.com',
      date: '2026-10-02T18:02:44Z',
    },
    message: 'chore(main): release 0.4.1',
    tree: {
      sha: sha('1'),
      url: `https://api.github.com/repos/${repository}/git/trees/${sha('1')}`,
    },
    comment_count: 0,
    verification: {
      verified: true,
      reason: 'valid',
      signature: 'fixture-signature',
      payload: 'fixture-payload',
      verified_at: '2026-10-02T18:02:45Z',
    },
  },
  author: {
    login: appBotLogin,
    id: 337035226,
    node_id: 'BOT_kgDOFBa_2g',
    avatar_url: 'https://avatars.githubusercontent.com/u/337035226?v=4',
    gravatar_id: '',
    url: `https://api.github.com/users/${encodeURIComponent(appBotLogin)}`,
    html_url: 'https://github.com/apps/kobako-release',
    followers_url: 'https://api.github.com/users/kobako-release[bot]/followers',
    following_url: 'https://api.github.com/users/kobako-release[bot]/following{/other_user}',
    gists_url: 'https://api.github.com/users/kobako-release[bot]/gists{/gist_id}',
    starred_url: 'https://api.github.com/users/kobako-release[bot]/starred{/owner}{/repo}',
    subscriptions_url: 'https://api.github.com/users/kobako-release/subscriptions',
    organizations_url: 'https://api.github.com/users/kobako-release/orgs',
    repos_url: 'https://api.github.com/users/kobako-release/repos',
    events_url: 'https://api.github.com/users/kobako-release/events{/privacy}',
    received_events_url: 'https://api.github.com/users/kobako-release/received_events',
    type: 'Bot',
    site_admin: false,
  },
  committer: {
    login: 'web-flow',
    id: webFlowCommitterId,
    node_id: 'MDQ6VXNlcjE5ODY0NDQ3',
    avatar_url: 'https://avatars.githubusercontent.com/u/19864447?v=4',
    gravatar_id: '',
    url: 'https://api.github.com/users/web-flow',
    html_url: 'https://github.com/web-flow',
    followers_url: 'https://api.github.com/users/web-flow/followers',
    following_url: 'https://api.github.com/users/web-flow/following{/other_user}',
    gists_url: 'https://api.github.com/users/web-flow/gists{/gist_id}',
    starred_url: 'https://api.github.com/users/web-flow/starred{/owner}{/repo}',
    subscriptions_url: 'https://api.github.com/users/web-flow/subscriptions',
    organizations_url: 'https://api.github.com/users/web-flow/orgs',
    repos_url: 'https://api.github.com/users/web-flow/repos',
    events_url: 'https://api.github.com/users/web-flow/events{/privacy}',
    received_events_url: 'https://api.github.com/users/web-flow/received_events',
    type: 'User',
    site_admin: false,
  },
  parents: [
    {
      sha: mainSha,
      url: `https://api.github.com/repos/${repository}/commits/${mainSha}`,
      html_url: `https://github.com/${repository}/commit/${mainSha}`,
    },
  ],
  stats: { additions: 1, deletions: 0, total: 1 },
  files: [
    {
      sha: sha('2'),
      filename: 'CHANGELOG.md',
      status: 'modified',
      additions: 1,
      deletions: 0,
      changes: 1,
      blob_url: `https://github.com/${repository}/blob/${headSha}/CHANGELOG.md`,
      raw_url: `https://github.com/${repository}/raw/${headSha}/CHANGELOG.md`,
      contents_url: `https://api.github.com/repos/${repository}/contents/CHANGELOG.md?ref=${headSha}`,
      patch: '@@ -1 +1 @@',
    },
  ],
};

const clone = (value) => structuredClone(value);
const realRestMergeCommit = {
  ...clone(realRestHeadCommit),
  sha: mergeSha,
  node_id: 'C_kwDOUsf1mdoALmVyZ2U',
  url: `https://api.github.com/repos/${repository}/commits/${mergeSha}`,
  html_url: `https://github.com/${repository}/commit/${mergeSha}`,
  commit: {
    ...clone(realRestHeadCommit.commit),
    url: `https://api.github.com/repos/${repository}/git/commits/${mergeSha}`,
    author: {
      name: appBotLogin,
      email: '337035226+kobako-release[bot]@users.noreply.github.com',
      date: '2026-10-02T18:10:00Z',
    },
    committer: {
      name: 'GitHub',
      email: 'noreply@github.com',
      date: '2026-10-02T18:10:00Z',
    },
    message: 'chore(main): release 0.4.1 (#29)',
    tree: {
      sha: sha('6'),
      url: `https://api.github.com/repos/${repository}/git/trees/${sha('6')}`,
    },
    verification: {
      verified: true,
      reason: 'valid',
      signature: 'fixture-merge-signature',
      payload: 'fixture-merge-payload',
      verified_at: '2026-10-02T18:10:01Z',
    },
  },
  author: clone(realRestHeadCommit.author),
  committer: clone(realRestHeadCommit.committer),
  parents: [
    {
      sha: mainSha,
      url: `https://api.github.com/repos/${repository}/commits/${mainSha}`,
      html_url: `https://github.com/${repository}/commit/${mainSha}`,
    },
  ],
  files: [
    { filename: 'CHANGELOG.md', status: 'modified' },
    { filename: '.release-please-manifest.json', status: 'modified' },
    { filename: 'package.json', status: 'modified' },
    { filename: 'apps/web/package.json', status: 'modified' },
    { filename: 'apps/worker/package.json', status: 'modified' },
    { filename: 'packages/db/package.json', status: 'modified' },
  ],
};

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
function realRestMergedReleasePr(overrides = {}) {
  const repositoryObject = {
    id: 123456789,
    node_id: 'R_kgDOUsf1mdo',
    name: 'kobako',
    full_name: repository,
    private: true,
    owner: { login: 'takano536', id: 123456, type: 'User' },
    html_url: `https://github.com/${repository}`,
    default_branch: 'main',
  };
  return mergedReleasePr({
    id: 3000000029,
    node_id: 'PR_kwDOUsf1mdo5',
    number: 29,
    url: `https://api.github.com/repos/${repository}/pulls/29`,
    html_url: `https://github.com/${repository}/pull/29`,
    title: 'chore(main): release 0.4.1',
    body: '---\n## 0.4.1\n---',
    user: clone(realRestHeadCommit.author),
    author_association: 'CONTRIBUTOR',
    labels: [
      {
        id: 4000000029,
        node_id: 'LA_kwDOUsf1mdo',
        url: `https://api.github.com/repos/${repository}/labels/autorelease%3A%20pending`,
        name: 'autorelease: pending',
        color: 'ededed',
      },
    ],
    head: {
      label: `${repository}: ${RELEASE_BRANCH}`,
      ref: RELEASE_BRANCH,
      sha: headSha,
      repo: repositoryObject,
    },
    base: {
      label: `${repository}: main`,
      ref: 'main',
      sha: mainSha,
      repo: repositoryObject,
    },
    merged: true,
    merged_by: clone(realRestHeadCommit.author),
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
async function makeEvaluatorCommandFake({ checks = successfulChecks() } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'kobako-release-evaluator-'));
  const fixturePath = join(directory, 'fixture.json');
  const fakeGhPath = join(directory, 'gh');
  const logPath = join(directory, 'gh.log');
  const mergedMarker = join(directory, 'merged');
  const packagePaths = [
    'package.json',
    'apps/web/package.json',
    'apps/worker/package.json',
    'packages/db/package.json',
  ];
  const packageBase = { name: 'fixture', version: '0.4.0', scripts: { test: 'fixture' } };
  const packageHead = { ...packageBase, version: '0.4.1' };
  const jsonFile = (value, blob) => ({
    type: 'file',
    encoding: 'base64',
    content: Buffer.from(JSON.stringify(value)).toString('base64'),
    sha: blob,
  });
  const textFile = (value, blob) => ({
    type: 'file',
    encoding: 'base64',
    content: Buffer.from(value).toString('base64'),
    sha: blob,
  });
  const changelogBase = '# Changelog\n\n## 0.4.0\n\nHistory\n';
  const changelogHead = '# Changelog\n\n## 0.4.1\n\nRelease\n\n## 0.4.0\n\nHistory\n';
  const contents = {};
  for (const relativePath of packagePaths) {
    contents[`${relativePath}:${mainSha}`] = jsonFile(packageBase, sha('1'));
    contents[`${relativePath}:${headSha}`] = jsonFile(packageHead, sha('2'));
    contents[`${relativePath}:${mergeSha}`] = jsonFile(packageHead, sha('2'));
  }
  for (const ref of [mainSha, headSha, mergeSha]) {
    contents[`.release-please-manifest.json:${ref}`] = jsonFile(
      { '.': ref === mainSha ? '0.4.0' : '0.4.1' },
      sha('3'),
    );
  }
  contents[`CHANGELOG.md:${mainSha}`] = textFile(changelogBase, sha('4'));
  contents[`CHANGELOG.md:${headSha}`] = textFile(changelogHead, sha('5'));
  contents[`CHANGELOG.md:${mergeSha}`] = textFile(changelogHead, sha('5'));

  const openPr = releasePr({
    title: 'chore(main): release 0.4.1',
    body: '---\n## 0.4.1\n---',
    user: { login: appBotLogin, id: 337035226, type: 'Bot' },
  });
  const mergedPr = {
    ...openPr,
    state: 'closed',
    merged: true,
    merged_at: '2026-10-02T18:10:00Z',
    merge_commit_sha: mergeSha,
  };
  const fixture = {
    workflowRun: {
      name: 'CI',
      event: 'pull_request',
      conclusion: 'success',
      head_branch: RELEASE_BRANCH,
      head_sha: headSha,
      head_repository: { full_name: repository },
    },
    openPr,
    mergedPr,
    headCommit: clone(realRestHeadCommit),
    compare: {
      status: 'ahead',
      merge_base_commit: { sha: mainSha },
      files: [
        { filename: 'CHANGELOG.md' },
        { filename: '.release-please-manifest.json' },
        { filename: 'package.json' },
        { filename: 'apps/web/package.json' },
        { filename: 'apps/worker/package.json' },
        { filename: 'packages/db/package.json' },
      ],
    },
    checks,
    contents,
    merge: { merged: true, sha: mergeSha },
  };
  await writeFile(fixturePath, JSON.stringify(fixture), 'utf8');
  await writeFile(
    fakeGhPath,
    `#!/usr/bin/env node
import fs from 'node:fs';

const fixture = JSON.parse(fs.readFileSync(process.env.FIXTURE_PATH, 'utf8'));
const args = process.argv.slice(2);
const endpoint = args[1] || '';
fs.appendFileSync(process.env.FAKE_GH_LOG, \`\${args.join(' ')}\\n\`);
const fail = (message) => {
  process.stderr.write(message + '\\n');
  process.exit(1);
};
const output = (value) => process.stdout.write(JSON.stringify(value));
if (args[0] !== 'api') fail('unexpected gh invocation');

if (endpoint === 'repos/${repository}/actions/runs/99') {
  output(fixture.workflowRun);
} else if (endpoint === 'repos/${repository}/git/ref/heads/main') {
  output({ object: { sha: '${mainSha}' } });
} else if (endpoint === 'repos/${repository}/commits/${headSha}') {
  output(fixture.headCommit);
} else if (endpoint === 'repos/${repository}/commits/${headSha}/pulls?per_page=100') {
  output([[fixture.openPr]]);
} else if (endpoint === 'repos/${repository}/commits/${headSha}/check-runs?per_page=100') {
  output([{ check_runs: fixture.checks }]);
} else if (endpoint.startsWith('repos/${repository}/compare/${mainSha}...${headSha}?')) {
  output(fixture.compare);
} else if (endpoint === 'repos/${repository}/pulls/42') {
  output(fs.existsSync(process.env.FAKE_MERGED) ? fixture.mergedPr : fixture.openPr);
} else if (endpoint === 'repos/${repository}/pulls/42/merge') {
  if (!args.includes('--method') || !args.includes('PUT')) fail('merge request was not PUT');
  fs.writeFileSync(process.env.FAKE_MERGED, '');
  output(fixture.merge);
} else if (endpoint.startsWith('repos/${repository}/contents/')) {
  const [relativePath, query = ''] = endpoint
    .slice('repos/${repository}/contents/'.length)
    .split('?');
  const ref = new URLSearchParams(query).get('ref');
  const value = fixture.contents[\`\${relativePath}:\${ref}\`];
  if (!value) fail(\`missing content fixture for \${relativePath} at \${ref}\`);
  output(value);
} else {
  fail(\`unexpected GitHub API endpoint: \${endpoint}\`);
}
`,
    'utf8',
  );
  await chmod(fakeGhPath, 0o755);
  return { directory, fixturePath, logPath, mergedMarker };
}
async function makeClassificationCommandFake({
  pullRequest = realRestMergedReleasePr(),
  mergeCommit = realRestMergeCommit,
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'kobako-release-classify-'));
  const fixturePath = join(directory, 'fixture.json');
  const fakeGhPath = join(directory, 'gh');
  const githubOutputPath = join(directory, 'github-output');
  const packagePaths = [
    'package.json',
    'apps/web/package.json',
    'apps/worker/package.json',
    'packages/db/package.json',
  ];
  const packageBase = { name: 'fixture', version: '0.4.0', scripts: { test: 'fixture' } };
  const packageHead = { ...packageBase, version: '0.4.1' };
  const jsonFile = (value, blob) => ({
    type: 'file',
    encoding: 'base64',
    content: Buffer.from(JSON.stringify(value)).toString('base64'),
    sha: blob,
  });
  const textFile = (value, blob) => ({
    type: 'file',
    encoding: 'base64',
    content: Buffer.from(value).toString('base64'),
    sha: blob,
  });
  const contents = {};
  for (const relativePath of packagePaths) {
    contents[`${relativePath}:${mainSha}`] = jsonFile(packageBase, sha('1'));
    contents[`${relativePath}:${mergeSha}`] = jsonFile(packageHead, sha('2'));
  }
  contents[`.release-please-manifest.json:${mainSha}`] = jsonFile({ '.': '0.4.0' }, sha('3'));
  contents[`.release-please-manifest.json:${mergeSha}`] = jsonFile({ '.': '0.4.1' }, sha('4'));
  contents[`CHANGELOG.md:${mainSha}`] = textFile('# Changelog\n\n## 0.4.0\n\nHistory\n', sha('5'));
  contents[`CHANGELOG.md:${mergeSha}`] = textFile(
    '# Changelog\n\n## 0.4.1\n\nRelease\n\n## 0.4.0\n\nHistory\n',
    sha('6'),
  );
  const fixture = {
    mergeCommit,
    pullRequest,
    compare: {
      status: 'ahead',
      merge_base_commit: { sha: mainSha },
      files: [
        { filename: 'CHANGELOG.md' },
        { filename: '.release-please-manifest.json' },
        { filename: 'package.json' },
        { filename: 'apps/web/package.json' },
        { filename: 'apps/worker/package.json' },
        { filename: 'packages/db/package.json' },
      ],
    },
    contents,
  };
  await writeFile(fixturePath, JSON.stringify(fixture), 'utf8');
  await writeFile(githubOutputPath, '', 'utf8');
  await writeFile(
    fakeGhPath,
    `#!/usr/bin/env node
import fs from 'node:fs';

const fixture = JSON.parse(fs.readFileSync(process.env.FIXTURE_PATH, 'utf8'));
const args = process.argv.slice(2);
const endpoint = args[1] || '';
const fail = (message) => {
  process.stderr.write(message + '\\n');
  process.exit(1);
};
const output = (value) => process.stdout.write(JSON.stringify(value));
if (args[0] !== 'api' || args.includes('--method')) fail('unexpected non-read GitHub API invocation');

if (endpoint === 'repos/${repository}/commits/${mergeSha}') {
  output(fixture.mergeCommit);
} else if (endpoint === 'repos/${repository}/commits/${mergeSha}/pulls?per_page=100') {
  output([[fixture.pullRequest]]);
} else if (endpoint === 'repos/${repository}/pulls/${pullRequest.number}') {
  output(fixture.pullRequest);
} else if (endpoint.startsWith('repos/${repository}/compare/${mainSha}...${mergeSha}?')) {
  output(fixture.compare);
} else if (endpoint.startsWith('repos/${repository}/contents/')) {
  const [relativePath, query = ''] = endpoint
    .slice('repos/${repository}/contents/'.length)
    .split('?');
  const ref = new URLSearchParams(query).get('ref');
  const value = fixture.contents[\`\${relativePath}:\${ref}\`];
  if (!value) fail(\`missing content fixture for \${relativePath} at \${ref}\`);
  output(value);
} else {
  fail(\`unexpected GitHub API endpoint: \${endpoint}\`);
}
`,
    'utf8',
  );
  await chmod(fakeGhPath, 0o755);
  return {
    directory,
    fixturePath,
    githubOutputPath,
    env: {
      ...process.env,
      FIXTURE_PATH: fixturePath,
      PATH: `${directory}:${process.env.PATH || ''}`,
      GH_TOKEN: 'fixture-token',
      GITHUB_REPOSITORY: repository,
      MERGE_SHA: mergeSha,
      GITHUB_EVENT_NAME: 'push',
      RELEASE_APP_BOT_LOGIN: appBotLogin,
      GITHUB_OUTPUT: githubOutputPath,
    },
  };
}

function evaluatorCommandEnv(fake) {
  return {
    ...process.env,
    PATH: `${fake.directory}:${process.env.PATH || ''}`,
    FIXTURE_PATH: fake.fixturePath,
    FAKE_GH_LOG: fake.logPath,
    FAKE_MERGED: fake.mergedMarker,
    GH_TOKEN: 'fixture-read-token',
    MERGE_GH_TOKEN: 'fixture-merge-token',
    GITHUB_REPOSITORY: repository,
    WORKFLOW_RUN_ID: '99',
    WORKFLOW_HEAD_SHA: headSha,
    WORKFLOW_HEAD_BRANCH: RELEASE_BRANCH,
    RELEASE_APP_BOT_LOGIN: appBotLogin,
  };
}

describe('evaluate-release-pr command API boundary', () => {
  it('passes the validated head SHA to a squash merge', async () => {
    const fake = await makeEvaluatorCommandFake();
    try {
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL('./release-automation.mjs', import.meta.url)),
          'evaluate-release-pr',
        ],
        {
          cwd: fileURLToPath(new URL('../', import.meta.url)),
          encoding: 'utf8',
          env: evaluatorCommandEnv(fake),
        },
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const invocations = await readFile(fake.logPath, 'utf8');
      assert.match(
        invocations,
        new RegExp(
          `pulls/42/merge --method PUT --raw-field sha=${headSha} --raw-field merge_method=squash`,
        ),
      );
      assert.equal(existsSync(fake.mergedMarker), true);
    } finally {
      await rm(fake.directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['pending', { status: 'in_progress', conclusion: null }],
    ['failed', { status: 'completed', conclusion: 'failure' }],
  ])('does not PUT the merge when the latest lint check is %s', async (_name, override) => {
    const checks = successfulChecks();
    checks[0] = successfulCheck('lint', 99, override);
    const fake = await makeEvaluatorCommandFake({ checks });
    try {
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL('./release-automation.mjs', import.meta.url)),
          'evaluate-release-pr',
        ],
        {
          cwd: fileURLToPath(new URL('../', import.meta.url)),
          encoding: 'utf8',
          env: evaluatorCommandEnv(fake),
        },
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /required native PR checks are not complete:.*lint/);
      const invocations = await readFile(fake.logPath, 'utf8');
      assert.doesNotMatch(invocations, /pulls\/42\/merge/);
      assert.equal(existsSync(fake.mergedMarker), false);
    } finally {
      await rm(fake.directory, { recursive: true, force: true });
    }
  });
});

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
  it('distinguishes a stale merged pending Release PR from a normal no-change state', () => {
    const stale = decideStaleReleaseState([mergedReleasePr()], {
      repository,
      appBotLogin: 'release-bot[bot]',
    });
    assert.deepEqual(stale, {
      action: 'stale',
      pendingMerged: [{ number: 42, mergeSha, tag: 'v9.8.7' }],
    });

    const clear = decideStaleReleaseState(
      [mergedReleasePr({ labels: [{ name: 'autorelease: tagged' }] })],
      { repository, appBotLogin: 'release-bot[bot]' },
    );
    assert.deepEqual(clear, { action: 'clear', pendingMerged: [] });
  });
  it('classifies clear, deferred, stale, and unknown finalization states', () => {
    const pending = decideStaleReleaseState([mergedReleasePr()], {
      repository,
      appBotLogin: 'release-bot[bot]',
    }).pendingMerged;
    const activeRun = {
      name: 'CI',
      event: 'push',
      head_branch: 'main',
      head_sha: mergeSha,
      status: 'in_progress',
    };
    assert.equal(
      decideReleasePleaseState({
        pendingMerged: [],
        workflowStates: [],
      }).state,
      'clear',
    );
    assert.equal(
      decideReleaseFinalizeState({ run: activeRun, releaseFinalizeJob: null }),
      'deferred',
    );
    assert.equal(
      decideReleasePleaseState({
        pendingMerged: pending,
        workflowStates: [{ mergeSha, run: activeRun, releaseFinalizeJob: null }],
      }).state,
      'deferred',
    );
    const completedRun = { ...activeRun, status: 'completed', conclusion: 'success' };
    const completedJob = { name: 'release-finalize', status: 'completed', conclusion: 'success' };
    assert.equal(
      decideReleaseFinalizeState({ run: completedRun, releaseFinalizeJob: completedJob }),
      'stale',
    );
    assert.equal(
      decideReleasePleaseState({
        pendingMerged: pending,
        workflowStates: [{ mergeSha, run: completedRun, releaseFinalizeJob: completedJob }],
      }).state,
      'stale',
    );
    assert.equal(
      decideReleasePleaseState({
        pendingMerged: pending,
        workflowStates: [{ mergeSha, run: completedRun, releaseFinalizeJob: null }],
      }).state,
      'unknown',
    );
  });

  it('stops bounded Release PR pagination before silently dropping pages', () => {
    assert.equal(decideReleasePrSearchPage({ page: 1, resultCount: 100, maxPages: 3 }), 'continue');
    assert.equal(
      decideReleasePrSearchPage({ page: 3, resultCount: 100, maxPages: 3 }),
      'exhausted',
    );
    assert.equal(decideReleasePrSearchPage({ page: 3, resultCount: 99, maxPages: 3 }), 'complete');
  });

  it('runs post-merge Release PR and commit validation through classify-main-release', async () => {
    const runClassification = async (pullRequest) => {
      const fake = await makeClassificationCommandFake({ pullRequest });
      try {
        const result = spawnSync(
          process.execPath,
          [
            fileURLToPath(new URL('./release-automation.mjs', import.meta.url)),
            'classify-main-release',
          ],
          {
            cwd: fileURLToPath(new URL('../', import.meta.url)),
            encoding: 'utf8',
            env: fake.env,
          },
        );
        return {
          result,
          output: await readFile(fake.githubOutputPath, 'utf8'),
        };
      } finally {
        await rm(fake.directory, { recursive: true, force: true });
      }
    };

    const accepted = await runClassification(realRestMergedReleasePr());
    assert.equal(accepted.result.status, 0, accepted.result.stderr || accepted.result.stdout);
    assert.match(accepted.output, /^is_release=true$/m);
    assert.match(accepted.output, /^pr_number=29$/m);
    assert.match(accepted.output, /^version=0\.4\.1$/m);

    const wrongMergeActor = await runClassification(
      realRestMergedReleasePr({
        merged_by: { ...realRestHeadCommit.author, login: 'attacker[bot]' },
      }),
    );
    assert.notEqual(wrongMergeActor.result.status, 0);
    assert.match(
      `${wrongMergeActor.result.stderr}${wrongMergeActor.result.stdout}`,
      /merged Release PR actor is not the configured release App bot: attacker\[bot\]/,
    );

    const wrongPrAuthor = await runClassification(
      realRestMergedReleasePr({
        user: { ...realRestHeadCommit.author, login: 'attacker[bot]' },
      }),
    );
    assert.notEqual(wrongPrAuthor.result.status, 0);
    assert.match(
      `${wrongPrAuthor.result.stderr}${wrongPrAuthor.result.stdout}`,
      /no canonical merged Release PR.*author is not the configured release App bot/,
    );
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

  it('accepts the real REST commit shape for a verified web-flow committer', () => {
    assert.equal(isVerifiedWebFlowCommitter(realRestHeadCommit), true);
    const oldNestedShape = clone(realRestHeadCommit);
    delete oldNestedShape.commit.verification;
    oldNestedShape.committer.commit = {
      verification: { verified: true, reason: 'valid' },
    };
    assert.equal(isVerifiedWebFlowCommitter(oldNestedShape), false);
    assert.equal(isVerifiedWebFlowCommitter({ ...realRestHeadCommit, committer: null }), false);
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
  const headCommit = clone(realRestHeadCommit);
  const args = (overrides = {}) => ({
    workflowRun,
    pr: releasePr({
      user: { login: appBotLogin, id: 337035226, type: 'Bot' },
    }),
    repository,
    mainSha,
    headSha,
    headCommit,
    checkRuns: successfulChecks(),
    changedPaths: ['CHANGELOG.md', '.release-please-manifest.json', 'package.json'],
    allowedPaths: ['CHANGELOG.md', '.release-please-manifest.json', 'package.json'],
    appBotLogin,
    ...overrides,
  });

  it('accepts the real REST App-author/web-flow commit and rejects a pending check', () => {
    assert.equal(validateReleasePrSnapshot(args()).checks.ok, true);
    const pending = successfulChecks();
    pending[0] = successfulCheck('lint', 99, { status: 'in_progress', conclusion: null });
    assert.throws(
      () => validateReleasePrSnapshot(args({ checkRuns: pending })),
      /required native PR checks are not complete.*lint/,
    );
  });
  it.each([
    [
      'non-App login',
      (commit) => {
        commit.author.login = 'kobako-release';
      },
    ],
    [
      'lookalike login',
      (commit) => {
        commit.author.login = 'kobako-release[bot]-x';
      },
    ],
    [
      'App login with User type',
      (commit) => {
        commit.author.type = 'User';
      },
    ],
  ])('rejects a real REST commit with a spoofed head author: %s', (_name, mutate) => {
    const invalidCommit = clone(headCommit);
    mutate(invalidCommit);
    assert.throws(
      () => validateReleasePrSnapshot(args({ headCommit: invalidCommit })),
      /head author is not the configured release App bot/,
    );
  });

  it.each([
    [
      'committer login',
      (commit) => {
        commit.committer.login = 'web-flow-bot';
      },
      /head committer\.login must be web-flow/,
    ],
    [
      'committer case',
      (commit) => {
        commit.committer.login = 'Web-Flow';
      },
      /head committer\.login must be web-flow/,
    ],
    [
      'committer id',
      (commit) => {
        commit.committer.id = 123;
      },
      /head committer\.id must be 19864447/,
    ],
    [
      'committer string id',
      (commit) => {
        commit.committer.id = '19864447';
      },
      /head committer\.id must be 19864447/,
    ],
    [
      'committer type',
      (commit) => {
        commit.committer.type = 'Bot';
      },
      /head committer\.type must be User/,
    ],
    [
      'committer array',
      (commit) => {
        commit.committer = [];
      },
      /head committer object is missing/,
    ],
    [
      'missing committer field',
      (commit) => {
        delete commit.committer;
      },
      /head committer object is missing/,
    ],
    [
      'missing committer',
      (commit) => {
        commit.committer = null;
      },
      /head committer object is missing/,
    ],
    [
      'raw committer',
      (commit) => {
        delete commit.commit.committer;
      },
      /head commit\.committer object is missing/,
    ],
    [
      'raw committer array',
      (commit) => {
        commit.commit.committer = [];
      },
      /head commit\.committer object is missing/,
    ],
    [
      'missing raw committer name',
      (commit) => {
        delete commit.commit.committer.name;
      },
      /head commit\.committer\.name must be GitHub/,
    ],
    [
      'missing raw committer email',
      (commit) => {
        delete commit.commit.committer.email;
      },
      /head commit\.committer\.email must be noreply@github\.com/,
    ],
    [
      'raw committer name',
      (commit) => {
        commit.commit.committer.name = 'GitHub ';
      },
      /head commit\.committer\.name must be GitHub/,
    ],
    [
      'raw committer email',
      (commit) => {
        commit.commit.committer.email = 'noreply@github.com.evil';
      },
      /head commit\.committer\.email must be noreply@github\.com/,
    ],
    [
      'verification flag',
      (commit) => {
        commit.commit.verification.verified = false;
      },
      /head commit\.verification\.verified must be true/,
    ],
    [
      'verification string',
      (commit) => {
        commit.commit.verification.verified = 'true';
      },
      /head commit\.verification\.verified must be true/,
    ],
    [
      'verification array',
      (commit) => {
        commit.commit.verification = [];
      },
      /head commit\.verification object is missing/,
    ],
    [
      'verification reason',
      (commit) => {
        commit.commit.verification.reason = 'unsigned';
      },
      /head commit\.verification\.reason must be valid/,
    ],
    [
      'bad email verification reason',
      (commit) => {
        commit.commit.verification.reason = 'bad_email';
      },
      /head commit\.verification\.reason must be valid/,
    ],
    [
      'unknown key verification reason',
      (commit) => {
        commit.commit.verification.reason = 'unknown_key';
      },
      /head commit\.verification\.reason must be valid/,
    ],
    [
      'missing verification',
      (commit) => {
        delete commit.commit.verification;
      },
      /head commit\.verification object is missing/,
    ],
    [
      'misnested verification',
      (commit) => {
        delete commit.commit.verification;
        commit.committer.commit = { verification: { verified: true, reason: 'valid' } };
      },
      /head commit\.verification object is missing/,
    ],
  ])('rejects a web-flow commit with an invalid %s condition', (_name, mutate, error) => {
    const invalidCommit = clone(headCommit);
    mutate(invalidCommit);
    assert.throws(() => validateReleasePrSnapshot(args({ headCommit: invalidCommit })), error);
  });
  it.each([
    [
      'PR author',
      { pr: releasePr({ user: { login: 'attacker', type: 'User' } }) },
      /author is not the configured release App bot/,
    ],
    [
      'head repository',
      {
        pr: releasePr({
          user: { login: appBotLogin, type: 'Bot' },
          head: { ...releasePr().head, repo: { full_name: 'fork/evil' } },
        }),
      },
      /head repository is not the canonical repository/,
    ],
    [
      'base ref',
      {
        pr: releasePr({
          user: { login: appBotLogin, type: 'Bot' },
          base: { ...releasePr().base, ref: 'develop' },
        }),
      },
      /base ref is not main/,
    ],
    [
      'base repository',
      {
        pr: releasePr({
          user: { login: appBotLogin, type: 'Bot' },
          base: { ...releasePr().base, repo: { full_name: 'fork/evil' } },
        }),
      },
      /base repository is not the canonical repository/,
    ],
    [
      'App author type',
      { pr: releasePr({ user: { login: appBotLogin, type: 'User' } }) },
      /author is not the configured release App bot/,
    ],
    [
      'changed file',
      { changedPaths: ['CHANGELOG.md', 'evil.ts'] },
      /non-Release Please files.*evil\.ts/,
    ],
    [
      'head SHA',
      {
        headSha: sha('d'),
        workflowRun: { ...workflowRun, head_sha: sha('d') },
      },
      /head SHA does not match expected/,
    ],
  ])('rejects a validly signed commit when %s is spoofed', (_name, overrides, error) => {
    assert.throws(() => validateReleasePrSnapshot(args(overrides)), error);
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
    assert.match(releaseFinalizeJob, /pull-requests: write/);
    assert.match(
      releaseFinalizeJob,
      /continue-on-error: true[\s\S]*RELEASE_ACTION_OUTCOME: \$\{\{ steps\.release\.outcome \}\}/,
    );
    assert.match(
      releasePleaseJob,
      /run: node scripts\/release-automation\.mjs check-stale-release/,
    );
    assert.match(automation, /decideStaleReleaseState/);
    assert.match(automation, /decideReleasePleaseState/);
    assert.match(automation, /MAX_RELEASE_PR_PAGES/);
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
    assert.match(releasePleaseJob, /actions: read/);
    assert.match(releasePleaseJob, /id: release_state/);
    assert.match(releasePleaseJob, /ACTIONS_GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
    assert.match(releasePleaseJob, /steps\.release_state\.outputs\.release_state != 'deferred'/);
    assert.doesNotMatch(ci, /STRICT_INSPECT/);
  });
});
