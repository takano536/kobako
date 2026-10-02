#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const REQUIRED_CHECKS = ['lint', 'unit', 'integration', 'build', 'e2e', 'docker'];
export const GITHUB_ACTIONS_APP_ID = 15368;
export const GITHUB_ACTIONS_APP_SLUG = 'github-actions';
export const RELEASE_BRANCH = 'release-please--branches--main--components--kobako';
export const VERIFY_REF_PREFIX = 'release-verify/';
export const PENDING_LABEL = 'autorelease: pending';
export const TAGGED_LABEL = 'autorelease: tagged';
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

function asString(value) {
  return typeof value === 'string' ? value : '';
}

function asSha(value) {
  const sha = asString(value).toLowerCase();
  return SHA_PATTERN.test(sha) ? sha : '';
}
export function isReleaseBot(user, appBotLogin = process.env.RELEASE_APP_BOT_LOGIN || '') {
  if (user?.type !== 'Bot') return false;
  if (user?.login === 'github-actions[bot]') return true;
  return /^[a-z0-9][a-z0-9-]*\[bot\]$/.test(appBotLogin) && user?.login === appBotLogin;
}

function asVersion(value) {
  const version = asString(value);
  return VERSION_PATTERN.test(version) ? version : '';
}

function decodeSummary(value) {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function parseReleasePleaseBody(body) {
  const normalized = asString(body).trim().replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const firstDelimiter = lines.indexOf('---');
  if (firstDelimiter < 0) return [];
  let lastDelimiter = lines.lastIndexOf('---');
  if (lastDelimiter === firstDelimiter) lastDelimiter = lines.length - 1;
  const content = lines.slice(firstDelimiter + 1, lastDelimiter).join('\n');
  const releases = [];
  const detailsPattern =
    /<details\b[^>]*>[\s\S]*?<summary\b[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/gi;
  for (const match of content.matchAll(detailsPattern)) {
    const summary = decodeSummary(match[1]);
    const componentMatch = /^(?<component>.*[^:]):? (?<version>\d+\.\d+\.\d+.*)$/.exec(summary);
    const componentlessMatch = /^(?<version>\d+\.\d+\.\d+.*)$/.exec(summary);
    if (componentMatch?.groups) {
      releases.push({
        component: componentMatch.groups.component,
        version: componentMatch.groups.version,
      });
    } else if (componentlessMatch?.groups) {
      releases.push({ version: componentlessMatch.groups.version });
    }
  }
  if (releases.length > 0) return releases;
  const singleMatch = /^#{2,} \[?(?<version>\d+\.\d+\.\d+)/.exec(content.trim());
  return singleMatch?.groups ? [{ version: singleMatch.groups.version }] : [];
}

function normalizeReleasePath(relativePath) {
  const normalized = path.posix.normalize(asString(relativePath).replaceAll('\\', '/'));
  if (
    !normalized ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/')
  ) {
    throw new Error(`invalid Release Please path: ${relativePath || 'missing'}`);
  }
  return normalized;
}

function releaseOwnedPaths(config) {
  const packages = config?.packages;
  if (!packages || typeof packages !== 'object' || Array.isArray(packages)) {
    throw new Error('release-please-config.json packages must be an object');
  }
  const owned = new Set(['CHANGELOG.md', '.release-please-manifest.json']);
  for (const [packagePath, packageConfig] of Object.entries(packages)) {
    const packageJsonPath =
      packagePath === '.' ? 'package.json' : path.posix.join(packagePath, 'package.json');
    owned.add(normalizeReleasePath(packageJsonPath));
    for (const extraFile of packageConfig?.['extra-files'] || []) {
      const extraPath = typeof extraFile === 'string' ? extraFile : extraFile?.path;
      if (extraPath) owned.add(normalizeReleasePath(extraPath));
    }
  }
  return owned;
}

function releaseJsonVersionPaths(config) {
  const paths = new Set();
  for (const [packagePath, packageConfig] of Object.entries(config?.packages || {})) {
    paths.add(
      normalizeReleasePath(
        packagePath === '.' ? 'package.json' : path.posix.join(packagePath, 'package.json'),
      ),
    );
    for (const extraFile of packageConfig?.['extra-files'] || []) {
      const extraPath = typeof extraFile === 'string' ? extraFile : extraFile?.path;
      const extraType =
        typeof extraFile === 'object' && extraFile !== null ? extraFile.type : undefined;
      if (extraPath && (extraType === 'json' || extraPath.endsWith('.json'))) {
        paths.add(normalizeReleasePath(extraPath));
      }
    }
  }
  return paths;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function jsonWithoutField(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`expected a JSON object while comparing ${field}`);
  }
  const copy = { ...value };
  delete copy[field];
  return copy;
}

function labelNames(pr) {
  return new Set(
    (Array.isArray(pr?.labels) ? pr.labels : [])
      .map((label) => (typeof label === 'string' ? label : label?.name))
      .filter((name) => typeof name === 'string'),
  );
}

function repositoryName(repository) {
  return asString(repository).toLowerCase();
}

function repositoryOf(value) {
  return asString(value?.full_name || value?.name).toLowerCase();
}

/**
 * Validate the identity of a Release Please pull request.
 *
 * The REST pull endpoint includes all fields checked here. The function is
 * intentionally pure so fixtures can exercise the security boundary without
 * granting a test process a GitHub token.
 */
export function validateCanonicalReleasePr(
  pr,
  {
    repository,
    expectedHeadSha = '',
    expectedMergeSha = '',
    state = 'open',
    allowTaggedRecovery = false,
    appBotLogin = process.env.RELEASE_APP_BOT_LOGIN || '',
  } = {},
) {
  const errors = [];
  const expectedRepository = repositoryName(repository);
  const headRepository = repositoryOf(pr?.head?.repo);
  const authorLogin = asString(pr?.user?.login || pr?.author?.login);
  const headRef = asString(pr?.head?.ref || pr?.headRefName);
  const baseRef = asString(pr?.base?.ref || pr?.baseRefName);
  const headSha = asSha(pr?.head?.sha || pr?.head_sha);
  const mergeSha = asSha(pr?.merge_commit_sha || pr?.mergeCommit?.oid);
  const labels = labelNames(pr);
  const isMerged = Boolean(pr?.merged_at || pr?.merged);

  if (!pr || typeof pr !== 'object') errors.push('pull request object is missing');
  if (!expectedRepository) errors.push('repository is required');
  if (repositoryOf(pr?.base?.repo) !== expectedRepository) {
    errors.push('base repository is not the canonical repository');
  }
  if (headRepository !== expectedRepository) {
    errors.push('head repository is not the canonical repository');
  }
  if (baseRef !== 'main') errors.push(`base ref is not main: ${baseRef || 'missing'}`);
  if (headRef !== RELEASE_BRANCH) {
    errors.push(`head ref is not the Release Please branch: ${headRef || 'missing'}`);
  }
  if (
    !isReleaseBot({ login: authorLogin, type: pr?.user?.type || pr?.author?.type }, appBotLogin)
  ) {
    errors.push(
      `author is not github-actions[bot] or the configured release App bot: ${authorLogin || 'missing'}`,
    );
  }
  if (pr?.user?.type && pr.user.type !== 'Bot') {
    errors.push(`author type is not Bot: ${pr.user.type}`);
  }
  if (!labels.has(PENDING_LABEL) && !(allowTaggedRecovery && labels.has(TAGGED_LABEL))) {
    errors.push('Release Please label is missing');
  }

  if (state === 'open') {
    if (asString(pr?.state) !== 'open' || isMerged) errors.push('pull request is not open');
    if (pr?.draft === true) errors.push('pull request is draft');
  } else if (state === 'merged') {
    if (!isMerged || asString(pr?.state) !== 'closed') errors.push('pull request is not merged');
    if (!mergeSha) errors.push('merge commit SHA is missing or invalid');
  } else {
    errors.push(`unsupported pull request state: ${state}`);
  }

  if (expectedHeadSha && headSha !== asSha(expectedHeadSha)) {
    errors.push(`head SHA does not match expected ${expectedHeadSha}`);
  }
  if (expectedMergeSha && mergeSha !== asSha(expectedMergeSha)) {
    errors.push(`merge SHA does not match expected ${expectedMergeSha}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    headSha,
    mergeSha,
    headRef,
    baseRef,
    labels: [...labels],
    isMerged,
  };
}

function compareCheckRuns(left, right) {
  const leftStarted = asString(left?.started_at || left?.created_at);
  const rightStarted = asString(right?.started_at || right?.created_at);
  if (leftStarted !== rightStarted) return leftStarted < rightStarted ? -1 : 1;
  const leftCompleted = asString(left?.completed_at);
  const rightCompleted = asString(right?.completed_at);
  if (leftCompleted !== rightCompleted) return leftCompleted < rightCompleted ? -1 : 1;
  const leftId = Number(left?.id) || 0;
  const rightId = Number(right?.id) || 0;
  return leftId - rightId;
}

function checkAppIsGitHubActions(check) {
  return (
    Number(check?.app?.id) === GITHUB_ACTIONS_APP_ID &&
    asString(check?.app?.slug) === GITHUB_ACTIONS_APP_SLUG
  );
}

/**
 * Select and validate the newest GitHub Actions check run for every required
 * context. A newer pending run therefore wins over an older success.
 */
export function selectLatestRequiredChecks(checkRuns, requiredChecks = REQUIRED_CHECKS) {
  const runs = Array.isArray(checkRuns) ? checkRuns : [];
  const selected = {};
  const errors = [];

  for (const name of requiredChecks) {
    const candidates = runs.filter((run) => run?.name === name).sort(compareCheckRuns);
    const latest = candidates.at(-1);
    if (!latest) {
      errors.push(`${name}: missing`);
      continue;
    }
    selected[name] = latest;
    if (!checkAppIsGitHubActions(latest)) {
      errors.push(`${name}: check app is not GitHub Actions`);
    }
    if (latest.status !== 'completed' || latest.conclusion !== 'success') {
      errors.push(`${name}: ${latest.status || 'missing'}/${latest.conclusion || 'missing'}`);
    }
  }

  return { ok: errors.length === 0, errors, selected };
}

export function verifyRefForSha(ref, sha) {
  const expectedSha = asSha(sha);
  const match = /^refs\/heads\/release-verify\/([0-9a-f]{40})$/.exec(asString(ref));
  return Boolean(expectedSha && match && match[1] === expectedSha);
}

export function classifyVerifyRef(existingSha, expectedSha) {
  const current = asSha(existingSha);
  const expected = asSha(expectedSha);
  if (!expected) return 'invalid';
  if (!current) return 'create';
  return current === expected ? 'reuse' : 'mismatch';
}

export function verifyRefNameForSha(sha) {
  const expectedSha = asSha(sha);
  if (!expectedSha) throw new Error(`invalid merge SHA: ${sha || 'missing'}`);
  return `${VERIFY_REF_PREFIX}${expectedSha}`;
}

export function classifyVerifyRuns(runs, sha) {
  const expectedSha = asSha(sha);
  const relevant = (Array.isArray(runs) ? runs : []).filter(
    (run) => asSha(run?.head_sha || run?.headSha) === expectedSha,
  );
  const successful = relevant.some(
    (run) => run?.status === 'completed' && run?.conclusion === 'success',
  );
  const active = relevant.some((run) =>
    ['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(run?.status),
  );
  return { relevant, successful, active };
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function repositoryEnvironment() {
  const repository = requireEnvironment('GITHUB_REPOSITORY');
  if (repository !== 'takano536/kobako') {
    throw new Error(`unexpected repository: ${repository}`);
  }
  return repository;
}

function runCommand(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${stderr || stdout}`);
  }
  return { status: result.status ?? 1, stdout, stderr };
}

function parseJsonOutput(result, description) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`could not parse ${description}: ${error.message}`, { cause: error });
  }
}

