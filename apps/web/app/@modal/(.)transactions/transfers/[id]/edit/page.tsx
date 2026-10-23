import { TransferEditContent } from '../../../../../transactions/transfers/[id]/edit/page';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function TransferEditModal({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  return <TransferEditContent params={params} searchParams={searchParams} />;
}
