import { describe, expect, it } from 'vitest';

import { hasPageSkeleton, PAGE_SKELETON_PATHS } from './page-skeleton-paths';
import { SITE_NAVIGATION_LINKS } from './site-navigation';

describe('page skeleton navigation destinations', () => {
  it('handles every site navigation link as a full-page destination', () => {
    expect(SITE_NAVIGATION_LINKS.every(({ href }) => hasPageSkeleton(href))).toBe(true);
  });

  it('keeps the existing full-page paths and excludes intercepted card paths', () => {
    expect(PAGE_SKELETON_PATHS).toEqual([
      '/',
      '/transactions',
      '/balances',
      '/fixed-costs',
      '/settings',
      '/settings/categories/asset',
      '/settings/categories/expense',
      '/settings/categories/income',
      '/settings/delete',
      '/settings/import',
    ]);

    expect(
      ['/transactions/new', '/fixed-costs/new', '/accounts/1/edit'].every(
        (pathname) => !hasPageSkeleton(pathname),
      ),
    ).toBe(true);
  });
});
