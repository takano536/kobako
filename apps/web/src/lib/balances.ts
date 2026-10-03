export interface BalanceAmount {
  balance: string;
}

export function calculateBalanceTotal(balances: readonly BalanceAmount[]): string {
  return balances.reduce((total, { balance }) => total + BigInt(balance), 0n).toString();
}
