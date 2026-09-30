import type {
  MoneyManagerImportCounts,
  MoneyManagerImportPeriod,
  MoneyManagerImportPreview as DomainMoneyManagerImportPreview,
  MoneyManagerImportPreviewRow as DomainMoneyManagerImportPreviewRow,
} from '@kobako/db/money-manager';

export type MoneyManagerPreviewRow = DomainMoneyManagerImportPreviewRow;
export type MoneyManagerImportPreview = DomainMoneyManagerImportPreview;

export interface MoneyManagerImportSuccessState {
  transactionCount: number;
  counts: MoneyManagerImportCounts;
  period?: MoneyManagerImportPeriod;
  months: string[];
  createdCategories: number;
  createdAccounts: number;
}

export interface MoneyManagerImportState {
  phase: 'select' | 'preview' | 'success';
  message?: string;
  preview?: MoneyManagerImportPreview;
  success?: MoneyManagerImportSuccessState;
}

export const initialMoneyManagerImportState: MoneyManagerImportState = { phase: 'select' };
