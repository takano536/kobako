import { TextDecoder } from 'node:util';
import { SaxesParser, type SaxesTagPlain } from 'saxes';
import yauzl, { type Entry } from 'yauzl';

import {
  MONEY_MANAGER_COLUMN_COUNT,
  MONEY_MANAGER_MAX_ROWS,
  normalizeMoneyManagerCells,
  type MoneyManagerCell,
  type MoneyManagerCellGrid,
  type MoneyManagerGridRow,
  type MoneyManagerNormalizationResult,
} from './money-manager-format.js';

const MAX_XML_CHUNK = 64 * 1024;
const BUILTIN_DATE_FORMATS: Record<number, string> = {
  14: 'm/d/yy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'm/d/yy h:mm',
};

export const MONEY_MANAGER_XLSX_LIMITS = {
  maxFileBytes: 5 * 1024 * 1024,
  maxZipEntries: 128,
  maxEntryBytes: 8 * 1024 * 1024,
  maxTotalUncompressedBytes: 32 * 1024 * 1024,
  maxXmlDepth: 64,
  maxXmlTextBytes: 8 * 1024 * 1024,
  maxSharedStrings: 100_000,
  maxSharedStringBytes: 8 * 1024 * 1024,
  maxSharedStringBytesEach: 4 * 1024,
} as const;

type XmlTag = SaxesTagPlain;

interface XmlHandlers {
  open?: (tag: XmlTag) => void;
  close?: (tag: XmlTag) => void;
  text?: (text: string) => void;
  cdata?: (text: string) => void;
}

export class MoneyManagerXlsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyManagerXlsxError';
  }
}
class MoneyManagerXlsxRowLimitError extends MoneyManagerXlsxError {}

function localName(name: string): string {
  const separator = name.lastIndexOf(':');
  return separator >= 0 ? name.slice(separator + 1) : name;
}
function sharedStringValue(sharedStrings: readonly string[], rawValue: string): string {
  if (!/^\d+$/.test(rawValue)) {
    throw new MoneyManagerXlsxError('共有文字列の参照先が不正です。');
  }
  const index = Number(rawValue);
  const value = Number.isSafeInteger(index) ? sharedStrings[index] : undefined;
  if (value === undefined) {
    throw new MoneyManagerXlsxError('共有文字列の参照先が不正です。');
  }
  return value;
}

function attribute(tag: XmlTag, wanted: string): string | undefined {
  const exact = tag.attributes[wanted];
  if (exact !== undefined) {
    return exact;
  }
  for (const [name, value] of Object.entries(tag.attributes)) {
    if (localName(name) === wanted) {
      return value;
    }
  }
  return undefined;
}