function apiPath(repository, path) {
  return `repos/${repository}/${path}`;
}

function ghApi(
  repository,
  apiPathValue,
  { method, fields = [], allowNotFound = false, paginate = false } = {},
) {
  const args = ['api', apiPath(repository, apiPathValue)];
  if (method) args.push('--method', method);
  if (paginate) args.push('--paginate', '--slurp');
  for (const field of fields) args.push('--raw-field', field);
  const result = runCommand('gh', args, { allowFailure: allowNotFound });
  if (result.status !== 0) {
    const message = `${result.stdout}\n${result.stderr}`;
    if (allowNotFound && /(?:404|not found)/i.test(message)) return null;
    throw new Error(`gh api ${apiPathValue} failed: ${message}`);
  }
  if (!result.stdout.trim()) return {};
  const parsed = parseJsonOutput(result, apiPathValue);
  if (!paginate) return parsed;
  return Array.isArray(parsed)
    ? parsed.flatMap((page) => (Array.isArray(page) ? page : [page]))
    : [parsed];
}

function getFileAtCommit(repository, relativePath, sha) {
  const response = ghApi(
    repository,
    `contents/${relativePath
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/')}?ref=${encodeURIComponent(sha)}`,
  );
  if (response?.type !== 'file' || typeof response.content !== 'string') {
    throw new Error(`${relativePath} at ${sha} is not a file`);
  }
  return Buffer.from(response.content.replace(/\s/g, ''), 'base64').toString('utf8');
}

