export type TransactionFormField = 'type' | 'amount' | 'occurredOn' | 'categoryId' | 'memo';

export interface TransactionFormValues {
  type: string;
  amount: string;
  occurredOn: string;
  categoryId: string;
  memo: string;
}

export interface SanitizedAmountText {
  value: string;
  caret: number;
}

function normalizeAmountCharacter(character: string): string {
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint >= 0xff10 && codePoint <= 0xff19) {
    return String(codePoint - 0xff10);
  }
  if (character === '，' || character === ',') {
    return '';
  }
  if (character === '−' || character === '－') {
    return '-';
  }
  return character;
}

export function sanitizeAmountText(input: string): string {
  let result = '';
  for (const character of input) {
    const normalized = normalizeAmountCharacter(character);
    if (/^\d$/.test(normalized)) {
      result += normalized;
    } else if (normalized === '-' && result.length === 0) {
      result = '-';
    }
  }
  return result;
}

export function sanitizeAmountTextWithCaret(input: string, caret: number): SanitizedAmountText {
  const value = sanitizeAmountText(input);
  return {
    value,
    caret: sanitizeAmountText(input.slice(0, caret)).length,
  };
}

export type TransactionFieldErrors = Partial<Record<TransactionFormField, string[]>>;

export interface TransactionFormState {
  values?: TransactionFormValues;
  errors?: TransactionFieldErrors;
  message?: string;
}

export const emptyTransactionFormState: TransactionFormState = {};

export interface DeleteFormState {
  message?: string;
}
