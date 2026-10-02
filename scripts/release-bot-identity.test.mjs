import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { isReleaseBot, validateCanonicalReleasePr, RELEASE_BRANCH } from './release-automation.mjs';

const repository = 'takano536/kobako';
const appBotLogin = 'kobako-release[bot]';
function pr(login = appBotLogin, type = 'Bot') {
  return {
    user: { login, type },
    state: 'open',
    draft: false,
    head: { ref: RELEASE_BRANCH, sha: 'b'.repeat(40), repo: { full_name: repository } },
    base: { ref: 'main', repo: { full_name: repository } },
    labels: [{ name: 'autorelease: pending' }],
  };
}
describe('repository-scoped release App identity', () => {
  it('rejects the GITHUB_TOKEN GitHub Actions bot identity', () => {
    assert.equal(isReleaseBot({ login: 'github-actions[bot]', type: 'Bot' }), false);
    assert.equal(
      validateCanonicalReleasePr(pr('github-actions[bot]'), { repository, appBotLogin }).ok,
      false,
    );
  });
  it('accepts only the explicitly configured App bot', () => {
    assert.equal(isReleaseBot({ login: appBotLogin, type: 'Bot' }, appBotLogin), true);
    assert.equal(validateCanonicalReleasePr(pr(), { repository, appBotLogin }).ok, true);
  });
  it('does not trust arbitrary bots or human accounts', () => {
    assert.equal(isReleaseBot({ login: appBotLogin, type: 'Bot' }), false);
    assert.equal(isReleaseBot({ login: 'other[bot]', type: 'Bot' }, appBotLogin), false);
    assert.equal(isReleaseBot({ login: appBotLogin, type: 'User' }, appBotLogin), false);
    assert.equal(
      validateCanonicalReleasePr(pr('other[bot]'), { repository, appBotLogin }).ok,
      false,
    );
    assert.equal(
      validateCanonicalReleasePr(pr(appBotLogin, 'User'), { repository, appBotLogin }).ok,
      false,
    );
  });
  it('rejects malformed configured bot identities', () => {
    for (const login of ['maintainer', '*[bot]', 'kobako-release', 'kobako-release[bot]\n']) {
      assert.equal(isReleaseBot({ login, type: 'Bot' }, login), false);
    }
  });
});
