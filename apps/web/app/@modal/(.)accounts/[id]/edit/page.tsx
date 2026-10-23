import { AccountEditContent } from '../../../../accounts/[id]/edit/page';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function AccountEditModal({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  return <AccountEditContent params={params} searchParams={searchParams} />;
}
