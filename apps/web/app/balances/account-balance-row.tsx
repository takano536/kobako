import { SignedYen } from '../_components/ui';

interface AccountBalanceRowProps {
  accountName: string;
  balance: string;
}

export function AccountBalanceRow({ accountName, balance }: AccountBalanceRowProps) {
  return (
    <li className="balance-row">
      <span className="balance-account-name">{accountName}</span>
      <span className="balance-amount">
        <SignedYen value={balance} />
      </span>
    </li>
  );
}
