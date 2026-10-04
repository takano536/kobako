export type BalanceAccountKind =
  'cash' | 'bank' | 'credit_card' | 'debit_card' | 'electronic_money' | 'other';

export interface BalanceAmount {
  balance: string;
  kind?: BalanceAccountKind;
}

export interface BalanceSummary {
  assets: string;
  liabilities: string;
  net: string;
}

export function calculateBalanceSummary(balances: readonly BalanceAmount[]): BalanceSummary {
  let assets = 0n;
  let liabilities = 0n;
  let net = 0n;

  for (const { balance, kind = 'other' } of balances) {
    const amount = BigInt(balance);
    net += amount;
    if (kind === 'credit_card') {
      liabilities -= amount;
    } else if (kind === 'cash' || kind === 'bank' || kind === 'electronic_money') {
      assets += amount;
    } else if (amount > 0n) {
      assets += amount;
    } else if (amount < 0n) {
      liabilities -= amount;
    }
  }

  return {
    assets: assets.toString(),
    liabilities: liabilities.toString(),
    net: net.toString(),
  };
}
