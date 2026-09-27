import { describe, expect, it } from 'vitest';

import { MAX_INT4_ID, parseInt4Id } from './ids';

describe('int4 id parsing', () => {
  it('accepts canonical positive PostgreSQL serial ids through int4 max', () => {
    expect(parseInt4Id('1')).toBe(1);
    expect(parseInt4Id(String(MAX_INT4_ID))).toBe(MAX_INT4_ID);
  });

  it('rejects malformed, non-canonical, and out-of-range ids', () => {
    expect(parseInt4Id('0')).toBeUndefined();
    expect(parseInt4Id('007')).toBeUndefined();
    expect(parseInt4Id('1.0')).toBeUndefined();
    expect(parseInt4Id('-1')).toBeUndefined();
    expect(parseInt4Id(String(MAX_INT4_ID + 1))).toBeUndefined();
    expect(parseInt4Id('9'.repeat(100))).toBeUndefined();
  });
});