function parseIntegerAttribute(tag: XmlTag, name: string): number | undefined {
  const value = attribute(tag, name);
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseXml(xmlBytes: Buffer, fileName: string, handlers: XmlHandlers): void {
  let depth = 0;
  let textBytes = 0;
  let parserError: Error | undefined;
  let parser: SaxesParser;
  try {
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(xmlBytes);
    parser = new SaxesParser({
      fileName,
      fragment: false,
      xmlns: false,
      position: true,
    });
    parser.on('error', (error) => {
      parserError ??= error;
    });
    parser.on('doctype', () => {
      throw new MoneyManagerXlsxError('DOCTYPE は対応していません。');
    });
    parser.on('processinginstruction', () => {
      throw new MoneyManagerXlsxError('XML の処理命令は対応していません。');
    });
    parser.on('opentag', (tag) => {
      depth += 1;
      if (depth > MONEY_MANAGER_XLSX_LIMITS.maxXmlDepth) {
        throw new MoneyManagerXlsxError('XML の入れ子が深すぎます。');
      }
      handlers.open?.(tag);
    });
    parser.on('closetag', (tag) => {
      handlers.close?.(tag);
      depth -= 1;
    });
    parser.on('text', (text) => {
      textBytes += Buffer.byteLength(text, 'utf8');
      if (textBytes > MONEY_MANAGER_XLSX_LIMITS.maxXmlTextBytes) {
        throw new MoneyManagerXlsxError('XML のテキスト量が上限を超えています。');
      }
      handlers.text?.(text);
    });
    parser.on('cdata', (text) => {
      textBytes += Buffer.byteLength(text, 'utf8');
      if (textBytes > MONEY_MANAGER_XLSX_LIMITS.maxXmlTextBytes) {
        throw new MoneyManagerXlsxError('XML のテキスト量が上限を超えています。');
      }
      handlers.cdata?.(text);
    });
    for (let offset = 0; offset < xml.length; offset += MAX_XML_CHUNK) {
      parser.write(xml.slice(offset, offset + MAX_XML_CHUNK));
    }
    parser.close();
  } catch (error) {
    if (error instanceof MoneyManagerXlsxError) {
      throw error;
    }
    throw new MoneyManagerXlsxError('XML を読み込めません。');
  }
  if (parserError) {
    throw new MoneyManagerXlsxError('XML を読み込めません。');
  }
}

function dateFormatLooksLikeDate(formatCode: string): boolean {
  const withoutQuotedText = formatCode.replace(/"[^"]*"/g, '').replace(/\\./g, '');
  return /[dy]/i.test(withoutQuotedText);
}

function parseStyles(xml: Buffer): Set<number> {
  const customFormats = new Map<number, string>();
  const cellXfFormatIds: number[] = [];
  const stack: string[] = [];
  let inCellXfs = false;
  parseXml(xml, 'xl/styles.xml', {
    open: (tag) => {
      const name = localName(tag.name);
      stack.push(name);
      if (name === 'cellXfs') {
        inCellXfs = true;
      } else if (name === 'numFmt') {
        const id = parseIntegerAttribute(tag, 'numFmtId');
        const code = attribute(tag, 'formatCode');
        if (id !== undefined && code !== undefined) {
          customFormats.set(id, code);
        }
      } else if (name === 'xf' && inCellXfs) {
        cellXfFormatIds.push(parseIntegerAttribute(tag, 'numFmtId') ?? 0);
      }
    },
    close: (tag) => {
      const name = localName(tag.name);
      if (name === 'cellXfs') {
        inCellXfs = false;
      }
      stack.pop();
    },
  });
  const dateStyles = new Set<number>();
  for (const [styleId, formatId] of cellXfFormatIds.entries()) {
    const format = customFormats.get(formatId) ?? BUILTIN_DATE_FORMATS[formatId];
    if (format && dateFormatLooksLikeDate(format)) {
      dateStyles.add(styleId);
    }
  }
  return dateStyles;
}

function parseSharedStrings(xml: Buffer): string[] {
  const strings: string[] = [];
  const stack: string[] = [];
  let current: string[] | undefined;
  let currentBytes = 0;
  let textDepth = 0;
  let totalBytes = 0;
  parseXml(xml, 'xl/sharedStrings.xml', {
    open: (tag) => {
      const name = localName(tag.name);
      stack.push(name);
      if (name === 'si') {
        if (current) {
          throw new MoneyManagerXlsxError('sharedStrings.xml の文字列構造が不正です。');
        }
        if (strings.length >= MONEY_MANAGER_XLSX_LIMITS.maxSharedStrings) {
          throw new MoneyManagerXlsxError('共有文字列の件数が上限を超えています。');
        }
        current = [];
        currentBytes = 0;
      } else if (name === 't' && current) {
        textDepth += 1;
      }
    },
    text: (text) => {
      if (!current || textDepth === 0) {
        return;
      }
      const nextBytes = Buffer.byteLength(text, 'utf8');
      if (currentBytes + nextBytes > MONEY_MANAGER_XLSX_LIMITS.maxSharedStringBytesEach) {
        throw new MoneyManagerXlsxError('共有文字列が長すぎます。');
      }
      totalBytes += nextBytes;
      if (totalBytes > MONEY_MANAGER_XLSX_LIMITS.maxSharedStringBytes) {
        throw new MoneyManagerXlsxError('共有文字列の総量が上限を超えています。');
      }
      currentBytes += nextBytes;
      current.push(text);
    },
    cdata: (text) => {
      if (!current || textDepth === 0) {
        return;
      }
      const nextBytes = Buffer.byteLength(text, 'utf8');
      if (currentBytes + nextBytes > MONEY_MANAGER_XLSX_LIMITS.maxSharedStringBytesEach) {
        throw new MoneyManagerXlsxError('共有文字列が長すぎます。');
      }
      totalBytes += nextBytes;
      if (totalBytes > MONEY_MANAGER_XLSX_LIMITS.maxSharedStringBytes) {
        throw new MoneyManagerXlsxError('共有文字列の総量が上限を超えています。');
      }
      currentBytes += nextBytes;
      current.push(text);
    },
    close: (tag) => {
      const name = localName(tag.name);
      if (name === 't' && textDepth > 0) {
        textDepth -= 1;
      } else if (name === 'si') {
        if (!current) {
          throw new MoneyManagerXlsxError('sharedStrings.xml の文字列構造が不正です。');
        }
        strings.push(current.join(''));
        current = undefined;
      }
      stack.pop();
    },
  });
  if (current || stack.length !== 0) {
    throw new MoneyManagerXlsxError('sharedStrings.xml の文字列構造が不正です。');
  }
  return strings;
}

interface ParsedSheet {
  rows: MoneyManagerGridRow[];
}

function columnIndexFromAddress(address: string): number | undefined {
  const match = /^([A-Z]+)\d+$/.exec(address);
  if (!match) {
    return undefined;
  }
  const letters = match[1];
  if (!letters) {
    return undefined;
  }
  let value = 0;
  for (const letter of letters) {
    value = value * 26 + letter.charCodeAt(0) - 64;
  }
  return value - 1;
}

function parseWorksheet(
  xml: Buffer,
  sharedStrings: readonly string[],
  dateStyles: ReadonlySet<number>,
  maxRows: number,
): ParsedSheet {
  const rows: MoneyManagerGridRow[] = [];
  let headerSeen = false;
  let dataRowPosition = 0;
  let pendingBlankRows: MoneyManagerGridRow[] = [];
  let pendingBlankOverflow = false;
  const stack: string[] = [];
  let currentRow: { rowNumber: number; cells: Map<number, MoneyManagerCell> } | undefined;
  let currentCell:
    | {
        column: number;
        type: string;
        styleId?: number;
        value: string[];
        inlineText: string[];
        formula: boolean;
        valueDepth: number;
        textDepth: number;
      }
    | undefined;

  parseXml(xml, 'xl/worksheets/sheet.xml', {
    open: (tag) => {
      const name = localName(tag.name);
      stack.push(name);
      if (name === 'row') {
        if (currentRow) {
          throw new MoneyManagerXlsxError('ワークシートの行構造が不正です。');
        }
        currentRow = {
          rowNumber: parseIntegerAttribute(tag, 'r') ?? 0,
          cells: new Map(),
        };
      } else if (name === 'c') {
        if (!currentRow || currentCell) {
          throw new MoneyManagerXlsxError('ワークシートのセル構造が不正です。');
        }
        const address = attribute(tag, 'r');
        const column = address ? columnIndexFromAddress(address) : undefined;
        if (column === undefined || column < 0 || column >= MONEY_MANAGER_COLUMN_COUNT) {
          throw new MoneyManagerXlsxError('ワークシートのセル位置が不正です。');
        }
        if (currentRow.cells.has(column)) {
          throw new MoneyManagerXlsxError('ワークシートに重複セルがあります。');
        }
        currentCell = {
          column,
          type: attribute(tag, 't') ?? 'n',
          styleId: parseIntegerAttribute(tag, 's'),
          value: [],
          inlineText: [],
          formula: false,
          valueDepth: 0,
          textDepth: 0,
        };
      } else if (name === 'f' && currentCell) {
        currentCell.formula = true;
      } else if (name === 'v' && currentCell) {
        currentCell.valueDepth += 1;
      } else if (name === 't' && currentCell) {
        currentCell.textDepth += 1;
      }
    },
    text: (text) => {
      if (!currentCell) {
        return;
      }
      if (currentCell.valueDepth > 0) {
        currentCell.value.push(text);
      }
      if (currentCell.textDepth > 0) {
        currentCell.inlineText.push(text);
      }
    },
    cdata: (text) => {
      if (currentCell && currentCell.textDepth > 0) {
        currentCell.inlineText.push(text);
      }
    },
    close: (tag) => {
      const name = localName(tag.name);
      if (name === 'v' && currentCell && currentCell.valueDepth > 0) {
        currentCell.valueDepth -= 1;
      } else if (name === 't' && currentCell && currentCell.textDepth > 0) {
        currentCell.textDepth -= 1;
      } else if (name === 'c') {
        if (!currentRow || !currentCell) {
          throw new MoneyManagerXlsxError('ワークシートのセル構造が不正です。');
        }
        const rawValue = currentCell.value.join('');
        const inlineValue = currentCell.inlineText.join('');
        let cell: MoneyManagerCell;
        if (currentCell.formula) {
          const formulaValue =
            currentCell.type === 's' ? sharedStringValue(sharedStrings, rawValue) : rawValue;
          cell = {
            kind: currentCell.type === 's' || currentCell.type === 'str' ? 'string' : 'number',
            value: formulaValue,
            formula: true,
            isDate: currentCell.styleId !== undefined && dateStyles.has(currentCell.styleId),
          };
        } else if (currentCell.type === 's') {
          cell = { kind: 'string', value: sharedStringValue(sharedStrings, rawValue) };
        } else if (currentCell.type === 'inlineStr') {
          cell = { kind: 'string', value: inlineValue };
        } else if (currentCell.type === 'str') {
          cell = { kind: 'string', value: rawValue };
        } else if (rawValue === '') {
          cell = { kind: 'blank' };
        } else {
          cell = {
            kind: 'number',
            value: rawValue,
            isDate: currentCell.styleId !== undefined && dateStyles.has(currentCell.styleId),
          };
        }
        currentRow.cells.set(currentCell.column, cell);
        currentCell = undefined;
      } else if (name === 'row') {
        if (!currentRow) {
          throw new MoneyManagerXlsxError('ワークシートの行構造が不正です。');
        }
        const maxColumn = Math.max(-1, ...currentRow.cells.keys());
        const cells: MoneyManagerCell[] = [];
        for (let column = 0; column <= maxColumn; column += 1) {
          cells.push(currentRow.cells.get(column) ?? { kind: 'blank' });
        }
        const parsedRow = { rowNumber: currentRow.rowNumber, cells };
        if (!headerSeen) {
          rows.push(parsedRow);
          headerSeen = true;
        } else {
          dataRowPosition += 1;
          const isBlank = cells.every((cell) => cell.kind === 'blank' || (cell.value ?? '') === '');
          if (isBlank) {
            if (pendingBlankRows.length < maxRows + 1) {
              pendingBlankRows.push(parsedRow);
            } else {
              pendingBlankOverflow = true;
            }
          } else {
            if (pendingBlankOverflow || dataRowPosition > maxRows) {
              throw new MoneyManagerXlsxRowLimitError(
                `取引行が上限（${maxRows.toLocaleString('ja-JP')}行）を超えています。`,
              );
            }
            rows.push(...pendingBlankRows, parsedRow);
            pendingBlankRows = [];
          }
        }
        currentRow = undefined;
      }
      stack.pop();
    },
  });
  if (currentRow || currentCell) {
    throw new MoneyManagerXlsxError('ワークシートの構造が不正です。');
  }
  return { rows };
}

function resolveWorksheetTarget(target: string): string {
  const normalized = target.replaceAll('\\', '/').replace(/^\/+/, '');
  if (normalized.startsWith('xl/')) {
    return normalized;
  }
  return `xl/${normalized.replace(/^\.\//, '')}`;
}

function parseWorkbook(xml: Buffer): { date1904: boolean; relationshipId: string; name: string } {
  let date1904 = false;
  let inSheets = false;
  const sheets: Array<{ name: string; relationshipId: string }> = [];
  const stack: string[] = [];
  parseXml(xml, 'xl/workbook.xml', {
    open: (tag) => {
      const name = localName(tag.name);
      stack.push(name);
      if (name === 'workbookPr') {
        date1904 = attribute(tag, 'date1904') === '1' || attribute(tag, 'date1904') === 'true';
      } else if (name === 'sheets') {
        inSheets = true;
      } else if (name === 'sheet' && inSheets) {
        const sheetName = attribute(tag, 'name');
        const relationshipId = attribute(tag, 'id');
        if (!sheetName || !relationshipId) {
          throw new MoneyManagerXlsxError('ワークブックのシート情報が不正です。');
        }
        sheets.push({ name: sheetName, relationshipId });
      }
    },
    close: (tag) => {
      const name = localName(tag.name);
      if (name === 'sheets') {
        inSheets = false;
      }
      stack.pop();
    },
  });
  if (sheets.length !== 1) {
    throw new MoneyManagerXlsxError('ワークブックは一つのシートだけ対応しています。');
  }
  const sheet = sheets[0];
  if (!sheet) {
    throw new MoneyManagerXlsxError('ワークブックのシートがありません。');
  }
  return { date1904, relationshipId: sheet.relationshipId, name: sheet.name };
}

function parseWorkbookRelationships(xml: Buffer, relationshipId: string): string {
  let target: string | undefined;
  let matchingRelationships = 0;
  parseXml(xml, 'xl/_rels/workbook.xml.rels', {
    open: (tag) => {
      if (localName(tag.name) !== 'Relationship') {
        return;
      }
      const id = attribute(tag, 'Id');
      if (id !== relationshipId) {
        return;
      }
      matchingRelationships += 1;
      if (matchingRelationships > 1) {
        throw new MoneyManagerXlsxError('ワークブックのシート参照が重複しています。');
      }
      const relationshipType = attribute(tag, 'Type');
      if (
        relationshipType !==
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet' ||
        attribute(tag, 'TargetMode')
      ) {
        throw new MoneyManagerXlsxError('ワークブックのシート参照種別が不正です。');
      }
      target = attribute(tag, 'Target');
    },
  });
  if (matchingRelationships !== 1 || !target) {
    throw new MoneyManagerXlsxError('ワークブックのシート参照が見つかりません。');
  }
  return resolveWorksheetTarget(target);
}

async function readEntryBytes(zipFile: yauzl.ZipFile, entry: Entry): Promise<Buffer> {
  if (
    !Number.isSafeInteger(entry.uncompressedSize) ||
    entry.uncompressedSize > MONEY_MANAGER_XLSX_LIMITS.maxEntryBytes
  ) {
    throw new MoneyManagerXlsxError('ZIP エントリの展開サイズが上限を超えています。');
  }
  const stream = await zipFile.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MONEY_MANAGER_XLSX_LIMITS.maxEntryBytes) {
      throw new MoneyManagerXlsxError('ZIP エントリの実サイズが上限を超えています。');
    }
    chunks.push(buffer);
  }
  if (size !== entry.uncompressedSize) {
    throw new MoneyManagerXlsxError('ZIP エントリの展開サイズが一致しません。');
  }
  return Buffer.concat(chunks, size);
}

