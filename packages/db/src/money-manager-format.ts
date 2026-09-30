import { AMOUNT_LIMIT } from './amount.js';
import { MAX_SUPPORTED_YEAR, MIN_SUPPORTED_YEAR } from './month.js';
import type { TransactionType } from './schema.js';

export const MONEY_MANAGER_HEADERS = [
  '日付',
  '資産',
  '分類',
  '小分類',
  '内容',
  'JPY',
  '収入/支出',
  'メモ',
  '金額',
  '通貨',
  '資産',
] as const;

export const MONEY_MANAGER_SOURCE = 'realbyte-money-manager';
export const MONEY_MANAGER_COLUMN_COUNT = MONEY_MANAGER_HEADERS.length;
export const MONEY_MANAGER_MEMO_LIMIT = 200;
export const MONEY_MANAGER_CATEGORY_LIMIT = 80;
export const MONEY_MANAGER_ACCOUNT_LIMIT = 120;
export const MONEY_MANAGER_MAX_ROWS = 10_000;
const MAX_NUMERIC_LEXEME_LENGTH = 64;

const AMOUNT_PATTERN = /^-?\d+(?:\.0+)?$/;
const DATE_SERIAL_PATTERN = /^(\d+)(?:\.\d+)?$/;
const EXCEL_UNIX_EPOCH_SERIAL = 25_568n;
const EXCEL_FAKE_LEAP_DAY = 60n;
const EXCEL_MAX_SAFE_SERIAL = 3_000_000n;
const MIN_CONTROL_CHARACTER = 0;
const MAX_CONTROL_CHARACTER = 31;

type CellKind = 'blank' | 'string' | 'number';

/** A decoded cell representation shared by the XLSX reader and pure tests. */
export interface MoneyManagerCell {
  kind: CellKind;
  /** Text for strings, or the raw XML lexical value for numbers. */
  value?: string;
  /** True when the source cell contains an <f> element. */
  formula?: boolean;
  /** True when the cell style is a supported Excel calendar-date style. */
  isDate?: boolean;
}

export interface MoneyManagerGridRow {
  rowNumber: number;
  cells: readonly MoneyManagerCell[];
}

export interface MoneyManagerCellGrid {
  rows: readonly MoneyManagerGridRow[];
  /** The sample uses the 1900 date system. The 1904 system is unsupported. */
  date1904: boolean;
}

export interface MoneyManagerLedgerRow {
  sourceRow: number;
  type: TransactionType;
  amount: number;
  occurredOn: string;
  accountName: string;
  categoryName: string;
  memo: string;
}

export interface MoneyManagerTransferRow {
  sourceRow: number;
  type: 'transfer';
  amount: number;
  occurredOn: string;
  fromAccountName: string;
  toAccountName: string;
  memo: string;
}

export type MoneyManagerNormalizedRow = MoneyManagerLedgerRow | MoneyManagerTransferRow;

export type MoneyManagerErrorScope = 'file' | 'row';
export interface MoneyManagerNormalizationError {
  scope: MoneyManagerErrorScope;
  row?: number;
  code: string;
  message: string;
  /** A short cell-value excerpt suitable for showing in a preview. */
  excerpt?: string;
  /** A plain-language explanation and fix for a person editing the spreadsheet. */
  reason?: string;
  suggestedFix?: string;
}

export interface MoneyManagerNormalizationResult {
  rows: MoneyManagerNormalizedRow[];
  errors: MoneyManagerNormalizationError[];
}

export interface ExistingMoneyManagerCategory {
  type: TransactionType;
  name: string;
}

export interface MoneyManagerCategoryPlan {
  type: TransactionType;
  name: string;
  action: 'reuse' | 'create';
}

export interface ExistingMoneyManagerAccount {
  name: string;
}

export interface MoneyManagerAccountPlan {
  name: string;
  action: 'reuse' | 'create';
}

function fileError(errors: MoneyManagerNormalizationError[], code: string, message: string): void {
  errors.push({ scope: 'file', code, message, reason: message });
}