function getJsonAtCommit(repository, relativePath, sha) {
  try {
    return JSON.parse(getFileAtCommit(repository, relativePath, sha));
  } catch (error) {
    throw new Error(`could not parse ${relativePath} at ${sha}: ${error.message}`, {
      cause: error,
    });
  }
}

function releaseVersionAtCommit(repository, sha) {
  const packageJson = getJsonAtCommit(repository, 'package.json', sha);
  const manifest = getJsonAtCommit(repository, '.release-please-manifest.json', sha);
  const version = asVersion(packageJson?.version);
  const manifestVersion = asVersion(manifest?.['.']);
  if (!version || !manifestVersion || version !== manifestVersion) {
    throw new Error(
      `release version files at ${sha} disagree: package.json=${packageJson?.version || 'missing'}, manifest=${manifest?.['.'] || 'missing'}`,
    );
  }
  return version;
}

function validateReleasePrMetadata(repository, pr, sha) {
  const version = releaseVersionAtCommit(repository, sha);
  const expectedTitle = `chore(main): release ${version}`;
  if (pr?.title !== expectedTitle) {
    throw new Error(`Release PR title does not match the expected ${version} title`);
  }
  const releases = parseReleasePleaseBody(pr?.body);
  if (
    releases.length !== 1 ||
    releases.some(
      (release) => release.component || release.version !== version || !asVersion(release.version),
    )
  ) {
    throw new Error(`Release PR body does not contain exactly the root release ${version}`);
  }
  return { version };
}

function compareReleaseFiles(repository, baseSha, headSha) {
  const response = ghApi(repository, `compare/${baseSha}...${headSha}?per_page=300`);
  if (!Array.isArray(response?.files)) {
    throw new Error('Release PR compare response did not include a complete file list');
  }
  const files = response.files;
  if (files.length >= 300) {
    throw new Error(
      'Release PR diff has too many files; refusing to merge without a complete allowlist',
    );
  }
  return files.flatMap((file) => [file?.filename, file?.previous_filename]).filter(Boolean);
}

function assertJsonVersionOnly(repository, relativePath, baseSha, headSha, field = 'version') {
  const baseJson = jsonWithoutField(getJsonAtCommit(repository, relativePath, baseSha), field);
  const headJson = jsonWithoutField(getJsonAtCommit(repository, relativePath, headSha), field);
  if (JSON.stringify(canonicalJson(baseJson)) !== JSON.stringify(canonicalJson(headJson))) {
    throw new Error(
      `${relativePath} changes fields other than ${field} between ${baseSha} and ${headSha}`,
    );
  }
}

function assertManifestVersionOnly(repository, baseSha, headSha) {
  const baseManifest = jsonWithoutField(
    getJsonAtCommit(repository, '.release-please-manifest.json', baseSha),
    '.',
  );
  const headManifest = jsonWithoutField(
    getJsonAtCommit(repository, '.release-please-manifest.json', headSha),
    '.',
  );
  if (JSON.stringify(canonicalJson(baseManifest)) !== JSON.stringify(canonicalJson(headManifest))) {
    throw new Error(
      `.release-please-manifest.json changes fields other than . between ${baseSha} and ${headSha}`,
    );
  }
}