async function readRequiredZipEntries(bytes: Uint8Array): Promise<Map<string, Buffer>> {
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new MoneyManagerXlsxError('OOXML ZIP ファイルではありません。');
  }
  if (bytes.byteLength > MONEY_MANAGER_XLSX_LIMITS.maxFileBytes) {
    throw new MoneyManagerXlsxError('ファイルサイズが上限を超えています。');
  }
  let zipFile: yauzl.ZipFile | undefined;
  try {
    zipFile = await yauzl.fromBufferPromise(Buffer.from(bytes), {
      lazyEntries: true,
      validateEntrySizes: true,
      strictFileNames: true,
    });
    if (zipFile.entryCount > MONEY_MANAGER_XLSX_LIMITS.maxZipEntries) {
      throw new MoneyManagerXlsxError('ZIP エントリ数が上限を超えています。');
    }
    const required = new Set([
      '[Content_Types].xml',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/sharedStrings.xml',
      'xl/styles.xml',
    ]);
    const entries = new Map<string, Buffer>();
    const seenEntries = new Set<string>();
    let totalUncompressed = 0;
    for await (const entry of zipFile.eachEntry()) {
      if (entry.fileName.endsWith('/')) {
        continue;
      }
      if (seenEntries.has(entry.fileName)) {
        throw new MoneyManagerXlsxError('ZIP に重複エントリがあります。');
      }
      seenEntries.add(entry.fileName);
      if (entries.has(entry.fileName)) {
        throw new MoneyManagerXlsxError('ZIP に重複エントリがあります。');
      }
      if (!Number.isSafeInteger(entry.uncompressedSize)) {
        throw new MoneyManagerXlsxError('ZIP エントリのサイズが不正です。');
      }
      totalUncompressed += entry.uncompressedSize;
      if (
        entry.uncompressedSize > MONEY_MANAGER_XLSX_LIMITS.maxEntryBytes ||
        totalUncompressed > MONEY_MANAGER_XLSX_LIMITS.maxTotalUncompressedBytes
      ) {
        throw new MoneyManagerXlsxError('ZIP の総展開サイズが上限を超えています。');
      }
      if (required.has(entry.fileName)) {
        entries.set(entry.fileName, await readEntryBytes(zipFile, entry));
      } else {
        const stream = await zipFile.openReadStreamPromise(entry);
        let streamedBytes = 0;
        for await (const chunk of stream) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          streamedBytes += buffer.length;
          if (streamedBytes > MONEY_MANAGER_XLSX_LIMITS.maxEntryBytes) {
            throw new MoneyManagerXlsxError('ZIP エントリの実サイズが上限を超えています。');
          }
        }
        if (streamedBytes !== entry.uncompressedSize) {
          throw new MoneyManagerXlsxError('ZIP エントリの展開サイズが一致しません。');
        }
      }
    }
    const requiredNames = [...required];
    for (const name of requiredNames) {
      if (!entries.has(name)) {
        throw new MoneyManagerXlsxError('必要な OOXML パーツがありません。');
      }
    }
    return entries;
  } catch (error) {
    if (error instanceof MoneyManagerXlsxError) {
      throw error;
    }
    throw new MoneyManagerXlsxError('ZIP を読み込めません。');
  } finally {
    if (zipFile?.isOpen) {
      zipFile.close();
    }
  }
}

