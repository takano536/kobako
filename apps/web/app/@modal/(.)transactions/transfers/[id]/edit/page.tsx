import { OverlayCard } from '../../../../../_components/overlay-card';
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
  return (
    <OverlayCard title="取引を編集" kind="transaction" autoFocusSelector="#transaction-amount">
      <TransferEditContent params={params} searchParams={searchParams} />
    </OverlayCard>
  );
}