function assertChangelogUpdate(repository, baseSha, headSha, targetVersion) {
  const baseChangelog = getFileAtCommit(repository, 'CHANGELOG.md', baseSha);
  const headChangelog = getFileAtCommit(repository, 'CHANGELOG.md', headSha);
  const splitHeading = (content, sha) => {
    const firstLineMatch = /^([^\r\n]*)(?:\r\n|\n|\r|$)/.exec(content);
    if (firstLineMatch?.[1] !== '# Changelog') {
      throw new Error(`CHANGELOG.md at ${sha} must start with the # Changelog heading`);
    }
    const lines = content.split(/\r\n|\n|\r/);
    const headingPattern = /^ {0,3}#\s+Changelog\s*$/i;
    if (lines.filter((line) => headingPattern.test(line)).length !== 1) {
      throw new Error(`CHANGELOG.md at ${sha} must contain exactly one # Changelog heading`);
    }
    return { rest: content.slice(firstLineMatch[0].length) };
  };
  const base = splitHeading(baseChangelog, baseSha);
  const head = splitHeading(headChangelog, headSha);
  if (head.rest === base.rest || !head.rest.endsWith(base.rest)) {
    throw new Error(
      `CHANGELOG.md must insert a new release section immediately after the shared heading while preserving history between ${baseSha} and ${headSha}`,
    );
  }
  const inserted = head.rest.slice(0, head.rest.length - base.rest.length);
  if (base.rest !== '' && !/^(?:\r\n|\n|\r)/.test(base.rest) && !/(?:\r\n|\n|\r)$/.test(inserted)) {
    throw new Error(
      `CHANGELOG.md new release section must end with a line terminator before existing history between ${baseSha} and ${headSha}`,
    );
  }
  const insertedLines = inserted.split(/\r\n|\n|\r/);
  if (insertedLines.at(-1) === '') insertedLines.pop();
  const firstSectionLine = insertedLines.findIndex((line) => line.trim() !== '');
  if (firstSectionLine === -1) {
    throw new Error(
      `CHANGELOG.md must contain exactly one new top-level release section immediately after the shared heading`,
    );
  }
  const sectionLines = insertedLines.slice(firstSectionLine);
  const levelOneHeadingPattern = /^ {0,3}#(?!#)(?:[ \t]+|$)/;
  if (sectionLines.some((line) => levelOneHeadingPattern.test(line))) {
    throw new Error(`CHANGELOG.md new release section must not contain a level-1 heading`);
  }
  const releaseHeadingPattern = /^ {0,3}##(?:[ \t]+|$)/;
  const releaseHeadingIndexes = sectionLines.flatMap((line, index) =>
    releaseHeadingPattern.test(line) ? [index] : [],
  );
  if (releaseHeadingIndexes.length !== 1 || releaseHeadingIndexes[0] !== 0) {
    throw new Error(
      `CHANGELOG.md must contain exactly one new top-level release section immediately after the shared heading`,
    );
  }
  const escapedVersion = asString(targetVersion).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const targetHeadingPattern = new RegExp(
    `^ {0,3}##[ \\t]+(?:\\[${escapedVersion}\\]|${escapedVersion})(?=$|[ \\t(])`,
  );
  if (!targetHeadingPattern.test(sectionLines[0])) {
    throw new Error(
      `CHANGELOG.md new release section must target version ${targetVersion || 'missing'}`,
    );
  }
  if (!sectionLines.slice(1).some((line) => line.trim() !== '')) {
    throw new Error(`CHANGELOG.md new release section for ${targetVersion} has no body`);
  }
}

function validateReleasePrFileContents(repository, config, baseSha, headSha) {
  for (const relativePath of releaseJsonVersionPaths(config)) {
    assertJsonVersionOnly(repository, relativePath, baseSha, headSha);
  }
  assertManifestVersionOnly(repository, baseSha, headSha);
  const targetVersion = releaseVersionAtCommit(repository, headSha);
  assertChangelogUpdate(repository, baseSha, headSha, targetVersion);
}
function readReleasePleaseConfig() {
  try {
    return JSON.parse(fs.readFileSync('release-please-config.json', 'utf8'));
  } catch (error) {
    throw new Error(
      `could not read release-please-config.json from the validator checkout: ${error.message}`,
      { cause: error },
    );
  }
}

function validateReleasePrProvenance(repository, pr, mainSha, headSha) {
  const config = readReleasePleaseConfig();
  const ownedPaths = releaseOwnedPaths(config);
  const changedPaths = compareReleaseFiles(repository, mainSha, headSha);
  const disallowed = [...new Set(changedPaths)].filter((file) => !ownedPaths.has(file));
  if (disallowed.length > 0) {
    throw new Error(`Release PR changes non-Release Please files: ${disallowed.join(', ')}`);
  }
  const headCommit = getCommit(repository, headSha);
  validateReleasePrFileContents(repository, config, mainSha, headSha);
  if (!isReleaseBot(headCommit?.author)) {
    throw new Error(
      `Release PR head author is not github-actions[bot] or configured release App bot`,
    );
  }
  const botCommitter = isReleaseBot(headCommit?.committer);
  // GitHub's commit API can preserve the bot author while signing as web-flow.
  const verifiedGitHubCommitter =
    headCommit?.committer?.login === 'web-flow' &&
    headCommit?.committer?.type === 'User' &&
    headCommit?.commit?.verification?.verified === true &&
    headCommit?.commit?.verification?.reason === 'valid';
  if (!botCommitter && !verifiedGitHubCommitter) {
    throw new Error(
      `Release PR head committer is not github-actions[bot] or verified GitHub web-flow`,
    );
  }
  return validateReleasePrMetadata(repository, pr, headSha);
}

function getTagCommitSha(repository, tag) {
  let ref = ghApi(repository, `git/ref/tags/${encodeURIComponent(tag)}`, {
    allowNotFound: true,
  });
  if (!ref) return null;
  for (let depth = 0; depth < 3; depth += 1) {
    const sha = asSha(ref?.object?.sha);
    if (!sha) throw new Error(`tag ${tag} returned an invalid object SHA`);
    if (ref.object.type !== 'tag') return sha;
    ref = ghApi(repository, `git/tags/${sha}`);
  }
  throw new Error(`tag ${tag} is nested too deeply`);
}
function releaseInputPathsAtCommit(repository, sha) {
  const config = getJsonAtCommit(repository, 'release-please-config.json', sha);
  const paths = new Set([
    'release-please-config.json',
    '.release-please-manifest.json',
    'package.json',
  ]);
  for (const [packagePath, packageConfig] of Object.entries(config?.packages || {})) {
    paths.add(
      normalizeReleasePath(
        packagePath === '.' ? 'package.json' : path.posix.join(packagePath, 'package.json'),
      ),
    );
    for (const extraFile of packageConfig?.['extra-files'] || []) {
      const extraPath = typeof extraFile === 'string' ? extraFile : extraFile?.path;
      if (extraPath) paths.add(normalizeReleasePath(extraPath));
    }
  }
  return [...paths];
}

