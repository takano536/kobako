import { TransactionNewContent } from '../../../transactions/new/page';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function NewTransactionModal({ searchParams }: { searchParams: SearchParams }) {
  return <TransactionNewContent searchParams={searchParams} showCancel />;
}
