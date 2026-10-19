import { OverlayCard } from '../../../../_components/overlay-card';
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
  return (
    <OverlayCard title="資産設定" kind="asset" autoFocusSelector="#account-name">
      <AccountEditContent params={params} searchParams={searchParams} />
    </OverlayCard>
  );
}
