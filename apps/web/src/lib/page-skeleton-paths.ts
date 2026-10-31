export const PAGE_SKELETON_PATHS = [
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
] as const;

export type PageSkeletonPath = (typeof PAGE_SKELETON_PATHS)[number];

export function hasPageSkeleton(pathname: string): pathname is PageSkeletonPath {
  return (PAGE_SKELETON_PATHS as readonly string[]).includes(pathname);
}