export async function parseMoneyManagerXlsx(
  bytes: Uint8Array,
  options: { maxRows?: number } = {},
): Promise<MoneyManagerNormalizationResult> {
  const maxRows = options.maxRows ?? MONEY_MANAGER_MAX_ROWS;
  const entries = await readRequiredZipEntries(bytes);
  parseXml(entries.get('[Content_Types].xml') as Buffer, '[Content_Types].xml', {});
  const workbook = parseWorkbook(entries.get('xl/workbook.xml') as Buffer);
  if (workbook.name !== 'らくな家計簿') {
    throw new MoneyManagerXlsxError('シート名が対応していません。');
  }
  const worksheetPath = parseWorkbookRelationships(
    entries.get('xl/_rels/workbook.xml.rels') as Buffer,
    workbook.relationshipId,
  );
  const worksheet = await readWorksheetEntry(bytes, worksheetPath);
  const dateStyles = parseStyles(entries.get('xl/styles.xml') as Buffer);
  const sharedStrings = parseSharedStrings(entries.get('xl/sharedStrings.xml') as Buffer);
  let parsedSheet: ParsedSheet;
  try {
    parsedSheet = parseWorksheet(worksheet, sharedStrings, dateStyles, maxRows);
  } catch (error) {
    if (error instanceof MoneyManagerXlsxRowLimitError) {
      return {
        rows: [],
        errors: [
          {
            scope: 'file',
            code: 'max-rows',
            message: error.message,
            reason: error.message,
          },
        ],
      };
    }
    throw error;
  }
  const grid: MoneyManagerCellGrid = {
    rows: parsedSheet.rows,
    date1904: workbook.date1904,
  };
  return normalizeMoneyManagerCells(grid, options);
}

async function readWorksheetEntry(bytes: Uint8Array, path: string): Promise<Buffer> {
  if (path === 'xl/workbook.xml' || path.includes('..')) {
    throw new MoneyManagerXlsxError('シートの参照先が不正です。');
  }
  let zipFile: yauzl.ZipFile | undefined;
  try {
    zipFile = await yauzl.fromBufferPromise(Buffer.from(bytes), {
      lazyEntries: true,
      validateEntrySizes: true,
      strictFileNames: true,
    });
    for await (const entry of zipFile.eachEntry()) {
      if (entry.fileName === path) {
        return await readEntryBytes(zipFile, entry);
      }
    }
  } catch (error) {
    if (error instanceof MoneyManagerXlsxError) {
      throw error;
    }
    throw new MoneyManagerXlsxError('ワークシートを読み込めません。');
  } finally {
    if (zipFile?.isOpen) {
      zipFile.close();
    }
  }
  throw new MoneyManagerXlsxError('ワークシートが見つかりません。');
}
