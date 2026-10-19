import { OverlayCard } from '../../../../_components/overlay-card';
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
  return (
    <OverlayCard title="取引を編集" kind="transaction" autoFocusSelector="#transaction-amount">
      <TransactionEditContent params={params} searchParams={searchParams} />
    </OverlayCard>
  );
}
