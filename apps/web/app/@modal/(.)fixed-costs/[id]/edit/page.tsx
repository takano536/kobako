import { EditFixedCostContent } from '../../../../fixed-costs/[id]/edit/page';
export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

export default function EditFixedCostModal({ params }: { params: Params }) {
  return <EditFixedCostContent params={params} showCancel />;
}
