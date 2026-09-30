/**
 * All workbook fixtures are synthetic and use fictional data; never use a real export.
 */
import { zipSync } from 'fflate';

import { MONEY_MANAGER_HEADERS } from '../money-manager-format.js';

export interface MoneyManagerFixtureRow {
  dateSerial?: string;
  account?: string;
  category?: string;
  subcategory?: string;
  content?: string;
  amount?: string;
  type?: '支出' | '収入' | '引き出し' | string;
  memo?: string;
  currency?: string;
  ignoredAmount?: string;
  ignoredAsset?: string;
  formula?: boolean;
}

export interface MoneyManagerFixtureOptions {
  rows?: readonly MoneyManagerFixtureRow[];
  sheetName?: string;
  date1904?: boolean;
  header?: readonly string[];
  extraEntries?: Readonly<Record<string, Uint8Array>>;
  footer?: string;
  trailingBlankRow?: boolean;
}

const DEFAULT_ROWS: readonly MoneyManagerFixtureRow[] = [
  {
    dateSerial: '46294.53678033565',
    account: '現金',
    category: '食費',
    content: '昼食',
    amount: '720.0',
    type: '支出',
    currency: 'JPY',
  },
  {
    dateSerial: '46295.5',
    account: '給与口座',
    category: '給与',
    content: '給与',
    amount: '150000.0',
    type: '収入',
    currency: 'JPY',
  },
];

export const MONEY_MANAGER_STRUCTURE_ROWS: readonly MoneyManagerFixtureRow[] = [
  {
    dateSerial: '46294.25',
    account: '日常口座',
    category: '食費',
    content: '朝食',
    amount: '321.0',
    type: '支出',
    currency: 'JPY',
  },
  {
    dateSerial: '46294.5',
    account: '給与口座',
    category: '給与',
    content: '月給',
    amount: '100000.0',
    type: '収入',
    currency: 'JPY',
  },
  {
    dateSerial: '46293.25',
    account: '給与口座',
    category: '積立口座',
    content: '積立',
    memo: '月次移動',
    amount: '25000.0',
    ignoredAmount: '999.0',
    ignoredAsset: '888.0',
    type: '引き出し',
    currency: 'JPY',
  },
  {
    dateSerial: '46293.75',
    account: '積立口座',
    category: '日常口座',
    content: '生活費',
    amount: '5000.0',
    type: '引き出し',
    currency: 'JPY',
  },
  {
    dateSerial: '46296.25',
    account: '積立口座',
    category: '日用品',
    content: '文房具',
    amount: '800.0',
    type: '支出',
    currency: 'JPY',
  },
];

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function numericCell(address: string, value: string, styleId?: number, formula = false): string {
  const style = styleId === undefined ? '' : ` s="${styleId}"`;
  const formulaPart = formula ? '<f>1+1</f>' : '';
  return `<c r="${address}"${style} t="n">${formulaPart}<v>${xmlEscape(value)}</v></c>`;
}

function stringCell(address: string, index: number): string {
  return `<c r="${address}" t="s"><v>${index}</v></c>`;
}

function sharedStringsXml(strings: readonly string[]): string {
  const body = strings.map((value) => `<si><t>${xmlEscape(value)}</t></si>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${body}</sst>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy/MM/dd HH:mm:ss"/><numFmt numFmtId="165" formatCode="yyyy/MM/dd"/></numFmts>
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs>
</styleSheet>`;
}

function contentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;
}

function workbookXml(sheetName: string, date1904: boolean): string {
  const escapedName = xmlEscape(sheetName).replace('ら', '&#x3089;');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<workbookPr date1904="${date1904 ? '1' : '0'}"/>
<sheets><sheet name="${escapedName}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

function workbookRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
}

function rootRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function appPropertiesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>らくな家計簿</Application></Properties>`;
}

function corePropertiesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"><dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">synthetic test fixture</dc:creator></cp:coreProperties>`;
}