function rowError(
  errors: MoneyManagerNormalizationError[],
  row: number,
  code: string,
  message: string,
  details: Pick<MoneyManagerNormalizationError, 'excerpt' | 'reason' | 'suggestedFix'> = {},
): void {
  errors.push({
    scope: 'row',
    row,
    code,
    message,
    reason: details.reason ?? message,
    suggestedFix:
      details.suggestedFix ?? '該当するセルの値を確認して、ファイルを修正してください。',
    ...(details.excerpt === undefined ? {} : { excerpt: details.excerpt }),
  });
}

function cellText(cell: MoneyManagerCell | undefined): string | undefined {
  if (!cell || cell.kind === 'blank') {
    return undefined;
  }
  return cell.value ?? '';
}

function trimmedCellText(cell: MoneyManagerCell | undefined): string {
  return cellText(cell)?.trim() ?? '';
}

function previewCell(value: string | undefined): string {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  if (!normalized) {
    return '（空欄）';
  }
  return normalized.length > 80 ? `${normalized.slice(0, 77)}…` : normalized;
}

function rowExcerpt(row: MoneyManagerGridRow, date1904: boolean): string {
  const cells = row.cells;
  const date = parseExcelDate(cells[0], date1904) ?? previewCell(cellText(cells[0]));
  return [
    `日付=${date}`,
    `資産=${previewCell(cellText(cells[1]))}`,
    `分類=${previewCell(cellText(cells[2]))}`,
    `内容=${previewCell(cellText(cells[4]))}`,
    `金額=${previewCell(cellText(cells[5]))}`,
    `種別=${previewCell(cellText(cells[6]))}`,
  ].join('・');
}

function addRowExcerpts(
  rows: readonly MoneyManagerGridRow[],
  errors: readonly MoneyManagerNormalizationError[],
  date1904: boolean,
): MoneyManagerNormalizationError[] {
  return errors.map((error) => {
    if (error.scope !== 'row' || error.row === undefined || error.excerpt) {
      return error;
    }
    const source = rows.find((row) => row.rowNumber === error.row);
    return source ? { ...error, excerpt: rowExcerpt(source, date1904) } : error;
  });
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code !== undefined && code >= MIN_CONTROL_CHARACTER && code <= MAX_CONTROL_CHARACTER) {
      return true;
    }
    if (code === 127) {
      return true;
    }
  }
  return false;
}

function isTextCell(cell: MoneyManagerCell | undefined): boolean {
  return cell === undefined || cell.kind === 'blank' || cell.kind === 'string';
}

function isBlankRow(row: MoneyManagerGridRow): boolean {
  return row.cells.every((cell) => cell.kind === 'blank' || (cell.value ?? '') === '');
}

function isFormulaRow(row: MoneyManagerGridRow): boolean {
  return row.cells.some((cell) => cell.formula === true);
}

function parseAmount(cell: MoneyManagerCell | undefined): number | undefined {
  if (!cell || cell.kind !== 'number' || cell.value === undefined) {
    return undefined;
  }
  if (cell.value.length > MAX_NUMERIC_LEXEME_LENGTH || !AMOUNT_PATTERN.test(cell.value)) {
    return undefined;
  }
  const digits = cell.value.startsWith('-')
    ? cell.value.slice(1).split('.')[0]
    : cell.value.split('.')[0];
  if (!digits) {
    return undefined;
  }
  const unsigned = BigInt(digits);
  const amount = cell.value.startsWith('-') ? -unsigned : unsigned;
  if (amount < BigInt(-AMOUNT_LIMIT) || amount > BigInt(AMOUNT_LIMIT)) {
    return undefined;
  }
  return Number(amount);
}

function isAmountLexeme(cell: MoneyManagerCell | undefined): boolean {
  return Boolean(
    cell && cell.kind === 'number' && cell.value !== undefined && AMOUNT_PATTERN.test(cell.value),
  );
}

