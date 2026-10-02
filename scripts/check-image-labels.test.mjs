import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'vitest';

const script = path.resolve('scripts/check-image-labels.sh');
const revision = 'a'.repeat(40);
const source = 'https://github.com/takano536/kobako';
const version = `sha-${revision}`;

async function runCheck(mode, inspectOutput = '') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kobako-image-labels-'));
  const bin = path.join(directory, 'bin');
  const output = path.join(directory, 'github-output');
  await mkdir(bin);
  await writeFile(
    path.join(bin, 'docker'),
    `#!/bin/sh
case "${mode}" in
  not-found) echo 'manifest unknown' >&2; exit 1 ;;
  reference-not-found) echo 'ERROR: ghcr.io/takano536/kobako-web:sha-a: not found' >&2; exit 1 ;;
  other-reference-not-found) echo 'ERROR: ghcr.io/takano536/kobako-web:other: not found' >&2; exit 1 ;;
  transient) echo 'HTTP 403 Forbidden' >&2; exit 1 ;;
  *) printf '%s\\n' "$FAKE_INSPECT_OUTPUT" ;;
esac
`,
    'utf8',
  );
  await chmod(path.join(bin, 'docker'), 0o755);
  const result = spawnSync('bash', [script], {
    cwd: path.dirname(path.dirname(script)),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_INSPECT_OUTPUT: inspectOutput,
      GITHUB_OUTPUT: output,
      IMAGE: 'ghcr.io/takano536/kobako-web',
      TAG: 'sha-a',
      EXPECTED_SOURCE: source,
      EXPECTED_REVISION: revision,
      EXPECTED_VERSION: version,
      REQUIRE_VERSION: 'true',
    },
  });
  const githubOutput = await readFile(output, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
  await rm(directory, { recursive: true, force: true });
  return { result, githubOutput };
}

const matchingLabels = JSON.stringify({
  config: {
    Labels: {
      'org.opencontainers.image.revision': revision,
      'org.opencontainers.image.source': source,
      'org.opencontainers.image.version': version,
    },
  },
});

const mismatchedLabels = JSON.stringify({
  config: {
    Labels: {
      'org.opencontainers.image.revision': 'b'.repeat(40),
      'org.opencontainers.image.source': source,
      'org.opencontainers.image.version': version,
    },
  },
});

describe('immutable image label inspection', () => {
  it('treats a confirmed not-found tag as absent', async () => {
    const { result, githubOutput } = await runCheck('not-found');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /image tag does not exist/);
    assert.match(githubOutput, /^exists=false$/m);
  });
  it('treats the inspected buildx reference not-found error as absent', async () => {
    const { result, githubOutput } = await runCheck('reference-not-found');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /image tag does not exist/);
    assert.match(githubOutput, /^exists=false$/m);
  });
  it('fails closed for a not-found error naming another image reference', async () => {
    const { result, githubOutput } = await runCheck('other-reference-not-found');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /could not determine whether image tag exists/);
    assert.equal(githubOutput, '');
  });

  it('fails closed for transient or permission inspection errors', async () => {
    const { result, githubOutput } = await runCheck('transient');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /could not determine whether image tag exists/);
    assert.equal(githubOutput, '');
  });

  it('reuses existing tags only when all immutable labels match', async () => {
    const matching = await runCheck('matching', matchingLabels);
    assert.equal(matching.result.status, 0, matching.result.stderr);
    assert.match(matching.result.stdout, /image tag exists with expected OCI labels/);
    assert.match(matching.githubOutput, /^exists=true$/m);

    const mismatched = await runCheck('mismatched', mismatchedLabels);
    assert.notEqual(mismatched.result.status, 0);
    assert.match(mismatched.result.stderr, /unexpected OCI labels/);
    assert.equal(mismatched.githubOutput, '');
  });
});
