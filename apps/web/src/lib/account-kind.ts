import type { AccountKindInput } from '@kobako/db';

export const ACCOUNT_KIND_OPTIONS = [
  ['cash', '現金'],
  ['bank', '銀行'],
  ['credit_card', 'クレジットカード'],
  ['debit_card', 'デビットカード'],
  ['electronic_money', '電子マネー'],
  ['other', 'その他'],
] as const satisfies ReadonlyArray<readonly [AccountKindInput, string]>;

export const ACCOUNT_KIND_LABELS: Record<AccountKindInput, string> = Object.fromEntries(
  ACCOUNT_KIND_OPTIONS,
) as Record<AccountKindInput, string>;
