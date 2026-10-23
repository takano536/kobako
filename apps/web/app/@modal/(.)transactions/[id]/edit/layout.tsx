import { OverlayCard } from '../../../../_components/overlay-card';

/**
 * カードの枠をレイアウトに置きます。中身は `page.tsx` がストリーミングで返すため、
 * 遷移直後は枠と `loading.tsx` の骨組みだけが先に表示されます。
 */
export default function TransactionEditModalLayout({ children }: { children: React.ReactNode }) {
  return (
    <OverlayCard title="取引を編集" kind="transaction" autoFocusSelector="#transaction-amount">
      {children}
    </OverlayCard>
  );
}
