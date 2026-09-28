#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootArgumentIndex = process.argv.indexOf('--root');
const root = path.resolve(
  rootArgumentIndex >= 0 && process.argv[rootArgumentIndex + 1]
    ? process.argv[rootArgumentIndex + 1]
    : process.cwd(),
);

const errors = [];

function readJson(relativePath) {
  const filePath = path.join(root, relativePath);
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    errors.push(`${relativePath}: ${error.message}`);
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    errors.push(`${relativePath}: invalid JSON (${error.message})`);
    return null;
  }
}

function readText(relativePath) {
  try {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
  } catch (error) {
    errors.push(`${relativePath}: ${error.message}`);
    return null;
  }
}

const packageJson = readJson('package.json');
const manifest = readJson('.release-please-manifest.json');
const releaseConfig = readJson('release-please-config.json');
const changelogPath = path.join(root, 'CHANGELOG.md');
const changelog = fs.existsSync(changelogPath) ? readText('CHANGELOG.md') : null;

const rootVersion = packageJson?.version;
if ((packageJson && typeof rootVersion !== 'string') || rootVersion?.length === 0) {
  errors.push('package.json: version must be a non-empty string');
}

if (manifest && (typeof manifest['.'] !== 'string' || manifest['.'].length === 0)) {
  errors.push('.release-please-manifest.json: "." must be a non-empty version string');
} else if (manifest && packageJson && manifest['.'] !== rootVersion) {
  errors.push(
    `.release-please-manifest.json: "." is ${JSON.stringify(manifest['.'])}, expected package.json version ${JSON.stringify(rootVersion)}`,
  );
}

const packagePaths = [
  'apps/web/package.json',
  'apps/worker/package.json',
  'packages/db/package.json',
];
for (const relativePath of packagePaths) {
  const workspacePackage = readJson(relativePath);
  if (workspacePackage && workspacePackage.version !== rootVersion) {
    errors.push(
      `${relativePath}: version is ${JSON.stringify(workspacePackage.version)}, expected ${JSON.stringify(rootVersion)}`,
    );
  }
}

const packageConfig = releaseConfig?.packages?.['.'];
const extraFiles = packageConfig?.['extra-files'];
if (!Array.isArray(extraFiles)) {
  errors.push('release-please-config.json: packages["."].extra-files must be an array');
} else {
  const configuredJsonPaths = new Set();
  const genericFiles = [];

  for (const extraFile of extraFiles) {
    if (!extraFile || typeof extraFile !== 'object') {
      errors.push('release-please-config.json: every extra-file must be an object');
      continue;
    }
    if (extraFile.type === 'json') {
      configuredJsonPaths.add(extraFile.path);
      if (extraFile.jsonpath !== '$.version') {
        errors.push(
          `release-please-config.json: ${extraFile.path} must update $.version, got ${JSON.stringify(extraFile.jsonpath)}`,
        );
      }
    } else if (extraFile.type === 'generic') {
      genericFiles.push(extraFile);
    }
  }

  for (const packagePath of packagePaths) {
    if (!configuredJsonPaths.has(packagePath)) {
      errors.push(`release-please-config.json: missing JSON extra-file for ${packagePath}`);
    }
  }

  for (const genericFile of genericFiles) {
    if (typeof genericFile.path !== 'string' || genericFile.path.length === 0) {
      errors.push('release-please-config.json: generic extra-file path must be a non-empty string');
      continue;
    }
    const genericContent = readText(genericFile.path);
    if (genericContent === null) continue;

    const marker = /:\s*([^\s#]+)\s+#\s*x-release-please-version/g;
    const markerVersions = [...genericContent.matchAll(marker)].map((match) => match[1]);
    if (markerVersions.length === 0) {
      errors.push(`${genericFile.path}: missing x-release-please-version marker`);
    } else {
      for (const markerVersion of markerVersions) {
        if (markerVersion !== rootVersion) {
          errors.push(
            `${genericFile.path}: marker version is ${JSON.stringify(markerVersion)}, expected ${JSON.stringify(rootVersion)}`,
          );
        }
      }
    }
  }
}

if (changelog !== null && !/^# Changelog(?:\r?\n|\r|$)/.test(changelog)) {
  errors.push('CHANGELOG.md: first line must be the # Changelog heading');
}

if (errors.length > 0) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Release-managed files are valid (${rootVersion})`);
}
