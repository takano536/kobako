import { describe, expect, it } from 'vitest';

import { siteNavigationSection } from './site-navigation';

describe('site navigation section mapping', () => {
  it('maps top-level sections and their descendants', () => {
    expect(siteNavigationSection('/')).toBe('overview');
    expect(siteNavigationSection('/transactions')).toBe('transactions');
    expect(siteNavigationSection('/transactions/123/edit')).toBe('transactions');
    expect(siteNavigationSection('/balances')).toBe('balances');
    expect(siteNavigationSection('/balances/details')).toBe('balances');
    expect(siteNavigationSection('/settings/categories/expense')).toBe('settings');
  });

  it('maps account creation to balances', () => {
    expect(siteNavigationSection('/accounts/new')).toBe('balances');
  });

  it('maps account editing from its validated return section', () => {
    expect(
      siteNavigationSection('/accounts/12/edit', '/transactions?account=12&month=2024-06'),
    ).toBe('transactions');
    expect(siteNavigationSection('/accounts/12/edit', '/balances?month=2024-06')).toBe('balances');
    expect(siteNavigationSection('/accounts/12/edit', '/?month=2024-06')).toBe('overview');
  });

  it('falls back to transactions for missing or unsupported account returns', () => {
    expect(siteNavigationSection('/accounts/12/edit')).toBe('transactions');
    expect(siteNavigationSection('/accounts/12/edit', '/settings')).toBe('transactions');
    expect(siteNavigationSection('/accounts/12/edit', 'https://example.test/balances')).toBe(
      'transactions',
    );
  });

  it('leaves unrelated paths without a section', () => {
    expect(siteNavigationSection('/unknown')).toBeUndefined();
  });
});
