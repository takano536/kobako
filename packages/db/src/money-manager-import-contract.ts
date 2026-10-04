/** The three units represented by a Money Manager import. */
export type MoneyManagerImportKind = 'income' | 'expense' | 'transfer';

export interface MoneyManagerImportKindSummary {
  count: number;
  /** Integer JPY represented as a decimal string to keep the browser safe. */
  total: string;
}

export interface MoneyManagerImportCounts {
  income: MoneyManagerImportKindSummary;
  expense: MoneyManagerImportKindSummary;
  transfer: MoneyManagerImportKindSummary;
}

export interface MoneyManagerImportPeriod {
  from: string;
  to: string;
}

export interface MoneyManagerImportPreviewCategory {
  type: 'income' | 'expense';
  name: string;
}

export interface MoneyManagerImportPreviewAccount {
  name: string;
  sourceAccountId?: string;
}
/** A bounded, serializable row shown by the confirmation UI. */
export interface MoneyManagerImportPreviewRow {
  sourceRow: number;
  kind: MoneyManagerImportKind;
  date: string;
  content: string;
  amount: string;
  category?: string;
  account?: string;
  from?: string;
  to?: string;
}

export interface MoneyManagerImportPreviewRowError {
  row: number;
  excerpt: string;
  reason: string;
  suggestedFix: string;
}

export interface MoneyManagerImportPreviewFileError {
  reason: string;
  suggestedFix: string;
}

/**
 * Result returned by preview parsing. It contains no file bytes or unbounded cell data.
 * The server caps rows/errors before returning this value.
 */
export interface MoneyManagerImportPreview {
  hash: string;
  fileName: string;
  fileSize: number;
  readRowCount: number;
  importableCount: number;
  errorCount: number;
  counts: MoneyManagerImportCounts;
  period?: MoneyManagerImportPeriod;
  sampleRows: MoneyManagerImportPreviewRow[];
  rowErrors: MoneyManagerImportPreviewRowError[];
  fileError?: MoneyManagerImportPreviewFileError;
  newCategories: MoneyManagerImportPreviewCategory[];
  newAccounts: MoneyManagerImportPreviewAccount[];
  alreadyImported: boolean;
  previousImportDate?: string;
}

export interface MoneyManagerImportCategorySummary {
  type: 'income' | 'expense';
  name: string;
  id: number;
  action: 'created' | 'reused';
}

export interface MoneyManagerImportAccountSummary {
  name: string;
  id: number;
  action: 'created' | 'reused';
}

export interface MoneyManagerImportSuccess {
  status: 'imported';
  importId: number;
  transactionCount: number;
  counts: MoneyManagerImportCounts;
  period?: MoneyManagerImportPeriod;
  createdCategories: number;
  createdAccounts: number;
  categories: MoneyManagerImportCategorySummary[];
  accounts: MoneyManagerImportAccountSummary[];
}

export interface MoneyManagerImportDuplicate {
  status: 'duplicate';
  importId?: number;
  previousImportDate?: string;
}

export type MoneyManagerImportCommitResult =
  MoneyManagerImportSuccess | MoneyManagerImportDuplicate;
