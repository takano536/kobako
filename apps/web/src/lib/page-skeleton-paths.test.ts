import { describe, expect, it } from 'vitest';

import { hasPageSkeleton } from './page-skeleton-paths';
import { SITE_NAVIGATION_LINKS } from './site-navigation';

describe('page skeleton navigation destinations', () => {
  it('handles every site navigation link as a full-page destination', () => {
    expect(SITE_NAVIGATION_LINKS.every(({ href }) => hasPageSkeleton(href))).toBe(true);
  });

  it('rejects intercepted, search-only, and non-canonical paths', () => {
    expect(
      [
        '/transactions/new',
        '/fixed-costs/new',
        '/accounts/1/edit',
        '/transactions/1/edit',
        '/fixed-costs/1/edit',
        '/transactions?month=2024-01',
        '/fixed-costs?category=food',
        '/transactions/',
        '/fixed-costs/',
      ].every((pathname) => !hasPageSkeleton(pathname)),
    ).toBe(true);
  });
});
