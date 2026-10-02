import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'vitest';
import { REQUIRED_CHECKS } from './release-automation.mjs';
import { validatePrRequiredChecks } from './verify-pr-required-checks.mjs';

const success = () => REQUIRED_CHECKS.map((name) => ({ name, state: 'SUCCESS' }));
describe('GitHub PR required checks (not dispatch head checks)', () => {
  it('accepts all six successful PR required checks', () => {
    assert.equal(validatePrRequiredChecks(success()), true);
  });
  it('rejects absent PR checks even if dispatch passed', () => {
    assert.throws(() => validatePrRequiredChecks([]), /lint/);
  });
  it('rejects missing, duplicated and non-success checks', () => {
    assert.throws(() => validatePrRequiredChecks(success().slice(1)), /lint/);
    assert.throws(() => validatePrRequiredChecks([...success(), success()[0]]), /lint/);
    for (const state of [
      'PENDING',
      'FAILURE',
      'CANCELLED',
      'SKIPPED',
      'NEUTRAL',
      'EXPECTED',
      undefined,
    ]) {
      const checks = success();
      checks[0].state = state;
      assert.throws(() => validatePrRequiredChecks(checks), /lint/);
    }
  });
  it('requires any extra repository-required check to succeed too', () => {
    assert.throws(
      () => validatePrRequiredChecks([...success(), { name: 'security', state: 'FAILURE' }]),
      /security/,
    );
  });
  it('keeps the required-PR check gate before merge validation', async () => {
    const workflow = await readFile(
      new URL('../.github/workflows/ci.yml', import.meta.url),
      'utf8',
    );
    const mergeJob = workflow.slice(
      workflow.indexOf('  release_pr_merge:'),
      workflow.indexOf('  verify_guard:'),
    );
    assert.ok(mergeJob.includes('--required --watch --fail-fast'));
    assert.ok(
      mergeJob.indexOf('verify-pr-required-checks.mjs') < mergeJob.indexOf('validate-release-pr'),
    );
    assert.ok(workflow.includes('repositories: kobako'));
    assert.ok(workflow.includes('permission-contents: write'));
    assert.ok(workflow.includes('permission-pull-requests: write'));
  });
});
