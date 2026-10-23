import { TransactionEditContent } from '../../../../transactions/[id]/edit/page';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function TransactionEditModal({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  return <TransactionEditContent params={params} searchParams={searchParams} />;
}
