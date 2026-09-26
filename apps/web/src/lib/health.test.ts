import { describe, expect, it } from 'vitest';

import { healthStatus } from './health.js';

describe('health response shape', () => {
  it('returns the public success shape without internal details', () => {
    expect(healthStatus('ok')).toEqual({ status: 'ok' });
  });

  it('returns the public error shape without internal details', () => {
    expect(healthStatus('error')).toEqual({ status: 'error' });
  });
});