function daysToCivilDate(unixDays: number): string {
  const z = unixDays + 719_468;
  const era = z >= 0 ? Math.floor(z / 146_097) : Math.floor((z - 146_096) / 146_097);
  const dayOfEra = z - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1_460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  let year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPart = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPart + 2) / 5) + 1;
  const month = monthPart + (monthPart < 10 ? 3 : -9);
  year += month <= 2 ? 1 : 0;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseExcelDate(cell: MoneyManagerCell | undefined, date1904: boolean): string | undefined {
  if (!cell || cell.kind !== 'number' || cell.value === undefined || cell.isDate !== true) {
    return undefined;
  }
  if (date1904 || cell.value.length > MAX_NUMERIC_LEXEME_LENGTH) {
    return undefined;
  }
  const match = DATE_SERIAL_PATTERN.exec(cell.value);
  if (!match) {
    return undefined;
  }
  const serialText = match[1];
  if (serialText === undefined) {
    return undefined;
  }
  const serial = BigInt(serialText);
  if (serial === EXCEL_FAKE_LEAP_DAY || serial > EXCEL_MAX_SAFE_SERIAL) {
    return undefined;
  }
  const daysSinceBase = serial > EXCEL_FAKE_LEAP_DAY ? serial - 1n : serial;
  const unixDays = daysSinceBase - EXCEL_UNIX_EPOCH_SERIAL;
  if (unixDays < -40_000n || unixDays > 3_000_000n) {
    return undefined;
  }
  const date = daysToCivilDate(Number(unixDays));
  const [yearText, monthText, dayText] = date.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (
    year < MIN_SUPPORTED_YEAR ||
    year > MAX_SUPPORTED_YEAR ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return undefined;
  }
  return date;
}

function categoryName(main: string, subcategory: string): string {
  return subcategory ? `${main} / ${subcategory}` : main;
}

function memoText(content: string, memo: string): string {
  const parts: string[] = [];
  for (const part of [content, memo]) {
    const trimmed = part.trim();
    if (trimmed && !parts.includes(trimmed)) {
      parts.push(trimmed);
    }
  }
  return parts.join(' / ');
}

function validateHeader(
  row: MoneyManagerGridRow,
  errors: MoneyManagerNormalizationError[],
): boolean {
  const actual = row.cells.slice(0, MONEY_MANAGER_COLUMN_COUNT).map((cell) => cellText(cell) ?? '');
  const matches =
    row.cells.length === MONEY_MANAGER_COLUMN_COUNT &&
    MONEY_MANAGER_HEADERS.every(
      (header, index) => row.cells[index]?.kind === 'string' && actual[index] === header,
    );
  if (!matches) {
    rowError(errors, row.rowNumber, 'unsupported-header', 'Excel の見出しが対応していません。');
  }
  return matches;
}