function getBlobShaAtCommit(repository, relativePath, sha) {
  const response = ghApi(
    repository,
    `contents/${relativePath
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/')}?ref=${encodeURIComponent(sha)}`,
  );
  const blobSha = asSha(response?.sha);
  if (!blobSha) throw new Error(`${relativePath} at ${sha} returned no blob SHA`);
  return blobSha;
}

function assertReleaseInputsMatchMain(repository, mergeSha) {
  const mainSha = getMainSha(repository);
  for (const relativePath of releaseInputPathsAtCommit(repository, mergeSha)) {
    const mergeBlob = getBlobShaAtCommit(repository, relativePath, mergeSha);
    const mainBlob = getBlobShaAtCommit(repository, relativePath, mainSha);
    if (mergeBlob !== mainBlob) {
      throw new Error(
        `${relativePath} at main ${mainSha} differs from merge ${mergeSha}; hold or revert main metadata before finalizing`,
      );
    }
  }
  return mainSha;
}

function removeIssueLabel(repository, prNumber, label) {
  ghApi(repository, `issues/${prNumber}/labels/${encodeURIComponent(label)}`, {
    method: 'DELETE',
  });
}

function addIssueLabel(repository, prNumber, label) {
  ghApi(repository, `issues/${prNumber}/labels`, {
    method: 'POST',
    fields: [`labels[]=${label}`],
  });
}
function ghRunList(repository, ref, sha) {
  const pages = ghApi(
    repository,
    `actions/workflows/ci.yml/runs?event=workflow_dispatch&branch=${encodeURIComponent(ref)}&head_sha=${sha}&per_page=100`,
    { paginate: true },
  );
  return (Array.isArray(pages) ? pages : []).flatMap((page) =>
    Array.isArray(page?.workflow_runs) ? page.workflow_runs : [],
  );
}

function emit(key, value) {
  const line = `${key}=${value}`;
  if (process.env.GITHUB_OUTPUT) {
    // Avoid shell interpolation for output values supplied by GitHub APIs.
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`, 'utf8');
  }
  return line;
}

function getPullRequest(repository, number) {
  if (!/^[0-9]+$/.test(String(number))) throw new Error(`invalid pull request number: ${number}`);
  return ghApi(repository, `pulls/${number}`);
}

function getMainSha(repository) {
  const ref = ghApi(repository, 'git/ref/heads/main');
  const sha = asSha(ref?.object?.sha);
  if (!sha) throw new Error(`main ref returned an invalid SHA: ${ref?.object?.sha || 'missing'}`);
  return sha;
}

function getCommit(repository, sha) {
  return ghApi(repository, `commits/${sha}`);
}

function getCheckRuns(repository, sha) {
  const pages = ghApi(repository, `commits/${sha}/check-runs?per_page=100`, {
    paginate: true,
  });
  return (Array.isArray(pages) ? pages : []).flatMap((page) =>
    Array.isArray(page?.check_runs) ? page.check_runs : [],
  );
}

function getRefSha(repository, ref) {
  const encodedRef = ref
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  const response = ghApi(repository, `git/ref/heads/${encodedRef}`, { allowNotFound: true });
  if (!response) return null;
  const sha = asSha(response?.object?.sha);
  if (!sha) throw new Error(`ref ${ref} returned an invalid object SHA`);
  return sha;
}

function createVerifyRef(repository, ref, sha) {
  try {
    const response = ghApi(repository, 'git/refs', {
      method: 'POST',
      fields: [`ref=refs/heads/${ref}`, `sha=${sha}`],
    });
    const createdSha = asSha(response?.object?.sha);
    if (createdSha && createdSha !== sha) {
      throw new Error(`verify ref ${ref} was created at ${createdSha}, expected ${sha}`);
    }
  } catch (error) {
    // A merge job and the main self-heal job can race to create the same ref.
    // Accept the race only when the ref now points to this exact SHA.
    if (getRefSha(repository, ref) === sha) return;
    throw error;
  }
}

function dispatchVerify(repository, ref, sha, prNumber) {
  runCommand('gh', [
    'workflow',
    'run',
    'ci.yml',
    '--repo',
    repository,
    '--ref',
    ref,
    '--field',
    'mode=verify',
    '--field',
    `merge_sha=${sha}`,
    '--field',
    `pr_number=${prNumber}`,
  ]);
}

function ensureVerifyRun(repository, mergeSha, prNumber, { missingOnly = false } = {}) {
  const sha = asSha(mergeSha);
  if (!sha) throw new Error(`invalid merge SHA for verify run: ${mergeSha || 'missing'}`);
  const ref = verifyRefNameForSha(sha);
  const existingSha = getRefSha(repository, ref);
  const refDecision = classifyVerifyRef(existingSha, sha);
  if (refDecision === 'mismatch') {
    throw new Error(`verify ref ${ref} points at ${existingSha}, expected ${sha}`);
  }

  const runs = ghRunList(repository, ref, sha);
  const classification = classifyVerifyRuns(runs, sha);
  let requested = false;
  let refCreated = false;
  if (missingOnly) {
    if (runs.length === 0) {
      if (refDecision === 'create') {
        createVerifyRef(repository, ref, sha);
        refCreated = true;
      }
      dispatchVerify(repository, ref, sha, prNumber);
      requested = true;
    }
  } else {
    if (refDecision === 'create') {
      createVerifyRef(repository, ref, sha);
      refCreated = true;
    }
    if (!classification.successful && !classification.active) {
      dispatchVerify(repository, ref, sha, prNumber);
      requested = true;
    }
  }
  emit('verify_ref', ref);
  emit('merge_sha', sha);
  emit('verify_run_requested', String(requested));
  emit('verify_ref_created', String(refCreated));
  emit('verify_run_existing_success', String(classification.successful));
  return {
    ref,
    requested,
    refCreated,
    successful: classification.successful,
    active: classification.active,
    runs,
  };
}

function isListedReleasePr(pr, { allowTaggedRecovery = false } = {}) {
  const labels = labelNames(pr);
  return (
    pr?.head?.ref === RELEASE_BRANCH &&
    pr?.base?.ref === 'main' &&
    (labels.has(PENDING_LABEL) || (allowTaggedRecovery && labels.has(TAGGED_LABEL)))
  );
}

function canonicalMergedCandidates(
  repository,
  { allowTaggedRecovery = false, expectedMergeSha = '', prNumber = '' } = {},
) {
  const requestedNumber = asString(prNumber);
  if (requestedNumber && !/^[0-9]+$/.test(requestedNumber)) {
    throw new Error(`invalid pull request number: ${prNumber}`);
  }
  const requestedSha = expectedMergeSha ? asSha(expectedMergeSha) : '';
  if (expectedMergeSha && !requestedSha) {
    throw new Error(`invalid merge SHA target: ${expectedMergeSha}`);
  }
  const targeted = Boolean(requestedNumber || requestedSha);
  const listed = ghApi(
    repository,
    'pulls?state=closed&base=main&head=takano536:release-please--branches--main--components--kobako&sort=updated&direction=desc&per_page=100',
    { paginate: true },
  );
  const candidates = [];
  for (const listedPr of Array.isArray(listed) ? listed : []) {
    if (!targeted) {
      if (!isListedReleasePr(listedPr, { allowTaggedRecovery }) || !listedPr?.merged_at) {
        continue;
      }
      const pr = getPullRequest(repository, listedPr.number);
      const identity = validateCanonicalReleasePr(pr, {
        repository,
        state: 'merged',
        allowTaggedRecovery,
      });
      if (identity.ok) candidates.push({ pr, identity });
      continue;
    }

    if (requestedNumber && String(listedPr?.number) !== requestedNumber) continue;
    const listedMergeSha = asSha(listedPr?.merge_commit_sha || listedPr?.mergeCommit?.oid);
    if (!requestedNumber && requestedSha && listedMergeSha && listedMergeSha !== requestedSha) {
      continue;
    }

    const pr = getPullRequest(repository, listedPr.number);
    if (requestedNumber && String(pr?.number) !== requestedNumber) {
      throw new Error(`PR #${requestedNumber} response did not identify the requested PR`);
    }
    const actualMergeShaValue = asString(pr?.merge_commit_sha || pr?.mergeCommit?.oid);
    const actualMergeSha = asSha(actualMergeShaValue);
    if (requestedSha && actualMergeSha !== requestedSha) {
      const actual = actualMergeSha || actualMergeShaValue || 'missing';
      if (requestedNumber) {
        throw new Error(
          `PR #${requestedNumber} merge SHA ${actual} does not match requested ${expectedMergeSha}`,
        );
      }
      if (listedMergeSha !== requestedSha) continue;
      throw new Error(
        `merged Release PR merge SHA ${actual} does not match requested ${expectedMergeSha}`,
      );
    }
    const identity = validateCanonicalReleasePr(pr, {
      repository,
      state: 'merged',
      allowTaggedRecovery,
    });
    if (!identity.ok) throw new Error(identity.errors.join('; '));
    candidates.push({ pr, identity });
  }
  return candidates;
}

