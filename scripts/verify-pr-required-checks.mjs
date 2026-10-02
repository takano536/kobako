#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { REQUIRED_CHECKS } from './release-automation.mjs';

// Input is `gh pr checks --required --json name,state`, i.e. GitHub's PR
// rollup, not a successful workflow_dispatch check suite on the head commit.
export function validatePrRequiredChecks(checks) {
  if (!Array.isArray(checks)) throw new Error('PR required checks must be an array');
  for (const name of REQUIRED_CHECKS) {
    const matches = checks.filter((check) => check?.name === name);
    if (matches.length !== 1 || matches[0].state !== 'SUCCESS') {
      throw new Error(`PR required check ${name} is missing, ambiguous or not SUCCESS`);
    }
  }
  for (const check of checks) {
    if (check?.state !== 'SUCCESS') {
      throw new Error(`PR required check ${check?.name || 'unknown'} is not SUCCESS`);
    }
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    validatePrRequiredChecks(JSON.parse(fs.readFileSync(0, 'utf8')));
    console.log('GitHub PR required checks are all SUCCESS');
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