export function normalizeMoneyManagerCells(
  grid: MoneyManagerCellGrid,
  options: { maxRows?: number } = {},
): MoneyManagerNormalizationResult {
  const rows: MoneyManagerNormalizedRow[] = [];
  const errors: MoneyManagerNormalizationError[] = [];
  const maxRows = options.maxRows ?? MONEY_MANAGER_MAX_ROWS;

  if (grid.date1904) {
    fileError(errors, 'unsupported-date-system', '1904 日付システムの Excel は対応していません。');
  }
  const [header, ...dataRows] = grid.rows;
  if (!header) {
    fileError(errors, 'missing-header', 'Excel の見出し行がありません。');
    return { rows, errors };
  }
  if (header.rowNumber !== 1) {
    fileError(errors, 'invalid-row-number', '見出し行の行番号が不正です。');
  }
  if (!validateHeader(header, errors)) {
    return { rows, errors: addRowExcerpts(grid.rows, errors, grid.date1904) };
  }
  if (isFormulaRow(header)) {
    rowError(errors, header.rowNumber, 'formula', '数式セルは取り込めません。');
  }

  let lastDataIndex = -1;
  for (let index = dataRows.length - 1; index >= 0; index -= 1) {
    const row = dataRows[index];
    if (row && !isBlankRow(row)) {
      lastDataIndex = index;
      break;
    }
  }
  if (lastDataIndex < 0) {
    fileError(errors, 'no-data', '取り込む取引がありません。');
    return { rows, errors };
  }
  if (lastDataIndex + 1 > maxRows) {
    fileError(
      errors,
      'max-rows',
      `取引行が上限（${maxRows.toLocaleString('ja-JP')}行）を超えています。`,
    );
    return { rows, errors };
  }

  for (let index = 0; index <= lastDataIndex; index += 1) {
    const source = dataRows[index];
    if (!source) {
      fileError(errors, 'missing-row', 'Excel の行が欠落しています。');
      continue;
    }
    const expectedRowNumber = index + 2;
    if (source.rowNumber !== expectedRowNumber) {
      rowError(
        errors,
        source.rowNumber,
        'invalid-row-number',
        'Excel の行番号が連続していません。',
      );
      continue;
    }
    if (source.cells.length !== MONEY_MANAGER_COLUMN_COUNT) {
      rowError(
        errors,
        source.rowNumber,
        'invalid-column-count',
        '取引行の列数が対応していません。',
      );
      continue;
    }
    if (isBlankRow(source)) {
      rowError(errors, source.rowNumber, 'blank-row', '取引の途中に空行があります。');
      continue;
    }
    if (isFormulaRow(source)) {
      rowError(errors, source.rowNumber, 'formula', '数式セルは取り込めません。');
      continue;
    }

    const dateCell = source.cells[0];
    const accountCell = source.cells[1];
    const categoryCell = source.cells[2];
    const subcategoryCell = source.cells[3];
    const contentCell = source.cells[4];
    const amountCell = source.cells[5];
    const typeCell = source.cells[6];
    const memoCell = source.cells[7];
    const currencyCell = source.cells[9];

    if (!isTextCell(accountCell)) {
      rowError(errors, source.rowNumber, 'invalid-asset', '資産名セルが文字列ではありません。');
      continue;
    }
    if (!isTextCell(categoryCell)) {
      rowError(
        errors,
        source.rowNumber,
        'invalid-asset',
        '資産名または分類セルが文字列ではありません。',
      );
      continue;
    }
    if (!isTextCell(typeCell)) {
      rowError(errors, source.rowNumber, 'unknown-type', '収入/支出の値が対応していません。');
      continue;
    }
    if (!isTextCell(contentCell) || !isTextCell(memoCell)) {
      rowError(errors, source.rowNumber, 'invalid-memo', '内容・メモセルが文字列ではありません。');
      continue;
    }
    if (!isTextCell(currencyCell)) {
      rowError(
        errors,
        source.rowNumber,
        'unsupported-currency',
        '通貨セルが文字列ではありません。',
      );
      continue;
    }

    const occurredOn = parseExcelDate(dateCell, grid.date1904);
    if (!occurredOn) {
      rowError(
        errors,
        source.rowNumber,
        'invalid-date',
        '日付を読み取れません。正しい日付に直してください。',
      );
      continue;
    }
    if (!amountCell || amountCell.kind !== 'number' || amountCell.value === undefined) {
      rowError(errors, source.rowNumber, 'invalid-amount', '金額セルが数値ではありません。');
      continue;
    }
    if (!isAmountLexeme(amountCell)) {
      rowError(
        errors,
        source.rowNumber,
        'invalid-amount',
        '金額は整数の .0 形式で入力してください。',
      );
      continue;
    }
    const amount = parseAmount(amountCell);
    if (amount === undefined) {
      rowError(errors, source.rowNumber, 'invalid-amount', '金額が対応範囲を超えています。');
      continue;
    }
    const sourceType = trimmedCellText(typeCell);
    if (trimmedCellText(currencyCell) !== 'JPY') {
      rowError(errors, source.rowNumber, 'unsupported-currency', '通貨は JPY のみ対応しています。');
      continue;
    }
    const memo = memoText(trimmedCellText(contentCell), trimmedCellText(memoCell));
    if (memo.length > MONEY_MANAGER_MEMO_LIMIT) {
      rowError(
        errors,
        source.rowNumber,
        'memo-too-long',
        `メモは${MONEY_MANAGER_MEMO_LIMIT}文字以内にしてください。`,
      );
      continue;
    }

    const fromAccountName = trimmedCellText(accountCell);
    const toAccountName = trimmedCellText(categoryCell);
    if (sourceType === '引き出し') {
      if (
        !fromAccountName ||
        !toAccountName ||
        containsControlCharacter(fromAccountName) ||
        containsControlCharacter(toAccountName)
      ) {
        rowError(
          errors,
          source.rowNumber,
          'invalid-asset',
          '振替元と振替先の資産名を入力してください。',
        );
        continue;
      }
      if (
        fromAccountName.length > MONEY_MANAGER_ACCOUNT_LIMIT ||
        toAccountName.length > MONEY_MANAGER_ACCOUNT_LIMIT
      ) {
        rowError(
          errors,
          source.rowNumber,
          'asset-too-long',
          `資産名は${MONEY_MANAGER_ACCOUNT_LIMIT}文字以内にしてください。`,
        );
        continue;
      }
      if (fromAccountName === toAccountName) {
        rowError(
          errors,
          source.rowNumber,
          'same-asset',
          '振替元と振替先には別の資産を指定してください。',
        );
        continue;
      }
      if (amount <= 0) {
        rowError(
          errors,
          source.rowNumber,
          'invalid-amount',
          '振替金額は1円以上の整数にしてください。',
        );
        continue;
      }
      rows.push({
        sourceRow: source.rowNumber,
        type: 'transfer',
        amount,
        occurredOn,
        fromAccountName,
        toAccountName,
        memo,
      });
      continue;
    }

    let type: TransactionType;
    if (sourceType === '支出') {
      type = 'expense';
    } else if (sourceType === '収入') {
      type = 'income';
    } else {
      rowError(errors, source.rowNumber, 'unknown-type', '収入/支出の値が対応していません。');
      continue;
    }
    if (!fromAccountName || containsControlCharacter(fromAccountName)) {
      rowError(errors, source.rowNumber, 'invalid-asset', '資産名を入力してください。');
      continue;
    }
    if (fromAccountName.length > MONEY_MANAGER_ACCOUNT_LIMIT) {
      rowError(
        errors,
        source.rowNumber,
        'asset-too-long',
        `資産名は${MONEY_MANAGER_ACCOUNT_LIMIT}文字以内にしてください。`,
      );
      continue;
    }
    if (!isTextCell(subcategoryCell)) {
      rowError(errors, source.rowNumber, 'invalid-category', '小分類セルが文字列ではありません。');
      continue;
    }
    const mainCategory = toAccountName;
    const subcategory = trimmedCellText(subcategoryCell);
    if (!mainCategory || containsControlCharacter(mainCategory)) {
      rowError(errors, source.rowNumber, 'invalid-category', '分類を入力してください。');
      continue;
    }
    const combinedCategory = categoryName(mainCategory, subcategory);
    if (combinedCategory.length > MONEY_MANAGER_CATEGORY_LIMIT) {
      rowError(
        errors,
        source.rowNumber,
        'category-too-long',
        `カテゴリは${MONEY_MANAGER_CATEGORY_LIMIT}文字以内にしてください。`,
      );
      continue;
    }

    rows.push({
      sourceRow: source.rowNumber,
      type,
      amount,
      occurredOn,
      accountName: fromAccountName,
      categoryName: combinedCategory,
      memo,
    });
  }

  return { rows, errors: addRowExcerpts(grid.rows, errors, grid.date1904) };
}

