import { AccountNewContent } from '../../../accounts/new/page';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function AccountNewModal({ searchParams }: { searchParams: SearchParams }) {
  return <AccountNewContent searchParams={searchParams} showCancel />;
}
