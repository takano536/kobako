import { OverlayCard } from '../../../_components/overlay-card';
import { AccountNewContent } from '../../../accounts/new/page';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function AccountNewModal({ searchParams }: { searchParams: SearchParams }) {
  return (
    <OverlayCard title="資産を登録" kind="asset" autoFocusSelector="#account-name">
      <AccountNewContent searchParams={searchParams} showCancel />
    </OverlayCard>
  );
}