export function planMoneyManagerCategories(
  rows: readonly MoneyManagerNormalizedRow[],
  existingCategories: readonly ExistingMoneyManagerCategory[],
): MoneyManagerCategoryPlan[] {
  const existing = new Set(
    existingCategories.map((category) => `${category.type}\u0000${category.name}`),
  );
  const seen = new Set<string>();
  const plan: MoneyManagerCategoryPlan[] = [];
  for (const row of rows) {
    if (row.type === 'transfer') {
      continue;
    }
    const key = `${row.type}\u0000${row.categoryName}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    plan.push({
      type: row.type,
      name: row.categoryName,
      action: existing.has(key) ? 'reuse' : 'create',
    });
  }
  return plan;
}

export function planMoneyManagerAccounts(
  rows: readonly MoneyManagerNormalizedRow[],
  existingAccounts: readonly ExistingMoneyManagerAccount[],
): MoneyManagerAccountPlan[] {
  const existing = new Set(existingAccounts.map((account) => account.name));
  const seen = new Set<string>();
  const plan: MoneyManagerAccountPlan[] = [];
  for (const row of rows) {
    const names =
      row.type === 'transfer' ? [row.fromAccountName, row.toAccountName] : [row.accountName];
    for (const name of names) {
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      plan.push({ name, action: existing.has(name) ? 'reuse' : 'create' });
    }
  }
  return plan;
}
