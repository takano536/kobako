#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SEMVER_TAG_PATTERN = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export function parseReleaseTag(tag) {
  if (typeof tag !== 'string') return null;
  const match = SEMVER_TAG_PATTERN.exec(tag);
  if (!match || tag === 'v0.1.0') return null;
  return { tag, version: tag.slice(1) };
}

export function classifyReleaseTarget({ tagSha, releaseExists, expectedSha }) {
  const target = typeof expectedSha === 'string' ? expectedSha.toLowerCase() : '';
  const hasTag = typeof tagSha === 'string' && tagSha.length > 0;
  if (!hasTag && !releaseExists) return 'absent';
  if (hasTag && tagSha !== target) return 'mismatch';
  if (hasTag && releaseExists) return 'matching';
  return 'incomplete';
}
export function decideReleaseFinalizeOutcome({ actionOutcome = 'success', targetState } = {}) {
  if (targetState !== 'matching') return 'fail';
  if (actionOutcome === 'failure') return 'tolerated-failure';
  if (actionOutcome === 'success' || actionOutcome === 'skipped') return 'success';
  return 'fail';
}
export function validateReleaseObject(release, tag, expectedSha) {
  if (!release || release.draft !== false || release.prerelease !== false) {
    throw new Error(`release ${tag} must be published (draft=false, prerelease=false)`);
  }
  if (release.tag_name !== tag) {
    throw new Error(`release tag_name ${release.tag_name || 'missing'} does not equal ${tag}`);
  }
  const targetCommitish =
    typeof release.target_commitish === 'string' ? release.target_commitish.toLowerCase() : '';
  if (!SHA_PATTERN.test(targetCommitish) || targetCommitish !== expectedSha.toLowerCase()) {
    throw new Error(
      `release ${tag} target_commitish ${release.target_commitish || 'missing'} does not equal ${expectedSha}`,
    );
  }
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function api(repository, path, allowNotFound = false) {
  const result = run('gh', ['api', `repos/${repository}/${path}`], {
    allowFailure: allowNotFound,
  });
  if (result.status !== 0) {
    const message = `${result.stdout}\n${result.stderr}`;
    if (allowNotFound && /(?:404|not found)/i.test(message)) return null;
    throw new Error(`gh api ${path} failed: ${message}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`could not parse GitHub API response for ${path}: ${error.message}`, {
      cause: error,
    });
  }
}

function emit(key, value) {
  const line = `${key}=${value}`;
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`, 'utf8');
  return line;
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function packageVersion() {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error('package.json version is missing');
  }
  return packageJson.version;
}

function resolveTag() {
  const suppliedTag = process.env.RELEASE_TAG || `v${packageVersion()}`;
  const parsed = parseReleaseTag(suppliedTag);
  if (!parsed) throw new Error(`release tag is not strict SemVer or is retired: ${suppliedTag}`);
  if (parsed.version !== packageVersion()) {
    throw new Error(
      `release tag ${suppliedTag} does not match package version ${packageVersion()}`,
    );
  }
  return parsed;
}

function remoteTagSha(tag) {
  const result = run('git', ['ls-remote', '--refs', 'origin', `refs/tags/${tag}`]);
  const line = result.stdout.trim().split(/\r?\n/).find(Boolean);
  if (!line) return null;
  const objectSha = line.split(/\s+/)[0];
  if (!SHA_PATTERN.test(objectSha))
    throw new Error(`remote tag ${tag} returned invalid SHA ${objectSha}`);
  run('git', ['fetch', '--force', '--no-tags', 'origin', `refs/tags/${tag}:refs/tags/${tag}`]);
  const resolved = run('git', ['rev-parse', `${tag}^{commit}`])
    .stdout.trim()
    .toLowerCase();
  if (!SHA_PATTERN.test(resolved))
    throw new Error(`tag ${tag} resolved to invalid SHA ${resolved}`);
  return resolved;
}

function targetState(repository, tag, expectedSha) {
  const tagSha = remoteTagSha(tag);
  const release = api(repository, `releases/tags/${encodeURIComponent(tag)}`, true);
  if (release) validateReleaseObject(release, tag, expectedSha);
  const state = classifyReleaseTarget({
    tagSha,
    releaseExists: Boolean(release),
    expectedSha,
  });
  if (state === 'mismatch') {
    throw new Error(`release tag ${tag} points at ${tagSha}, expected ${expectedSha}`);
  }
  if (state === 'incomplete') {
    throw new Error(`release tag/Release ${tag} is only partially present; refusing to overwrite`);
  }
  return { state, tagSha, release };
}

function main() {
  const mode = process.argv[2];
  if (mode !== 'probe' && mode !== 'verify') {
    throw new Error('usage: verify-release-target.mjs <probe|verify>');
  }
  const repository = requireEnvironment('GITHUB_REPOSITORY');
  if (repository !== 'takano536/kobako') throw new Error(`unexpected repository: ${repository}`);
  const expectedSha = (process.env.EXPECTED_SHA || '').toLowerCase();
  if (!SHA_PATTERN.test(expectedSha))
    throw new Error(`EXPECTED_SHA is not a full SHA: ${expectedSha}`);
  const parsed = resolveTag();
  const target = targetState(repository, parsed.tag, expectedSha);
  if (mode === 'verify') {
    const actionOutcome = process.env.RELEASE_ACTION_OUTCOME || 'success';
    const finalizeOutcome = decideReleaseFinalizeOutcome({
      actionOutcome,
      targetState: target.state,
    });
    if (finalizeOutcome === 'fail') {
      if (actionOutcome === 'failure' && target.state !== 'matching') {
        throw new Error(
          `release finalize action failed and immutable target verification found ${target.state}`,
        );
      }
      throw new Error(
        `release target ${parsed.tag} is not present at the expected SHA: ${target.state}`,
      );
    }
    if (finalizeOutcome === 'tolerated-failure') {
      emit('release_action_failure', 'tolerated');
    }
  }
  emit('release_tag', parsed.tag);
  emit('version', parsed.version);
  emit('target_state', target.state);
  emit('target_sha', expectedSha);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
