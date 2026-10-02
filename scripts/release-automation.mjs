#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const REQUIRED_CHECKS = ['lint', 'unit', 'integration', 'build', 'e2e', 'docker'];
export const GITHUB_ACTIONS_APP_ID = 15368;
export const GITHUB_ACTIONS_APP_SLUG = 'github-actions';
export const RELEASE_BRANCH = 'release-please--branches--main--components--kobako';
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

function releaseOwnedVersionPaths(config) {
  return new Set(['.release-please-manifest.json', ...releaseJsonVersionPaths(config)]);
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
    errors.push(`author is not the configured release App bot: ${authorLogin || 'missing'}`);
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

export function validateReleasePrBeforeMerge(
  pr,
  { repository = 'takano536/kobako', expectedHeadSha = '', appBotLogin = '' } = {},
) {
  const identity = validateCanonicalReleasePr(pr, {
    repository,
    state: 'open',
    expectedHeadSha,
    appBotLogin,
  });
  if (!identity.ok) throw new Error(identity.errors.join('; '));
  return identity;
}

export function decideReleasePrLabelRepair(
  pr,
  { repository = 'takano536/kobako', expectedMergeSha = '', appBotLogin = '' } = {},
) {
  const identity = validateCanonicalReleasePr(pr, {
    repository,
    state: 'merged',
    expectedMergeSha,
    allowTaggedRecovery: true,
    appBotLogin,
  });
  const labels = new Set(identity.labels);
  if (!identity.ok) {
    return { action: 'refuse', errors: identity.errors, labels: [...labels] };
  }
  const add = labels.has(TAGGED_LABEL) ? [] : [TAGGED_LABEL];
  const remove = labels.has(PENDING_LABEL) ? [PENDING_LABEL] : [];
  return {
    action: add.length || remove.length ? 'repair' : 'noop',
    add,
    remove,
    labels: [...labels],
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

export function validateWorkflowRunMetadata(
  run,
  { repository = 'takano536/kobako', headSha = '', headBranch = RELEASE_BRANCH } = {},
) {
  const errors = [];
  const expectedSha = asSha(headSha);
  if (run?.event !== 'pull_request')
    errors.push(`workflow_run event must be pull_request, got ${run?.event || 'missing'}`);
  if (run?.conclusion !== 'success') {
    errors.push(`workflow_run conclusion is not success: ${run?.conclusion || 'missing'}`);
  }
  if (asString(run?.head_branch) !== headBranch) {
    errors.push(`workflow_run head branch changed: ${run?.head_branch || 'missing'}`);
  }
  if (expectedSha && asSha(run?.head_sha) !== expectedSha) {
    errors.push(
      `workflow_run head SHA ${run?.head_sha || 'missing'} does not match event head ${headSha}`,
    );
  }
  const headRepository = repositoryOf(run?.head_repository);
  if (headRepository && headRepository !== repositoryName(repository)) {
    errors.push(`workflow_run head repository is not canonical: ${headRepository}`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateReleaseAppConfiguration({ clientId, botLogin, privateKey } = {}) {
  if (!asString(clientId) || !asString(botLogin) || !asString(privateKey)) {
    throw new Error(
      'Release App is required: set RELEASE_APP_CLIENT_ID, RELEASE_APP_BOT_LOGIN, and RELEASE_APP_PRIVATE_KEY; refusing GITHUB_TOKEN fallback',
    );
  }
  return true;
}

export function formatGitHubApiError(path, status, tokenEnv = 'GH_TOKEN') {
  if (Number(status) === 403) {
    return `GitHub API returned 403 for ${path}; ${tokenEnv} is missing the required permission for this repository`;
  }
  return `GitHub API request failed for ${path} with status ${status}`;
}

/**
 * Select exactly one merged Release PR for a merge commit. The caller passes
 * only API results for that commit; no historical PR can accidentally win.
 */
export function selectCanonicalMergedReleasePr(
  pullRequests,
  mergeSha,
  { repository = 'takano536/kobako', appBotLogin = process.env.RELEASE_APP_BOT_LOGIN || '' } = {},
) {
  const expectedSha = asSha(mergeSha);
  if (!expectedSha) throw new Error(`invalid merge SHA: ${mergeSha || 'missing'}`);
  const candidates = [];
  for (const pr of Array.isArray(pullRequests) ? pullRequests : []) {
    if (asSha(pr?.merge_commit_sha || pr?.mergeCommit?.oid) !== expectedSha) continue;
    const identity = validateCanonicalReleasePr(pr, {
      repository,
      state: 'merged',
      expectedMergeSha: expectedSha,
      allowTaggedRecovery: true,
      appBotLogin,
    });
    if (identity.ok) {
      validateReleaseMergeActor(pr, appBotLogin);
      candidates.push({ pr, identity });
    }
  }
  if (candidates.length > 1) {
    throw new Error(
      `expected one canonical merged Release PR for ${expectedSha}, found ${candidates.length}`,
    );
  }
  return candidates[0] || null;
}

export function validateReleaseMergeActor(
  pr,
  appBotLogin = process.env.RELEASE_APP_BOT_LOGIN || '',
) {
  const mergedBy = pr?.merged_by || pr?.mergedBy;
  if (!mergedBy?.login) throw new Error('merged Release PR merged_by is missing');
  if (!isReleaseBot(mergedBy, appBotLogin)) {
    throw new Error(
      `merged Release PR actor is not the configured release App bot: ${mergedBy.login}`,
    );
  }
  return true;
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

function runCommand(command, args, { allowFailure = false, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env,
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
  { method, fields = [], allowNotFound = false, paginate = false, tokenEnv = 'GH_TOKEN' } = {},
) {
  const token = process.env[tokenEnv];
  if (!token) throw new Error(`${tokenEnv} is required for GitHub API reads and writes`);
  const args = ['api', apiPath(repository, apiPathValue)];
  if (method) args.push('--method', method);
  if (paginate) args.push('--paginate', '--slurp');
  for (const field of fields) args.push('--raw-field', field);
  const result = runCommand('gh', args, {
    allowFailure: allowNotFound,
    env: { ...process.env, GH_TOKEN: token },
  });
  if (result.status !== 0) {
    const message = `${result.stdout}
${result.stderr}`.trim();
    if (allowNotFound && /(?:404|not found)/i.test(message)) return null;
    if (result.status === 403 || /\b403\b|forbidden|resource not accessible/i.test(message)) {
      throw new Error(formatGitHubApiError(apiPathValue, 403, tokenEnv));
    }
    throw new Error(`gh api ${apiPathValue} failed: ${message}`);
  }
  if (!result.stdout.trim()) return {};
  const parsed = parseJsonOutput(result, apiPathValue);
  if (!paginate) return parsed;
  return Array.isArray(parsed)
    ? parsed.flatMap((page) => (Array.isArray(page) ? page : [page]))
    : [parsed];
}

function getBlobShaAtCommit(repository, relativePath, sha) {
  const response = ghApi(
    repository,
    `contents/${relativePath
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/')}?ref=${encodeURIComponent(sha)}`,
    { allowNotFound: true },
  );
  if (response === null) return '';
  const blobSha = asSha(response?.sha);
  if (!blobSha) {
    throw new Error(`${relativePath} at ${sha} did not return a valid blob SHA`);
  }
  return blobSha;
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

export function validateReleasePrMetadataSnapshot(pr, version) {
  const expectedVersion = asVersion(version);
  if (!expectedVersion) throw new Error('Release PR metadata requires a valid version');
  const expectedTitle = `chore(main): release ${expectedVersion}`;
  if (pr?.title !== expectedTitle) {
    throw new Error(`Release PR title does not match the expected ${expectedVersion} title`);
  }
  const releases = parseReleasePleaseBody(pr?.body);
  if (
    releases.length !== 1 ||
    releases.some(
      (release) =>
        release.component || release.version !== expectedVersion || !asVersion(release.version),
    )
  ) {
    throw new Error(`Release PR body does not contain exactly the root release ${expectedVersion}`);
  }
  return { version: expectedVersion };
}

function validateReleasePrMetadata(repository, pr, sha) {
  const version = releaseVersionAtCommit(repository, sha);
  return validateReleasePrMetadataSnapshot(pr, version);
}

function compareRelease(repository, baseSha, headSha) {
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
  return {
    files: files.flatMap((file) => [file?.filename, file?.previous_filename]).filter(Boolean),
    mergeBaseSha: asSha(response?.merge_base_commit?.sha),
    status: asString(response?.status),
  };
}

function compareCommitRelation(repository, baseSha, headSha) {
  const response = ghApi(repository, `compare/${baseSha}...${headSha}?per_page=1`);
  const mergeBaseSha = asSha(response?.merge_base_commit?.sha);
  const status = asString(response?.status);
  if (!mergeBaseSha || !status) {
    throw new Error(`compare response for ${baseSha}...${headSha} is incomplete`);
  }
  return { mergeBaseSha, status };
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

export function validateReleaseChangedPaths(changedPaths, allowedPaths) {
  const allowlist = new Set(Array.isArray(allowedPaths) ? allowedPaths : []);
  const disallowed = [...new Set(Array.isArray(changedPaths) ? changedPaths : [])].filter(
    (file) => !allowlist.has(file),
  );
  if (disallowed.length > 0) {
    throw new Error(`Release PR changes non-Release Please files: ${disallowed.join(', ')}`);
  }
  return true;
}

export function decideReleaseAssociation({
  changedPaths = [],
  releaseVersionPaths = [],
  hasCanonical = false,
} = {}) {
  const ownedVersionPaths = new Set(
    (Array.isArray(releaseVersionPaths) ? releaseVersionPaths : [])
      .map((relativePath) => asString(relativePath))
      .filter(Boolean),
  );
  const touchesVersionPath = (Array.isArray(changedPaths) ? changedPaths : []).some(
    (relativePath) => ownedVersionPaths.has(asString(relativePath)),
  );
  return {
    action: hasCanonical ? 'release' : touchesVersionPath ? 'refuse' : 'ordinary',
    touchesVersionPath,
  };
}

const WEB_FLOW_COMMITTER_ID = 19864447;

function webFlowCommitterValidationError(headCommit) {
  const committer = headCommit?.committer;
  if (!committer || typeof committer !== 'object' || Array.isArray(committer)) {
    return 'committer object is missing';
  }
  if (committer.login !== 'web-flow') return 'committer.login must be web-flow';
  if (committer.id !== WEB_FLOW_COMMITTER_ID) {
    return `committer.id must be ${WEB_FLOW_COMMITTER_ID}`;
  }
  if (committer.type !== 'User') return 'committer.type must be User';

  const gitCommitter = headCommit?.commit?.committer;
  if (!gitCommitter || typeof gitCommitter !== 'object' || Array.isArray(gitCommitter)) {
    return 'commit.committer object is missing';
  }
  if (gitCommitter.name !== 'GitHub') return 'commit.committer.name must be GitHub';
  if (gitCommitter.email !== 'noreply@github.com') {
    return 'commit.committer.email must be noreply@github.com';
  }

  const verification = headCommit?.commit?.verification;
  if (!verification || typeof verification !== 'object' || Array.isArray(verification)) {
    return 'commit.verification object is missing';
  }
  if (verification.verified !== true) return 'commit.verification.verified must be true';
  if (verification.reason !== 'valid') return 'commit.verification.reason must be valid';
  return null;
}

export function isVerifiedWebFlowCommitter(headCommit) {
  return webFlowCommitterValidationError(headCommit) === null;
}

export function isSafeMergeConflict(message) {
  return /\b(?:405|409)\b|conflict|head.*changed|base.*changed/i.test(asString(message));
}

export function validateReleasePrSnapshot({
  workflowRun,
  pr,
  repository = 'takano536/kobako',
  mainSha,
  mergeBaseSha = mainSha,
  allowStaleBase = false,
  headSha,
  headCommit,
  checkRuns,
  changedPaths = [],
  allowedPaths = [],
  appBotLogin = process.env.RELEASE_APP_BOT_LOGIN || '',
} = {}) {
  const runValidation = validateWorkflowRunMetadata(workflowRun, {
    repository,
    headSha,
    headBranch: RELEASE_BRANCH,
  });
  if (!runValidation.ok) throw new Error(runValidation.errors.join('; '));
  const identity = validateCanonicalReleasePr(pr, {
    repository,
    state: 'open',
    expectedHeadSha: headSha,
    appBotLogin,
  });
  if (!identity.ok) throw new Error(identity.errors.join('; '));
  if (asString(pr?.base?.ref) !== 'main') {
    throw new Error(`Release PR base ref must be main, got ${pr?.base?.ref || 'missing'}`);
  }
  const parents = Array.isArray(headCommit?.parents)
    ? headCommit.parents.map((parent) => asSha(parent?.sha)).filter(Boolean)
    : [];
  const parentSha = parents[0];
  const liveMainSha = asSha(mainSha);
  const verifiedMergeBase = asSha(mergeBaseSha);
  const isLiveMainParent = parents.length === 1 && parentSha === liveMainSha;
  const isAllowedStaleParent =
    allowStaleBase &&
    parents.length === 1 &&
    parentSha &&
    verifiedMergeBase &&
    parentSha === verifiedMergeBase &&
    parentSha !== liveMainSha;
  if (!isLiveMainParent && !isAllowedStaleParent) {
    throw new Error(
      `Release PR head must have live main ${mainSha} as its sole parent or the verified merge base ${verifiedMergeBase || 'missing'}`,
    );
  }
  validateReleaseChangedPaths(changedPaths, allowedPaths);
  if (!isReleaseBot(headCommit?.author, appBotLogin)) {
    throw new Error('Release PR head author is not the configured release App bot');
  }
  const committerError = webFlowCommitterValidationError(headCommit);
  if (committerError) {
    throw new Error(`Release PR head ${committerError}`);
  }
  const checks = selectLatestRequiredChecks(checkRuns);
  if (!checks.ok) {
    throw new Error(`required native PR checks are not complete: ${checks.errors.join('; ')}`);
  }
  return { identity, checks };
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

function workflowRun(repository, id) {
  if (!/^[0-9]+$/.test(id)) throw new Error(`invalid workflow run id: ${id || 'missing'}`);
  return ghApi(repository, `actions/runs/${id}`);
}

function workflowRunJobs(repository, id) {
  if (!/^[0-9]+$/.test(String(id))) throw new Error(`invalid workflow run id: ${id || 'missing'}`);
  const response = ghApi(repository, `actions/runs/${id}/jobs?per_page=100`);
  return Array.isArray(response?.jobs) ? response.jobs : [];
}

function workflowRunsForHead(repository, sha, { event, branch } = {}) {
  const params = new URLSearchParams({ head_sha: sha, per_page: '100' });
  if (event) params.set('event', event);
  if (branch) params.set('branch', branch);
  const response = ghApi(repository, `actions/runs?${params.toString()}`);
  return Array.isArray(response?.workflow_runs) ? response.workflow_runs : [];
}

function compareWorkflowRuns(left, right) {
  const leftAttempt = Number(left?.run_attempt) || 0;
  const rightAttempt = Number(right?.run_attempt) || 0;
  if (leftAttempt !== rightAttempt) return leftAttempt - rightAttempt;
  const leftUpdated = asString(left?.updated_at || left?.created_at);
  const rightUpdated = asString(right?.updated_at || right?.created_at);
  if (leftUpdated !== rightUpdated) return leftUpdated < rightUpdated ? -1 : 1;
  return (Number(left?.id) || 0) - (Number(right?.id) || 0);
}

export function selectLatestWorkflowRun(
  runs,
  { repository = 'takano536/kobako', event, headSha, headBranch } = {},
) {
  const expectedSha = asSha(headSha);
  const expectedRepository = repositoryName(repository);
  return (
    (Array.isArray(runs) ? runs : [])
      .filter(
        (run) =>
          run?.name === 'CI' &&
          (!event || run.event === event) &&
          (!expectedSha || asSha(run.head_sha) === expectedSha) &&
          (!headBranch || asString(run.head_branch) === headBranch) &&
          (!run.head_repository || repositoryOf(run.head_repository) === expectedRepository),
      )
      .sort(compareWorkflowRuns)
      .at(-1) || null
  );
}

export function validateReleasePleaseJob(jobs) {
  const candidates = (Array.isArray(jobs) ? jobs : [])
    .filter((job) => job?.name === 'release-please')
    .sort((left, right) => {
      const leftAttempt = Number(left?.run_attempt) || 0;
      const rightAttempt = Number(right?.run_attempt) || 0;
      if (leftAttempt !== rightAttempt) return leftAttempt - rightAttempt;
      const leftCompleted = asString(left?.completed_at || left?.started_at);
      const rightCompleted = asString(right?.completed_at || right?.started_at);
      if (leftCompleted !== rightCompleted) return leftCompleted < rightCompleted ? -1 : 1;
      return (Number(left?.id) || 0) - (Number(right?.id) || 0);
    });
  const job = candidates.at(-1);
  if (!job) return { ok: false, error: 'release-please job is missing' };
  if (job.status !== 'completed' || job.conclusion !== 'success') {
    return {
      ok: false,
      error: `release-please job is ${job.status || 'missing'}/${job.conclusion || 'missing'}`,
    };
  }
  return { ok: true, error: '', job };
}

export function selectCanonicalOpenReleasePr(
  pullRequests,
  { repository = 'takano536/kobako', appBotLogin = process.env.RELEASE_APP_BOT_LOGIN || '' } = {},
) {
  const matching = (Array.isArray(pullRequests) ? pullRequests : []).filter(
    (pr) => pr?.head?.ref === RELEASE_BRANCH,
  );
  const candidates = [];
  const errors = [];
  for (const pr of matching) {
    const identity = validateCanonicalReleasePr(pr, {
      repository,
      state: 'open',
      appBotLogin,
    });
    if (identity.ok) candidates.push({ pr, identity });
    else errors.push(identity.errors.join('; '));
  }
  if (candidates.length > 1) {
    throw new Error(`expected one canonical open Release PR, found ${candidates.length}`);
  }
  if (candidates.length === 0 && errors.length > 0) {
    throw new Error(`no canonical open Release PR: ${errors.join('; ')}`);
  }
  return candidates[0] || null;
}

function openReleasePullRequests(repository) {
  const head = encodeURIComponent(`${repository}:${RELEASE_BRANCH}`);
  return ghApi(repository, `pulls?state=open&head=${head}&per_page=100`);
}

function pullRequestsForCommit(repository, sha) {
  return ghApi(repository, `commits/${sha}/pulls?per_page=100`, { paginate: true });
}

function commitParents(commit) {
  return Array.isArray(commit?.parents)
    ? commit.parents.map((parent) => asSha(parent?.sha)).filter(Boolean)
    : [];
}

function releasePullRequestsForCommit(repository, sha) {
  return pullRequestsForCommit(repository, sha).filter(
    (pr) =>
      pr?.head?.ref === RELEASE_BRANCH || pr?.base?.ref === 'main' || pr?.merge_commit_sha === sha,
  );
}

function releaseChangedPathsForCommit(repository, mergeSha, releasePaths) {
  const parents = commitParents(getCommit(repository, mergeSha));
  const paths = Array.isArray(releasePaths) ? releasePaths : [];
  return paths.filter((relativePath) => {
    const mergeBlobSha = getBlobShaAtCommit(repository, relativePath, mergeSha);
    return parents.some(
      (parentSha) => getBlobShaAtCommit(repository, relativePath, parentSha) !== mergeBlobSha,
    );
  });
}

function retryCanonicalMergedReleaseForCommit(repository, mergeSha, attempts = 3) {
  for (let attempt = 1; attempt < attempts; attempt += 1) {
    runCommand('sleep', [String(attempt)]);
    const pullRequests = releasePullRequestsForCommit(repository, mergeSha);
    const candidate = canonicalMergedReleaseForCommit(repository, mergeSha, pullRequests);
    if (candidate) return candidate;
  }
  return null;
}

function detailedPullRequests(repository, pullRequests) {
  return (Array.isArray(pullRequests) ? pullRequests : []).map((pr) =>
    pr?.number ? getPullRequest(repository, pr.number) : pr,
  );
}
function canonicalMergedReleaseForCommit(repository, mergeSha, pullRequests) {
  const detailed = detailedPullRequests(repository, pullRequests);
  const candidates = selectCanonicalMergedReleasePr(detailed, mergeSha, {
    repository,
  });
  if (candidates) return candidates;
  const releasePullRequests = detailed.filter(
    (pr) => pr?.head?.ref === RELEASE_BRANCH || pr?.merge_commit_sha === mergeSha,
  );
  if (releasePullRequests.length > 0) {
    const reasons = releasePullRequests.flatMap((pr) => {
      const identity = validateCanonicalReleasePr(pr, {
        repository,
        state: 'merged',
        expectedMergeSha: mergeSha,
        allowTaggedRecovery: true,
      });
      return identity.errors;
    });
    throw new Error(`no canonical merged Release PR for ${mergeSha}: ${reasons.join('; ')}`);
  }
  return null;
}

function validateMergedRelease(repository, pr, mergeSha) {
  const identity = validateCanonicalReleasePr(pr, {
    repository,
    state: 'merged',
    expectedMergeSha: mergeSha,
    allowTaggedRecovery: true,
  });
  if (!identity.ok) throw new Error(identity.errors.join('; '));
  validateReleaseMergeActor(pr);
  const { version } = validateReleasePrMetadata(repository, pr, mergeSha);
  return { identity, version };
}

function validateMergedReleaseCommit(repository, mergeSha) {
  const parents = commitParents(getCommit(repository, mergeSha));
  if (parents.length !== 1) {
    throw new Error(`release merge ${mergeSha} must be a squash commit with one sole parent`);
  }
  const baseSha = parents[0];
  const config = readReleasePleaseConfig();
  const comparison = compareRelease(repository, baseSha, mergeSha);
  if (comparison.mergeBaseSha !== baseSha) {
    throw new Error(`release merge ${mergeSha} is not directly based on ${baseSha}`);
  }
  validateReleaseChangedPaths(comparison.files, [...releaseOwnedPaths(config)]);
  validateReleasePrFileContents(repository, config, baseSha, mergeSha);
  return { baseSha };
}

export function validateMainReleaseAncestry({ mergeSha, mainSha, mergeBaseSha, status } = {}) {
  const expectedMergeSha = asSha(mergeSha);
  const liveMainSha = asSha(mainSha);
  const relationMergeBaseSha = asSha(mergeBaseSha);
  if (!expectedMergeSha || !liveMainSha) {
    throw new Error('main release ancestry requires full merge and main SHAs');
  }
  if (
    relationMergeBaseSha !== expectedMergeSha ||
    !['ahead', 'identical'].includes(asString(status))
  ) {
    throw new Error(
      `live main ${liveMainSha} must be identical to or ahead of release merge ${expectedMergeSha}`,
    );
  }
  if (asString(status) === 'identical' && liveMainSha !== expectedMergeSha) {
    throw new Error(`identical main ancestry has different SHA ${liveMainSha}`);
  }
  return true;
}

function commandClassifyMainRelease() {
  const repository = repositoryEnvironment();
  const mergeSha = asSha(process.env.MERGE_SHA || process.env.GITHUB_SHA);
  if (!mergeSha) throw new Error('MERGE_SHA is not a full commit SHA');
  if (process.env.GITHUB_EVENT_NAME && process.env.GITHUB_EVENT_NAME !== 'push') {
    throw new Error(`release candidate requires push, got ${process.env.GITHUB_EVENT_NAME}`);
  }
  const releaseVersionPaths = [...releaseOwnedVersionPaths(readReleasePleaseConfig())];
  const changedPaths = releaseChangedPathsForCommit(repository, mergeSha, releaseVersionPaths);
  const pullRequests = releasePullRequestsForCommit(repository, mergeSha);
  const associationWithoutCandidate = decideReleaseAssociation({
    changedPaths,
    releaseVersionPaths,
    hasCanonical: false,
  });
  let candidate = null;
  if (associationWithoutCandidate.touchesVersionPath) {
    candidate = canonicalMergedReleaseForCommit(repository, mergeSha, pullRequests);
  }
  const association = decideReleaseAssociation({
    changedPaths,
    releaseVersionPaths,
    hasCanonical: Boolean(candidate),
  });
  if (!candidate && association.action === 'refuse') {
    candidate = retryCanonicalMergedReleaseForCommit(repository, mergeSha);
    if (!candidate) {
      throw new Error(
        `release-owned version files changed in ${mergeSha}, but no canonical merged Release PR was found after bounded association retries; rerun this job`,
      );
    }
  }
  if (!candidate) {
    emit('is_release', 'false');
    emit('pr_number', '');
    emit('version', '');
    return;
  }
  const { version } = validateMergedRelease(repository, candidate.pr, mergeSha);
  validateMergedReleaseCommit(repository, mergeSha);
  emit('is_release', 'true');
  emit('pr_number', String(candidate.pr.number));
  emit('version', version);
}

function commandValidateMainRelease() {
  const repository = repositoryEnvironment();
  const mergeSha = asSha(requireEnvironment('MERGE_SHA'));
  const prNumber = requireEnvironment('PR_NUMBER');
  if (!mergeSha) throw new Error('MERGE_SHA is not a full commit SHA');
  const pr = getPullRequest(repository, prNumber);
  const { version } = validateMergedRelease(repository, pr, mergeSha);
  const mainSha = getMainSha(repository);
  const mainRelation = compareCommitRelation(repository, mergeSha, mainSha);
  validateMainReleaseAncestry({
    mergeSha,
    mainSha,
    mergeBaseSha: mainRelation.mergeBaseSha,
    status: mainRelation.status,
  });
  validateMergedReleaseCommit(repository, mergeSha);
  emit('validated', 'true');
  emit('pr_number', String(pr.number));
  emit('merge_sha', mergeSha);
  emit('version', version);
}

function commandRepairReleaseLabel() {
  const repository = repositoryEnvironment();
  const mergeSha = asSha(requireEnvironment('MERGE_SHA'));
  const prNumber = requireEnvironment('PR_NUMBER');
  if (!mergeSha) throw new Error('MERGE_SHA is not a full commit SHA');
  const pr = getPullRequest(repository, prNumber);
  validateMergedRelease(repository, pr, mergeSha);
  const decision = decideReleasePrLabelRepair(pr, {
    repository,
    expectedMergeSha: mergeSha,
    appBotLogin: process.env.RELEASE_APP_BOT_LOGIN || '',
  });
  if (decision.action === 'refuse') {
    throw new Error(`refusing Release PR label repair: ${decision.errors.join('; ')}`);
  }
  if (decision.action === 'noop') {
    emit('label_repair', 'noop');
    return;
  }
  for (const label of decision.add) {
    ghApi(repository, `issues/${pr.number}/labels`, {
      method: 'POST',
      fields: [`labels[]=${label}`],
    });
  }
  for (const label of decision.remove) {
    ghApi(repository, `issues/${pr.number}/labels/${encodeURIComponent(label)}`, {
      method: 'DELETE',
    });
  }
  emit('label_repair', 'repaired');
}

function alreadyMergedForHead(repository, headSha, pullRequests) {
  for (const pr of detailedPullRequests(repository, pullRequests)) {
    if (asSha(pr?.head?.sha) !== headSha || !(pr?.merged_at || pr?.merged)) continue;
    const mergeSha = asSha(pr?.merge_commit_sha || pr?.mergeCommit?.oid);
    if (!mergeSha) continue;
    const identity = validateCanonicalReleasePr(pr, {
      repository,
      state: 'merged',
      expectedMergeSha: mergeSha,
      allowTaggedRecovery: true,
    });
    if (identity.ok) return { pr, identity };
  }
  return null;
}

export function validateMainPushWorkflowRun(
  run,
  { repository = 'takano536/kobako', headSha = '', headBranch = 'main' } = {},
) {
  const errors = [];
  const expectedSha = asSha(headSha);
  if (run?.name !== 'CI')
    errors.push(`workflow_run workflow must be CI, got ${run?.name || 'missing'}`);
  if (run?.event !== 'push')
    errors.push(`workflow_run event must be push, got ${run?.event || 'missing'}`);
  if (run?.status !== 'completed') {
    errors.push(`workflow_run status is not completed: ${run?.status || 'missing'}`);
  }
  if (run?.conclusion !== 'success') {
    errors.push(`workflow_run conclusion is not success: ${run?.conclusion || 'missing'}`);
  }
  if (asString(run?.head_branch) !== headBranch) {
    errors.push(`workflow_run head branch changed: ${run?.head_branch || 'missing'}`);
  }
  if (expectedSha && asSha(run?.head_sha) !== expectedSha) {
    errors.push(
      `workflow_run head SHA ${run?.head_sha || 'missing'} does not match event head ${headSha}`,
    );
  }
  const headRepository = repositoryOf(run?.head_repository);
  if (headRepository && headRepository !== repositoryName(repository)) {
    errors.push(`workflow_run head repository is not canonical: ${headRepository}`);
  }

  return { ok: errors.length === 0, errors };
}
export function validateMainPushReleasePleaseEvidence({
  run,
  jobs,
  repository = 'takano536/kobako',
  headSha = '',
} = {}) {
  const runValidation = validateMainPushWorkflowRun(run, { repository, headSha });
  if (!runValidation.ok) return { ok: false, error: runValidation.errors.join('; ') };
  const releasePlease = validateReleasePleaseJob(jobs);
  if (!releasePlease.ok) return { ok: false, error: releasePlease.error };
  return { ok: true, error: '' };
}

function requireMainPushReleasePleaseSuccess(repository, mainSha) {
  const runs = workflowRunsForHead(repository, mainSha, { event: 'push', branch: 'main' });
  const latest = selectLatestWorkflowRun(runs, {
    repository,
    event: 'push',
    headSha: mainSha,
    headBranch: 'main',
  });
  if (!latest) {
    throw new Error(
      `live main ${mainSha} has no completed CI push run to prove Release Please evaluated it`,
    );
  }
  const evidence = validateMainPushReleasePleaseEvidence({
    run: latest,
    jobs: workflowRunJobs(repository, latest.id),
    repository,
    headSha: mainSha,
  });
  if (!evidence.ok) {
    throw new Error(
      `live main ${mainSha} Release Please evaluation is not successful: ${evidence.error}`,
    );
  }
  return latest;
}

function latestSuccessfulReleasePrWorkflowRun(repository, headSha) {
  const runs = workflowRunsForHead(repository, headSha, {
    event: 'pull_request',
    branch: RELEASE_BRANCH,
  });
  const latest = selectLatestWorkflowRun(runs, {
    repository,
    event: 'pull_request',
    headSha,
    headBranch: RELEASE_BRANCH,
  });
  if (!latest) {
    throw new Error(`Release PR head ${headSha} has no native pull_request CI run`);
  }
  if (latest.status !== 'completed' || latest.conclusion !== 'success') {
    throw new Error(
      `latest native pull_request CI run for ${headSha} is ${
        latest.status || 'missing'
      }/${latest.conclusion || 'missing'}`,
    );
  }
  return latest;
}

function evaluateCanonicalOpenReleasePr(repository, { run, pr, expectedHeadSha }) {
  const mainSha = getMainSha(repository);
  const headSha = asSha(expectedHeadSha);
  const headCommit = getCommit(repository, headSha);
  const config = readReleasePleaseConfig();
  const comparison = compareRelease(repository, mainSha, headSha);
  const diffBaseSha = comparison.mergeBaseSha;
  if (!diffBaseSha) {
    throw new Error(`Release PR compare did not return a merge base for ${mainSha}...${headSha}`);
  }
  let releaseComparison = comparison;
  let allowStaleBase = false;
  if (diffBaseSha !== mainSha) {
    requireMainPushReleasePleaseSuccess(repository, mainSha);
    const baseToMain = compareCommitRelation(repository, diffBaseSha, mainSha);
    allowStaleBase = baseToMain.status === 'ahead' || baseToMain.status === 'identical';
    if (!allowStaleBase) {
      throw new Error(
        `Release PR merge base ${diffBaseSha} is not an ancestor of live main ${mainSha}`,
      );
    }
    releaseComparison = compareRelease(repository, diffBaseSha, headSha);
    if (releaseComparison.mergeBaseSha !== diffBaseSha) {
      throw new Error(
        `Release PR head ${headSha} does not descend directly from merge base ${diffBaseSha}`,
      );
    }
  }
  validateReleasePrSnapshot({
    workflowRun: run,
    pr,
    repository,
    mainSha,
    mergeBaseSha: diffBaseSha,
    allowStaleBase,
    headSha,
    headCommit,
    checkRuns: getCheckRuns(repository, headSha),
    changedPaths: releaseComparison.files,
    allowedPaths: [...releaseOwnedPaths(config)],
    appBotLogin: process.env.RELEASE_APP_BOT_LOGIN || '',
  });
  validateReleasePrFileContents(repository, config, diffBaseSha, headSha);
  validateReleasePrMetadata(repository, pr, headSha);
  const mergeMainSha = getMainSha(repository);
  if (mergeMainSha !== mainSha) {
    throw new Error(
      `live main moved from ${mainSha} to ${mergeMainSha} during evaluator validation`,
    );
  }
  const currentPr = getPullRequest(repository, pr.number);
  validateReleasePrBeforeMerge(currentPr, {
    repository,
    expectedHeadSha: headSha,
    appBotLogin: process.env.RELEASE_APP_BOT_LOGIN || '',
  });
  const currentChecks = selectLatestRequiredChecks(getCheckRuns(repository, headSha));
  if (!currentChecks.ok) {
    throw new Error(
      `required native PR checks changed before merge: ${currentChecks.errors.join('; ')}`,
    );
  }
  validateReleasePrMetadata(repository, currentPr, headSha);
  const title = asString(currentPr?.title);
  if (!title || /[\r\n]/.test(title))
    throw new Error('Release PR title is missing or contains a newline');
  const commitTitle = `${title} (#${currentPr.number})`;
  let mergeResponse;
  try {
    mergeResponse = ghApi(repository, `pulls/${pr.number}/merge`, {
      method: 'PUT',
      fields: [`sha=${headSha}`, 'merge_method=squash', `commit_title=${commitTitle}`],
      tokenEnv: 'MERGE_GH_TOKEN',
    });
  } catch (error) {
    if (isSafeMergeConflict(error.message)) {
      throw new Error(
        `Release PR merge stopped safely due to conflict or stale base: ${error.message}`,
        { cause: error },
      );
    }
    throw new Error(`Release PR merge failed: ${error.message}`, { cause: error });
  }
  if (mergeResponse?.merged !== true) {
    const current = getPullRequest(repository, pr.number);
    if (!(current?.merged_at || current?.merged)) {
      throw new Error(
        `Release PR merge was not accepted: ${mergeResponse?.message || 'unknown response'}`,
      );
    }
  }
  const mergedPr = getPullRequest(repository, pr.number);
  const mergedIdentity = validateCanonicalReleasePr(mergedPr, {
    repository,
    state: 'merged',
    allowTaggedRecovery: true,
  });
  if (!mergedIdentity.ok) throw new Error(mergedIdentity.errors.join('; '));
  validateReleasePrMetadata(repository, mergedPr, mergedIdentity.mergeSha);
  emit('already_merged', 'false');
  emit('merged', 'true');
  emit('pr_number', String(pr.number));
  emit('head_sha', headSha);
  emit('merge_sha', mergedIdentity.mergeSha);
}
function commandEvaluateReleasePr() {
  const repository = repositoryEnvironment();
  const runId = requireEnvironment('WORKFLOW_RUN_ID');
  const expectedHeadSha = asSha(requireEnvironment('WORKFLOW_HEAD_SHA'));
  const expectedBranch = requireEnvironment('WORKFLOW_HEAD_BRANCH');
  if (!expectedHeadSha) throw new Error('workflow_run head SHA is not a full commit SHA');
  const run = workflowRun(repository, runId);
  validateReleaseAppConfiguration({
    clientId: process.env.RELEASE_APP_CLIENT_ID || 'configured-by-workflow',
    botLogin: process.env.RELEASE_APP_BOT_LOGIN,
    privateKey: process.env.RELEASE_APP_PRIVATE_KEY || 'provided-by-workflow',
  });

  if (run?.event === 'push' && expectedBranch === 'main') {
    const runValidation = validateMainPushWorkflowRun(run, {
      repository,
      headSha: expectedHeadSha,
      headBranch: 'main',
    });
    if (!runValidation.ok) throw new Error(runValidation.errors.join('; '));
    const mainSha = getMainSha(repository);
    if (mainSha !== expectedHeadSha) {
      throw new Error(`live main moved to ${mainSha} after push run ${expectedHeadSha}`);
    }
    requireMainPushReleasePleaseSuccess(repository, mainSha);
    const openPullRequests = detailedPullRequests(repository, openReleasePullRequests(repository));
    const candidate = selectCanonicalOpenReleasePr(openPullRequests, {
      repository,
      appBotLogin: process.env.RELEASE_APP_BOT_LOGIN || '',
    });
    if (!candidate) {
      emit('no_open_release_pr', 'true');
      return;
    }
    const headSha = asSha(candidate.pr?.head?.sha);
    if (!headSha) throw new Error('canonical open Release PR has no head SHA');
    const prRun = latestSuccessfulReleasePrWorkflowRun(repository, headSha);
    return evaluateCanonicalOpenReleasePr(repository, {
      run: prRun,
      pr: candidate.pr,
      expectedHeadSha: headSha,
    });
  }

  if (run?.event !== 'pull_request' || expectedBranch !== RELEASE_BRANCH) {
    throw new Error(
      `unsupported evaluator workflow run event/branch: ${run?.event || 'missing'}/${expectedBranch}`,
    );
  }
  const runValidation = validateWorkflowRunMetadata(run, {
    repository,
    headSha: expectedHeadSha,
    headBranch: RELEASE_BRANCH,
  });
  if (!runValidation.ok) throw new Error(runValidation.errors.join('; '));
  const pullRequests = pullRequestsForCommit(repository, expectedHeadSha);
  const open = pullRequests.filter(
    (pr) =>
      pr?.state === 'open' &&
      pr?.head?.ref === RELEASE_BRANCH &&
      asSha(pr?.head?.sha) === expectedHeadSha,
  );
  const merged = alreadyMergedForHead(repository, expectedHeadSha, pullRequests);
  if (open.length === 0) {
    if (merged) {
      validateMergedRelease(repository, merged.pr, merged.identity.mergeSha);
      emit('already_merged', 'true');
      emit('pr_number', String(merged.pr.number));
      emit('merge_sha', merged.identity.mergeSha);
      return;
    }
    throw new Error(`no open canonical Release PR has head ${expectedHeadSha}`);
  }
  if (open.length !== 1) {
    throw new Error(`expected one open Release PR for ${expectedHeadSha}, found ${open.length}`);
  }
  const pr = getPullRequest(repository, open[0].number);
  return evaluateCanonicalOpenReleasePr(repository, {
    run,
    pr,
    expectedHeadSha,
  });
}

function main() {
  const command = process.argv[2];
  if (command === 'classify-main-release') return commandClassifyMainRelease();
  if (command === 'validate-main-release') return commandValidateMainRelease();
  if (command === 'repair-release-label') return commandRepairReleaseLabel();
  if (command === 'evaluate-release-pr') return commandEvaluateReleasePr();
  throw new Error(
    'usage: release-automation.mjs <classify-main-release|validate-main-release|repair-release-label|evaluate-release-pr>',
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
