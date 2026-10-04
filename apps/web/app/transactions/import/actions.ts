'use server';

import {
  commitMoneyManagerImport,
  listCategories,
  type MoneyManagerImportCommitResult,
  type MoneyManagerImportCounts,
  type MoneyManagerImportSuccess,
} from '@kobako/db';
import {
  MONEY_MANAGER_MAX_ROWS,
  MONEY_MANAGER_SOURCE,
  MONEY_MANAGER_XLSX_LIMITS,
  parseMoneyManagerXlsx,
  planMoneyManagerCategories,
  MoneyManagerXlsxError,
  type MoneyManagerNormalizationError,
  type MoneyManagerNormalizedRow,
} from '@kobako/db/money-manager';
import { createHash, randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import { getCurrentHouseholdId, getLedgerDatabase } from '../../../src/lib/ledger-data';
import type { MoneyManagerImportPreview, MoneyManagerImportState } from './state';

interface MoneyManagerUpload {
  bytes: Uint8Array;
  fileName: string;
  hash: string;
}

interface MoneyManagerBuiltPreview {
  preview: MoneyManagerImportPreview;
  rows: MoneyManagerNormalizedRow[];
  errors: MoneyManagerNormalizationError[];
}

const MAX_PREVIEW_ROWS_PER_KIND = 5;
const MAX_INCOME_SAMPLE_ROWS = 3;
const MAX_PREVIEW_ERRORS = 100;

function excerptText(excerpt: string, label: string): string {
  const match = new RegExp(`${label}=([^・]+)`).exec(excerpt);
  return match?.[1]?.trim() || '（空欄）';
}

function excerptValue(excerpt: string, label: string): string | undefined {
  const value = excerptText(excerpt, label);
  return value !== '（空欄）' ? value : undefined;
}
function humanExcerptText(excerpt: string, label: string): string {
  return excerptText(excerpt, label);
}

function humanDateExcerpt(value: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${Number(match[1])}月${Number(match[2])}日` : value;
}

function humanAmountExcerpt(value: string): string {
  if (!/^-?\d+\.0$/.test(value)) {
    return value;
  }
  const amount = Number(value.slice(0, -2));
  return `${amount.toLocaleString('ja-JP')}円`;
}

function humanRowExcerpt(excerpt: string): string {
  const date = humanDateExcerpt(humanExcerptText(excerpt, '日付'));
  const sourceType = humanExcerptText(excerpt, '種別');
  const type = sourceType === '引き出し' ? '振替' : sourceType;
  const amount = humanAmountExcerpt(humanExcerptText(excerpt, '金額'));
  if (sourceType === '引き出し') {
    const from = humanExcerptText(excerpt, '資産');
    const to = humanExcerptText(excerpt, '分類');
    return `${date}・${type}・${from} → ${to}・${amount}`;
  }
  return [
    date,
    type,
    humanExcerptText(excerpt, '分類'),
    humanExcerptText(excerpt, '内容'),
    amount,
  ].join('・');
}

function friendlyRowError(error: MoneyManagerNormalizationError): {
  reason: string;
  suggestedFix: string;
} {
  const amount = excerptValue(error.excerpt ?? '', '金額') ?? '空欄';
  const from = excerptValue(error.excerpt ?? '', '資産');
  const to = excerptValue(error.excerpt ?? '', '分類');
  switch (error.code) {
    case 'invalid-amount':
      return {
        reason: `金額「${amount}」を読み取れません。`,
        suggestedFix: '1円単位の金額にしてください。',
      };
    case 'same-asset':
      return {
        reason: `移動元と移動先が同じ「${from ?? to ?? '資産'}」です。`,
        suggestedFix: 'どちらかの資産を選び直してください。',
      };
    case 'invalid-asset':
      if (error.excerpt?.includes('種別=引き出し') && !to) {
        return {
          reason: '移動先の資産がありません。',
          suggestedFix: '移動先の資産を入力してください。',
        };
      }
      if (error.excerpt?.includes('種別=引き出し') && !from) {
        return {
          reason: '移動元の資産がありません。',
          suggestedFix: '移動元の資産を入力してください。',
        };
      }
      return {
        reason: '資産がありません。',
        suggestedFix: '資産を入力してください。',
      };
    case 'invalid-category':
      return {
        reason: 'カテゴリがありません。',
        suggestedFix: 'カテゴリを入力してください。',
      };
    case 'unknown-type':
      return {
        reason: '収入・支出・振替の種類を読み取れません。',
        suggestedFix: '収入、支出、引き出しのいずれかを選んでください。',
      };
    default:
      return {
        reason: error.reason ?? error.message,
        suggestedFix: error.suggestedFix ?? '該当するセルを確認して、ファイルを修正してください。',
      };
  }
}

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function formatFileSize(bytes: number): string {
  return `${Math.floor(bytes / (1024 * 1024))} MiB`;
}

function errorState(
  previousState: MoneyManagerImportState,
  message: string,
): MoneyManagerImportState {
  if (previousState.preview && previousState.phase === 'preview') {
    return { phase: 'preview', preview: previousState.preview, message };
  }
  return { phase: 'select', message };
}

function fileFromFormData(formData: FormData): File | null {
  const value = formData.get('file');
  return typeof File !== 'undefined' && value instanceof File ? value : null;
}

async function readUpload(formData: FormData): Promise<MoneyManagerUpload> {
  const file = fileFromFormData(formData);
  if (!file || file.size === 0) {
    throw new Error('ファイルを選択してください。');
  }
  if (!file.name || !/\.xlsx$/i.test(file.name)) {
    throw new Error('対応形式は .xlsx ファイルです。');
  }
  if (file.name.length > 255) {
    throw new Error('ファイル名が長すぎます。');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error('空のファイルは取り込めません。');
  }
  if (bytes.byteLength > MONEY_MANAGER_XLSX_LIMITS.maxFileBytes) {
    throw new Error(
      `ファイルサイズが上限（${formatFileSize(MONEY_MANAGER_XLSX_LIMITS.maxFileBytes)}）を超えています。`,
    );
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  return { bytes, fileName: file.name, hash };
}

function countsForRows(rows: readonly MoneyManagerNormalizedRow[]): MoneyManagerImportCounts {
  const counts: MoneyManagerImportCounts = {
    income: { count: 0, total: '0' },
    expense: { count: 0, total: '0' },
    transfer: { count: 0, total: '0' },
  };
  const totals = { income: 0n, expense: 0n, transfer: 0n };
  for (const row of rows) {
    counts[row.type].count += 1;
    totals[row.type] += BigInt(row.amount);
  }
  counts.income.total = totals.income.toString();
  counts.expense.total = totals.expense.toString();
  counts.transfer.total = totals.transfer.toString();
  return counts;
}

function periodForRows(
  rows: readonly MoneyManagerNormalizedRow[],
): { from: string; to: string } | undefined {
  const first = rows[0];
  if (!first) {
    return undefined;
  }
  let from = first.occurredOn;
  let to = first.occurredOn;
  for (const row of rows.slice(1)) {
    if (row.occurredOn < from) {
      from = row.occurredOn;
    }
    if (row.occurredOn > to) {
      to = row.occurredOn;
    }
  }
  return { from, to };
}
function sourceAccounts(
  rows: readonly MoneyManagerNormalizedRow[],
): { name: string; sourceAccountId?: string; sourceKey: string }[] {
  const seen = new Set<string>();
  const accounts: { name: string; sourceAccountId?: string; sourceKey: string }[] = [];
  for (const row of rows) {
    const rowAccounts =
      row.type === 'transfer'
        ? [
            { name: row.fromAccountName, sourceAccountId: row.fromSourceAccountId },
            { name: row.toAccountName, sourceAccountId: row.toSourceAccountId },
          ]
        : [{ name: row.accountName, sourceAccountId: row.sourceAccountId }];
    for (const account of rowAccounts) {
      const sourceKey = account.sourceAccountId
        ? `id:${account.sourceAccountId}`
        : `name:${account.name}`;
      if (!seen.has(sourceKey)) {
        seen.add(sourceKey);
        accounts.push({ ...account, sourceKey });
      }
    }
  }
  return accounts;
}

function previewRow(
  row: MoneyManagerNormalizedRow,
): MoneyManagerImportPreview['sampleRows'][number] {
  if (row.type === 'transfer') {
    return {
      sourceRow: row.sourceRow,
      kind: 'transfer',
      date: row.occurredOn,
      content: row.memo,
      amount: String(row.amount),
      from: row.fromAccountName,
      to: row.toAccountName,
    };
  }
  return {
    sourceRow: row.sourceRow,
    kind: row.type,
    date: row.occurredOn,
    content: row.memo,
    amount: String(row.amount),
    category: row.categoryName,
    account: row.accountName,
  };
}

function sampleRows(rows: readonly MoneyManagerNormalizedRow[]) {
  const ordered = [...rows].sort((left, right) => {
    const dateOrder = right.occurredOn.localeCompare(left.occurredOn);
    return dateOrder !== 0 ? dateOrder : right.sourceRow - left.sourceRow;
  });
  const selected: MoneyManagerNormalizedRow[] = [];
  selected.push(...ordered.filter((row) => row.type === 'income').slice(0, MAX_INCOME_SAMPLE_ROWS));
  selected.push(
    ...ordered.filter((row) => row.type === 'expense').slice(0, MAX_PREVIEW_ROWS_PER_KIND),
  );
  selected.push(
    ...ordered.filter((row) => row.type === 'transfer').slice(0, MAX_PREVIEW_ROWS_PER_KIND),
  );
  return selected
    .sort((left, right) => {
      const dateOrder = right.occurredOn.localeCompare(left.occurredOn);
      return dateOrder !== 0 ? dateOrder : right.sourceRow - left.sourceRow;
    })
    .map(previewRow);
}

function rowErrors(errors: readonly MoneyManagerNormalizationError[]) {
  return errors
    .filter(
      (error): error is MoneyManagerNormalizationError & { row: number } =>
        error.scope === 'row' && error.row !== undefined,
    )
    .slice(0, MAX_PREVIEW_ERRORS)
    .map((error) => {
      const copy = friendlyRowError(error);
      return {
        row: error.row,
        excerpt: error.excerpt ? humanRowExcerpt(error.excerpt) : '値を読み取れませんでした',
        reason: copy.reason,
        suggestedFix: copy.suggestedFix,
      };
    });
}

function isFileLevelError(error: MoneyManagerNormalizationError): boolean {
  return error.scope === 'file' || error.code === 'unsupported-header';
}

function fileErrorCopy(error: MoneyManagerNormalizationError): {
  reason: string;
  suggestedFix: string;
} {
  if (error.code === 'unsupported-header') {
    return {
      reason: 'らくな家計簿の Excel 形式ではありません。',
      suggestedFix: 'らくな家計簿 Android 日本語版から書き出した .xlsx を選んでください。',
    };
  }
  return {
    reason: error.reason ?? error.message,
    suggestedFix: error.suggestedFix ?? 'ファイルの内容を確認して、もう一度選択してください。',
  };
}

async function buildPreview(
  bytes: Uint8Array,
  fileName: string,
  hash: string,
  operationKey: string,
): Promise<MoneyManagerBuiltPreview> {
  const parsed = await parseMoneyManagerXlsx(bytes, { maxRows: MONEY_MANAGER_MAX_ROWS });
  const householdId = getCurrentHouseholdId();
  const db = getLedgerDatabase();
  const categories = await listCategories(db, householdId);
  const categoryPlan = planMoneyManagerCategories(parsed.rows, categories);
  const source = sourceAccounts(parsed.rows);
  const rowErrorNumbers = new Set(
    parsed.errors
      .filter((error) => error.scope === 'row' && error.row !== undefined)
      .map((error) => error.row),
  );
  const counts = countsForRows(parsed.rows);
  const firstFileError = parsed.errors.find(isFileLevelError);
  const previewRowErrors = firstFileError
    ? parsed.errors.filter((error) => error !== firstFileError)
    : parsed.errors;
  const preview: MoneyManagerImportPreview = {
    hash,
    operationKey,
    fileName,
    fileSize: bytes.byteLength,
    readRowCount: parsed.rows.length + rowErrorNumbers.size,
    importableCount: parsed.rows.length,
    errorCount: parsed.errors.length,
    counts,
    period: periodForRows(parsed.rows),
    sampleRows: sampleRows(parsed.rows),
    rowErrors: rowErrors(previewRowErrors),
    fileError: firstFileError ? fileErrorCopy(firstFileError) : undefined,
    newCategories: categoryPlan
      .filter((category) => category.action === 'create')
      .map(({ type, name }) => ({ type, name })),
    newAccounts: source.map(({ name, sourceAccountId }) => ({
      name,
      sourceAccountId,
    })),
  };
  return { preview, rows: parsed.rows, errors: parsed.errors };
}

function parserMessage(error: unknown): string {
  if (error instanceof MoneyManagerXlsxError) {
    return error.message;
  }
  return 'Excel ファイルを読み込めませんでした。対応形式を確認してください。';
}

function successState(
  rows: readonly MoneyManagerNormalizedRow[],
  committed: MoneyManagerImportSuccess,
): MoneyManagerImportState {
  return {
    phase: 'success',
    success: {
      transactionCount: committed.transactionCount,
      counts: committed.counts,
      createdCategories: committed.createdCategories,
      createdAccounts: committed.createdAccounts,
      period: committed.period ?? periodForRows(rows),
      months: [...new Set(rows.map((row) => row.occurredOn.slice(0, 7)))].sort(),
      duplicateOperation: false,
    },
  };
}

function isValidHash(value: string): boolean {
  return /^[a-f\d]{64}$/i.test(value);
}

export async function moneyManagerImportAction(
  previousState: MoneyManagerImportState,
  formData: FormData,
): Promise<MoneyManagerImportState> {
  const intent = textField(formData, 'intent') === 'confirm' ? 'confirm' : 'preview';
  let upload: MoneyManagerUpload;
  try {
    upload = await readUpload(formData);
  } catch (error) {
    return errorState(
      previousState,
      error instanceof Error ? error.message : 'ファイルを選択してください。',
    );
  }

  let operationKey: string = randomUUID();
  if (intent === 'confirm') {
    const expectedHash = textField(formData, 'expectedHash').toLowerCase();
    const expectedOperationKey = textField(formData, 'operationKey');
    if (
      !isValidHash(expectedHash) ||
      expectedHash !== upload.hash ||
      previousState.phase !== 'preview' ||
      previousState.preview?.hash !== expectedHash ||
      !expectedOperationKey ||
      previousState.preview.operationKey !== expectedOperationKey
    ) {
      return errorState(
        previousState,
        'プレビュー後にファイルが変更されています。同じファイルを選び直してください。',
      );
    }
    operationKey = expectedOperationKey;
  }

  let parsed: MoneyManagerBuiltPreview;
  try {
    parsed = await buildPreview(upload.bytes, upload.fileName, upload.hash, operationKey);
  } catch (error) {
    return errorState(previousState, parserMessage(error));
  }

  if (intent === 'preview') {
    return {
      phase: 'preview',
      preview: parsed.preview,
    };
  }

  if (parsed.errors.length > 0) {
    return {
      phase: 'preview',
      preview: parsed.preview,
      message: '確認が必要な行があります。ファイルを修正して、選び直してください。',
    };
  }
  if (parsed.rows.length === 0) {
    return {
      phase: 'preview',
      preview: parsed.preview,
      message: '取り込める取引がありません。別のファイルを選択してください。',
    };
  }

  let committed: MoneyManagerImportCommitResult;
  try {
    committed = await commitMoneyManagerImport(getLedgerDatabase(), {
      householdId: getCurrentHouseholdId(),
      source: MONEY_MANAGER_SOURCE,
      sha256: upload.hash,
      operationKey,
      originalFilename: upload.fileName,
      rows: parsed.rows,
    });
  } catch {
    return {
      phase: 'preview',
      preview: parsed.preview,
      message: '取り込みに失敗しました。時間をおいて、もう一度お試しください。',
    };
  }
  if (committed.status === 'duplicate') {
    return {
      phase: 'success',
      success: {
        transactionCount: parsed.rows.length,
        counts: parsed.preview.counts,
        period: parsed.preview.period,
        months: [...new Set(parsed.rows.map((row) => row.occurredOn.slice(0, 7)))].sort(),
        duplicateOperation: true,
      },
    };
  }

  revalidatePath('/');
  revalidatePath('/transactions');
  revalidatePath('/balances');
  return successState(parsed.rows, committed);
}