function findMergedCandidate(
  repository,
  expectedMergeSha = '',
  prNumber = '',
  { allowTaggedRecovery = false } = {},
) {
  const candidates = canonicalMergedCandidates(repository, {
    allowTaggedRecovery,
    expectedMergeSha,
    prNumber,
  });
  if (candidates.length === 0) return null;
  if (candidates.length !== 1) {
    throw new Error(
      `expected one canonical merged ${allowTaggedRecovery ? 'Release PR candidate' : 'pending Release PR'}, found ${candidates.length}`,
    );
  }
  return candidates[0];
}

function canonicalOpenCandidates(repository) {
  const listed = ghApi(
    repository,
    'pulls?state=open&base=main&head=takano536:release-please--branches--main--components--kobako&sort=updated&direction=desc&per_page=100',
    { paginate: true },
  );
  const candidates = [];
  for (const listedPr of Array.isArray(listed) ? listed : []) {
    if (!isListedReleasePr(listedPr) || listedPr?.state !== 'open') continue;
    const pr = getPullRequest(repository, listedPr.number);
    const identity = validateCanonicalReleasePr(pr, {
      repository,
      state: 'open',
    });
    if (identity.ok) candidates.push({ pr, identity });
  }
  return candidates;
}

function commandDispatchReleasePr() {
  const repository = repositoryEnvironment();
  const candidates = canonicalOpenCandidates(repository);
  if (candidates.length === 0) {
    emit('candidate_found', 'false');
    emit('dispatch_requested', 'false');
    return;
  }
  if (candidates.length !== 1) {
    throw new Error(`expected one canonical open Release PR, found ${candidates.length}`);
  }
  const candidate = candidates[0];
  const mainSha = getMainSha(repository);
  if (asSha(candidate.pr?.base?.sha) !== mainSha) {
    throw new Error(
      `Release PR base SHA ${candidate.pr?.base?.sha || 'missing'} does not equal main tip ${mainSha}`,
    );
  }
  runCommand('gh', [
    'workflow',
    'run',
    'ci.yml',
    '--repo',
    repository,
    '--ref',
    RELEASE_BRANCH,
    '--field',
    'mode=release-pr',
    '--field',
    `pr_number=${candidate.pr.number}`,
    '--field',
    `expected_head_sha=${candidate.identity.headSha}`,
    '--field',
    `main_sha=${mainSha}`,
  ]);
  emit('candidate_found', 'true');
  emit('dispatch_requested', 'true');
  emit('pr_number', String(candidate.pr.number));
  emit('head_sha', candidate.identity.headSha);
  emit('main_sha', mainSha);
}

