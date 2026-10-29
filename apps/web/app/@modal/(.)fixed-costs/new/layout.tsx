import { OverlayCard } from '../../../_components/overlay-card';

export default function NewFixedCostModalLayout({ children }: { children: React.ReactNode }) {
  return (
    <OverlayCard title="固定費を登録" kind="transaction" autoFocusSelector="#fixed-cost-name">
      {children}
    </OverlayCard>
  );
}
