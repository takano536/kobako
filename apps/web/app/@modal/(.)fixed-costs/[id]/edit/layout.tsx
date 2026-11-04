import { OverlayCard } from '../../../../_components/overlay-card';

export default function EditFixedCostModalLayout({ children }: { children: React.ReactNode }) {
  return (
    <OverlayCard title="固定費を編集" kind="transaction" autoFocusSelector="#fixed-cost-name">
      {children}
    </OverlayCard>
  );
}