function commandValidateReleasePr() {
  const repository = repositoryEnvironment();
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    throw new Error('Release PR merge validation requires workflow_dispatch');
  }
  if (process.env.GITHUB_REF !== `refs/heads/${RELEASE_BRANCH}`) {
    throw new Error(`unexpected Release PR ref: ${process.env.GITHUB_REF || 'missing'}`);
  }
  if (process.env.GATES_OK !== 'true') throw new Error('quality gate needs are not all successful');

  const prNumber = requireEnvironment('PR_NUMBER');
  const expectedHeadSha = asSha(requireEnvironment('GITHUB_SHA'));
  if (!expectedHeadSha) throw new Error('GITHUB_SHA is not a full commit SHA');
  let pr = getPullRequest(repository, prNumber);

  if (pr?.merged_at || pr?.merged) {
    const mergedIdentity = validateCanonicalReleasePr(pr, {
      repository,
      state: 'merged',
      allowTaggedRecovery: true,
    });
    if (!mergedIdentity.ok) throw new Error(mergedIdentity.errors.join('; '));
    validateReleasePrMetadata(repository, pr, mergedIdentity.mergeSha);
    ensureVerifyRun(repository, mergedIdentity.mergeSha, prNumber);
    emit('validated', 'true');
    emit('already_merged', 'true');
    emit('merge_sha', mergedIdentity.mergeSha);
    emit('pr_number', String(prNumber));
    return;
  }
  const expectedInputSha = process.env.EXPECTED_HEAD_SHA
    ? asSha(process.env.EXPECTED_HEAD_SHA)
    : '';
  if (process.env.EXPECTED_HEAD_SHA && expectedInputSha !== expectedHeadSha) {
    throw new Error(
      `dispatch expected head ${process.env.EXPECTED_HEAD_SHA} does not equal github.sha ${expectedHeadSha}`,
    );
  }

  const identity = validateCanonicalReleasePr(pr, {
    repository,
    state: 'open',
    expectedHeadSha,
  });
  if (!identity.ok) throw new Error(identity.errors.join('; '));
  const mainSha = getMainSha(repository);
  const expectedMainSha = process.env.MAIN_SHA ? asSha(process.env.MAIN_SHA) : '';
  if (process.env.MAIN_SHA && expectedMainSha !== mainSha) {
    throw new Error(
      `dispatch expected main ${process.env.MAIN_SHA} does not equal live main ${mainSha}`,
    );
  }
  if (asSha(pr?.base?.sha) !== mainSha) {
    throw new Error(`PR base SHA ${pr?.base?.sha || 'missing'} does not equal main tip ${mainSha}`);
  }
  validateReleasePrProvenance(repository, pr, mainSha, expectedHeadSha);
  const headCommit = getCommit(repository, expectedHeadSha);
  const parents = Array.isArray(headCommit?.parents)
    ? headCommit.parents.map((parent) => asSha(parent?.sha))
    : [];
  if (parents.length !== 1 || parents[0] !== mainSha) {
    throw new Error(`Release PR head must have main tip ${mainSha} as its sole parent`);
  }

  const checks = selectLatestRequiredChecks(getCheckRuns(repository, expectedHeadSha));
  if (!checks.ok) throw new Error(checks.errors.join('; '));

  const title = asString(pr?.title);
  if (!title || /[\r\n]/.test(title))
    throw new Error('Release PR title is missing or contains a newline');
  const commitTitle = `${title} (#${prNumber})`;
  let mergedPr;
  try {
    const mergeResponse = ghApi(repository, `pulls/${prNumber}/merge`, {
      method: 'PUT',
      fields: [`sha=${expectedHeadSha}`, 'merge_method=squash', `commit_title=${commitTitle}`],
    });
    if (mergeResponse?.merged === true) {
      mergedPr = getPullRequest(repository, prNumber);
    } else {
      mergedPr = getPullRequest(repository, prNumber);
      if (!(mergedPr?.merged_at || mergedPr?.merged)) {
        throw new Error(
          `Release PR merge was not accepted: ${mergeResponse?.message || 'unknown response'}`,
        );
      }
    }
  } catch (mergeError) {
    try {
      const recoveredPr = getPullRequest(repository, prNumber);
      if (!(recoveredPr?.merged_at || recoveredPr?.merged)) {
        throw new Error('PR is not merged after merge API failure', { cause: mergeError });
      }
      mergedPr = recoveredPr;
    } catch (recoveryError) {
      throw new Error(`Release PR merge failed: ${mergeError.message}`, {
        cause: recoveryError,
      });
    }
  }
  const mergedIdentity = validateCanonicalReleasePr(mergedPr, {
    repository,
    state: 'merged',
    allowTaggedRecovery: true,
  });
  if (!mergedIdentity.ok) throw new Error(mergedIdentity.errors.join('; '));
  validateReleasePrMetadata(repository, mergedPr, mergedIdentity.mergeSha);
  ensureVerifyRun(repository, mergedIdentity.mergeSha, prNumber);
  emit('validated', 'true');
  emit('already_merged', 'false');
  emit('merge_sha', mergedIdentity.mergeSha);
  emit('pr_number', String(prNumber));
}

function commandVerifyGuard() {
  const repository = repositoryEnvironment();
  const mergeSha = asSha(requireEnvironment('GITHUB_SHA'));
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    throw new Error('verify guard requires workflow_dispatch');
  }
  if (!mergeSha || !verifyRefForSha(process.env.GITHUB_REF, mergeSha)) {
    throw new Error(
      `verify ref does not identify github.sha: ${process.env.GITHUB_REF || 'missing'}`,
    );
  }
  const candidate = findMergedCandidate(repository, mergeSha, process.env.PR_NUMBER || '', {
    allowTaggedRecovery: true,
  });
  if (!candidate) throw new Error(`no canonical merged Release PR points to ${mergeSha}`);
  const { version } = validateReleasePrMetadata(repository, candidate.pr, mergeSha);
  const tagSha = getTagCommitSha(repository, `v${version}`);
  if (tagSha && tagSha !== mergeSha) {
    throw new Error(`release tag v${version} points at ${tagSha}, expected ${mergeSha}`);
  }
  const mainSha = assertReleaseInputsMatchMain(repository, mergeSha);
  const comparison = ghApi(repository, `compare/${mergeSha}...${mainSha}`);
  if (!['ahead', 'identical'].includes(comparison?.status)) {
    throw new Error(`${mergeSha} is not an ancestor of main ${mainSha}`);
  }
  emit('validated', 'true');
  emit('pr_number', String(candidate.pr.number));
  emit('merge_sha', mergeSha);
  emit('version', version);
  emit('label_state', candidate.identity.labels.includes(PENDING_LABEL) ? 'pending' : 'tagged');
}

