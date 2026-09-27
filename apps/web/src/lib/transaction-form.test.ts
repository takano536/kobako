import { describe, expect, it } from 'vitest';

import { sanitizeAmountText, sanitizeAmountTextWithCaret } from './transaction-form';

describe('amount input sanitization', () => {
  it('keeps digits and one leading minus while normalizing pasted separators', () => {
    expect(sanitizeAmountText('1,200')).toBe('1200');
    expect(sanitizeAmountText('１２００')).toBe('1200');
    expect(sanitizeAmountText('−１，２００')).toBe('-1200');
    expect(sanitizeAmountText('12abc.3')).toBe('123');
    expect(sanitizeAmountText('1-2')).toBe('12');
  });

  it('maps the caret to the sanitized text', () => {
    expect(sanitizeAmountTextWithCaret('1,200', 2)).toEqual({ value: '1200', caret: 1 });
    expect(sanitizeAmountTextWithCaret('a−１２', 3)).toEqual({ value: '-12', caret: 2 });
  });
});
