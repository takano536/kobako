export interface BalanceAmount {
  balance: string;
}

export interface BalanceSummary {
  assets: string;
  liabilities: string;
  net: string;
}

export function calculateBalanceSummary(balances: readonly BalanceAmount[]): BalanceSummary {
  let assets = 0n;
  let liabilities = 0n;

  for (const { balance } of balances) {
    const amount = BigInt(balance);
    if (amount > 0n) {
      assets += amount;
    } else if (amount < 0n) {
      liabilities -= amount;
    }
  }

  return {
    assets: assets.toString(),
    liabilities: liabilities.toString(),
    net: (assets - liabilities).toString(),
  };
}