export function buildMoneyManagerWorkbook(options: MoneyManagerFixtureOptions = {}): Uint8Array {
  const rows = options.rows ?? DEFAULT_ROWS;
  const header = options.header ?? MONEY_MANAGER_HEADERS;
  const values = new Set<string>(header);
  const remember = (value: string | undefined): number => {
    const text = value ?? '';
    values.add(text);
    return [...values].indexOf(text);
  };
  for (const row of rows) {
    remember(row.account ?? '現金');
    remember(row.category);
    remember(row.subcategory);
    remember(row.content);
    remember(row.type);
    remember(row.memo);
    remember(row.currency ?? 'JPY');
    remember(row.amount ?? '720.0');
    remember(row.ignoredAmount ?? row.amount ?? '720.0');
  }
  if (options.footer !== undefined) {
    remember(options.footer);
  }
  const shared = [...values];
  const sharedIndex = new Map(shared.map((value, index) => [value, index]));
  const indexOf = (value: string | undefined): number =>
    sharedIndex.get(value ?? '') ?? sharedIndex.get('') ?? 0;

  const headerCells = header
    .map((value, index) => stringCell(`${String.fromCharCode(65 + index)}1`, indexOf(value)))
    .join('');
  const dataRows = rows
    .map((row, rowIndex) => {
      const sourceRow = rowIndex + 2;
      const dateStyle = rowIndex % 2 === 0 ? 2 : 3;
      const amount = row.amount ?? '720.0';
      const ignoredAmount = row.ignoredAmount ?? amount;
      const ignoredAsset = row.ignoredAsset ?? amount;
      return `<row r="${sourceRow}">${numericCell(`A${sourceRow}`, row.dateSerial ?? '46294.5', dateStyle)}${stringCell(`B${sourceRow}`, indexOf(row.account ?? '現金'))}${stringCell(`C${sourceRow}`, indexOf(row.category))}${stringCell(`D${sourceRow}`, indexOf(row.subcategory))}${stringCell(`E${sourceRow}`, indexOf(row.content))}${numericCell(`F${sourceRow}`, amount, undefined, row.formula)}${stringCell(`G${sourceRow}`, indexOf(row.type ?? '支出'))}${stringCell(`H${sourceRow}`, indexOf(row.memo))}${stringCell(`I${sourceRow}`, indexOf(ignoredAmount))}${stringCell(`J${sourceRow}`, indexOf(row.currency ?? 'JPY'))}${numericCell(`K${sourceRow}`, ignoredAsset)}</row>`;
    })
    .join('');
  const footer = options.footer
    ? `<row r="${rows.length + 2}"><c r="A${rows.length + 2}" t="s"><v>${indexOf(options.footer)}</v></c></row>`
    : '';
  const trailingBlank = options.trailingBlankRow
    ? `<row r="${rows.length + 2 + (options.footer ? 1 : 0)}"></row>`
    : '';
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1"/><sheetData><row r="1">${headerCells}</row>${dataRows}${footer}${trailingBlank}</sheetData></worksheet>`;

  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': new TextEncoder().encode(contentTypesXml()),
    '_rels/.rels': new TextEncoder().encode(rootRelationshipsXml()),
    'docProps/app.xml': new TextEncoder().encode(appPropertiesXml()),
    'docProps/core.xml': new TextEncoder().encode(corePropertiesXml()),
    'xl/workbook.xml': new TextEncoder().encode(
      workbookXml(options.sheetName ?? 'らくな家計簿', options.date1904 ?? false),
    ),
    'xl/_rels/workbook.xml.rels': new TextEncoder().encode(workbookRelationshipsXml()),
    'xl/sharedStrings.xml': new TextEncoder().encode(sharedStringsXml(shared)),
    'xl/styles.xml': new TextEncoder().encode(stylesXml()),
    'xl/worksheets/sheet1.xml': new TextEncoder().encode(sheetXml),
    ...options.extraEntries,
  };
  return zipSync(entries);
}

export function buildMoneyManagerStructureWorkbook(
  options: MoneyManagerFixtureOptions = {},
): Uint8Array {
  return buildMoneyManagerWorkbook({
    ...options,
    rows: options.rows ?? MONEY_MANAGER_STRUCTURE_ROWS,
  });
}