function commandVerifyReleaseInputs() {
  const repository = repositoryEnvironment();
  const mergeSha = asSha(requireEnvironment('MERGE_SHA'));
  if (!mergeSha) throw new Error('MERGE_SHA is not a full commit SHA');
  const candidate = findMergedCandidate(repository, mergeSha, process.env.PR_NUMBER || '', {
    allowTaggedRecovery: true,
  });
  if (!candidate) throw new Error(`no canonical merged Release PR points to ${mergeSha}`);
  const { version } = validateReleasePrMetadata(repository, candidate.pr, mergeSha);
  const tagSha = getTagCommitSha(repository, `v${version}`);
  if (tagSha && tagSha !== mergeSha) {
    throw new Error(`release tag v${version} points at ${tagSha}, expected ${mergeSha}`);
  }
  const mainSha = assertReleaseInputsMatchMain(repository, mergeSha);
  emit('validated', 'true');
  emit('main_sha', mainSha);
  emit('merge_sha', mergeSha);
  emit('version', version);
}

function commandEnsureTaggedLabel() {
  const repository = repositoryEnvironment();
  const prNumber = requireEnvironment('PR_NUMBER');
  const mergeSha = asSha(requireEnvironment('MERGE_SHA'));
  if (!mergeSha) throw new Error('MERGE_SHA is not a full commit SHA');
  const pr = getPullRequest(repository, prNumber);
  const identity = validateCanonicalReleasePr(pr, {
    repository,
    state: 'merged',
    expectedMergeSha: mergeSha,
    allowTaggedRecovery: true,
  });
  if (!identity.ok) throw new Error(identity.errors.join('; '));

  const labels = new Set(identity.labels);
  const hadPending = labels.has(PENDING_LABEL);
  const hadTagged = labels.has(TAGGED_LABEL);
  if (hadPending) removeIssueLabel(repository, prNumber, PENDING_LABEL);
  if (!hadTagged) addIssueLabel(repository, prNumber, TAGGED_LABEL);
  emit('label_state', 'tagged');
  emit('label_updated', String(hadPending || !hadTagged));
  emit('pr_number', prNumber);
  emit('merge_sha', mergeSha);
}

function commandEnsureMain() {
  const repository = repositoryEnvironment();
  const candidates = canonicalMergedCandidates(repository);
  if (candidates.length === 0) {
    emit('candidate_found', 'false');
    emit('verify_run_requested', 'false');
    return;
  }
  if (candidates.length !== 1) {
    throw new Error(`expected one canonical merged pending Release PR, found ${candidates.length}`);
  }
  const candidate = candidates[0];
  const result = ensureVerifyRun(repository, candidate.identity.mergeSha, candidate.pr.number);
  emit('candidate_found', 'true');
  emit('pr_number', String(candidate.pr.number));
  emit('merge_sha', candidate.identity.mergeSha);
  emit('verify_ref', result.ref);
  emit('validated', 'true');
}
function commandHealMain() {
  const repository = repositoryEnvironment();
  const candidates = canonicalMergedCandidates(repository);
  if (candidates.length === 0) {
    emit('candidate_found', 'false');
    emit('verify_run_requested', 'false');
    return;
  }
  if (candidates.length !== 1) {
    throw new Error(`expected one canonical merged pending Release PR, found ${candidates.length}`);
  }
  const candidate = candidates[0];
  const result = ensureVerifyRun(repository, candidate.identity.mergeSha, candidate.pr.number, {
    missingOnly: true,
  });
  emit('candidate_found', 'true');
  emit('pr_number', String(candidate.pr.number));
  emit('merge_sha', candidate.identity.mergeSha);
  emit('verify_ref', result.ref);
  emit('validated', 'true');
}

function commandCleanupVerify() {
  const repository = repositoryEnvironment();
  const verifyRef = requireEnvironment('VERIFY_REF');
  const verifiedSha = asSha(requireEnvironment('VERIFIED_SHA'));
  if (!verifiedSha || !verifyRefForSha(`refs/heads/${verifyRef}`, verifiedSha)) {
    throw new Error(`cleanup ref does not identify verified SHA: ${verifyRef}`);
  }
  const encodedRef = verifyRef
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  ghApi(repository, `git/refs/heads/${encodedRef}`, {
    method: 'DELETE',
    allowNotFound: true,
  });
  const mainSha = getMainSha(repository);
  let dispatchRequested = false;
  if (mainSha !== verifiedSha) {
    runCommand('gh', [
      'workflow',
      'run',
      'ci.yml',
      '--repo',
      repository,
      '--ref',
      'main',
      '--field',
      'mode=normal',
    ]);
    dispatchRequested = true;
  }
  emit('verify_ref_deleted', 'true');
  emit('main_sha', mainSha);
  emit('main_dispatch_requested', String(dispatchRequested));
}

function main() {
  const command = process.argv[2];
  if (command === 'ensure-main') return commandEnsureMain();
  if (command === 'heal-main') return commandHealMain();
  if (command === 'cleanup-verify') return commandCleanupVerify();
  if (command === 'ensure-tagged-label') return commandEnsureTaggedLabel();
  if (command === 'dispatch-release-pr') return commandDispatchReleasePr();
  if (command === 'validate-release-pr') return commandValidateReleasePr();
  if (command === 'verify-guard') return commandVerifyGuard();
  if (command === 'verify-release-inputs') return commandVerifyReleaseInputs();
  throw new Error(
    'usage: release-automation.mjs <ensure-main|heal-main|cleanup-verify|ensure-tagged-label|dispatch-release-pr|validate-release-pr|verify-guard|verify-release-inputs>',
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
