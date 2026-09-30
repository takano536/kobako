import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  buildMoneyManagerStructureWorkbook,
  buildMoneyManagerWorkbook,
} from './test-fixtures/money-manager-workbook.js';
import { MoneyManagerXlsxError, parseMoneyManagerXlsx } from './money-manager-xlsx.js';

describe('Money Manager XLSX parser', () => {
  it('parses the synthetic workbook structure, including numeric character references', async () => {
    const result = await parseMoneyManagerXlsx(buildMoneyManagerWorkbook());
    expect(result.errors).toEqual([]);
    expect(result.rows).toMatchObject([
      {
        sourceRow: 2,
        type: 'expense',
        amount: 720,
        occurredOn: '2026-09-29',
        categoryName: '食費',
        memo: '昼食',
      },
      {
        sourceRow: 3,
        type: 'income',
        amount: 150000,
        occurredOn: '2026-09-30',
        categoryName: '給与',
        memo: '給与',
      },
    ]);
  });
  it('mirrors the mixed transfer row structure in synthetic workbook data', async () => {
    const workbook = buildMoneyManagerStructureWorkbook();
    const sheetXml = new TextDecoder().decode(unzipSync(workbook)['xl/worksheets/sheet1.xml']);
    const sharedStringsXml = new TextDecoder().decode(unzipSync(workbook)['xl/sharedStrings.xml']);
    const result = await parseMoneyManagerXlsx(workbook);

    expect(sheetXml).toMatch(/<c r="D4" t="s"><v>\d+<\/v><\/c>/);
    expect(sheetXml).toMatch(/<c r="F4" t="n"><v>25000\.0<\/v><\/c>/);
    expect(sheetXml).toMatch(/<c r="I4" t="s"><v>\d+<\/v><\/c>/);
    expect(sharedStringsXml).toContain('999.0');
    expect(sheetXml).toMatch(/<c r="K4" t="n"><v>888\.0<\/v><\/c>/);
    expect(result.errors).toEqual([]);
    expect(result.rows.filter((row) => row.type === 'transfer')).toMatchObject([
      {
        sourceRow: 4,
        type: 'transfer',
        amount: 25000,
        occurredOn: '2026-09-28',
        fromAccountName: '給与口座',
        toAccountName: '積立口座',
        memo: '積立 / 月次移動',
      },
      {
        sourceRow: 5,
        type: 'transfer',
        amount: 5000,
        occurredOn: '2026-09-28',
        fromAccountName: '積立口座',
        toAccountName: '日常口座',
      },
    ]);
    expect(result.rows.filter((row) => row.type === 'expense')).toHaveLength(2);
    expect(result.rows.filter((row) => row.type === 'income')).toHaveLength(1);
    expect(result.rows.filter((row) => row.type === 'transfer')).toHaveLength(2);
  });

  it('parses sample-shaped income, expense, and transfer rows', async () => {
    const rows = [
      ...Array.from({ length: 66 }, (_, index) => ({
        account: '銀行',
        category: '食費',
        content: `支出${index}`,
        amount: '720.0',
        type: '支出',
        dateSerial: `${46294 + index}.5`,
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        account: '銀行',
        category: '給与',
        content: `収入${index}`,
        amount: '150000.0',
        type: '収入',
        dateSerial: `${46360 + index}.5`,
      })),
      ...Array.from({ length: 13 }, (_, index) => ({
        account: '銀行',
        category: '現金',
        content: `引き出し${index}`,
        amount: '1000.0',
        type: '引き出し',
        dateSerial: `${46370 + index}.5`,
      })),
    ];
    const result = await parseMoneyManagerXlsx(buildMoneyManagerWorkbook({ rows }));
    expect(result.rows).toHaveLength(82);
    expect(result.errors).toEqual([]);
    expect(result.rows.filter((row) => row.type === 'expense')).toHaveLength(66);
    expect(result.rows.filter((row) => row.type === 'income')).toHaveLength(3);
    expect(result.rows.filter((row) => row.type === 'transfer')).toHaveLength(13);
    expect(result.rows.find((row) => row.type === 'transfer')).toMatchObject({
      fromAccountName: '銀行',
      toAccountName: '現金',
      amount: 1000,
    });
  });

  it('rejects formula cells and does not use their cached value', async () => {
    const result = await parseMoneyManagerXlsx(
      buildMoneyManagerWorkbook({
        rows: [
          {
            account: '現金',
            category: '食費',
            content: '昼食',
            amount: '720.0',
            type: '支出',
            memo: '',
            dateSerial: '46294.5',
            formula: true,
          },
        ],
      }),
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toMatchObject([{ row: 2, code: 'formula' }]);
  });

  it('ignores a trailing blank row but rejects a non-empty footer', async () => {
    const trailing = await parseMoneyManagerXlsx(
      buildMoneyManagerWorkbook({ trailingBlankRow: true }),
    );
    expect(trailing.errors).toEqual([]);
    expect(trailing.rows).toHaveLength(2);

    const footer = await parseMoneyManagerXlsx(
      buildMoneyManagerWorkbook({ footer: '合計 150720' }),
    );
    expect(footer.errors).toMatchObject([{ row: 4 }]);
  });
  it('reports a file-level row limit before normalizing the worksheet', async () => {
    const result = await parseMoneyManagerXlsx(buildMoneyManagerWorkbook(), { maxRows: 1 });
    expect(result.rows).toEqual([]);
    expect(result.errors).toMatchObject([{ scope: 'file', code: 'max-rows' }]);
  });
  it('allows a trailing blank row at the configured row limit', async () => {
    const result = await parseMoneyManagerXlsx(
      buildMoneyManagerWorkbook({
        rows: [
          {
            dateSerial: '46294.5',
            account: '現金',
            category: '食費',
            content: '昼食',
            amount: '720.0',
            type: '支出',
          },
        ],
        trailingBlankRow: true,
      }),
      { maxRows: 1 },
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
  });
  it('rejects out-of-range shared-string indices in regular and formula cells', async () => {
    for (const formula of [false, true]) {
      const entries = unzipSync(buildMoneyManagerWorkbook());
      const worksheet = new TextDecoder().decode(entries['xl/worksheets/sheet1.xml']);
      const replacement = formula
        ? '<c r="B2" t="s"><f>0</f><v>999999</v></c>'
        : '<c r="B2" t="s"><v>999999</v></c>';
      entries['xl/worksheets/sheet1.xml'] = new TextEncoder().encode(
        worksheet.replace(/<c r="B2" t="s"><v>\d+<\/v><\/c>/, replacement),
      );
      await expect(parseMoneyManagerXlsx(zipSync(entries))).rejects.toBeInstanceOf(
        MoneyManagerXlsxError,
      );
    }
  });

  it('rejects a workbook with too many ZIP entries', async () => {
    const entries: Record<string, Uint8Array> = {};
    for (let index = 0; index < 128; index += 1) {
      entries[`extra-${index}.bin`] = new Uint8Array([index]);
    }
    await expect(
      parseMoneyManagerXlsx(buildMoneyManagerWorkbook({ extraEntries: entries })),
    ).rejects.toBeInstanceOf(MoneyManagerXlsxError);
  });

  it('rejects a ZIP entry larger than the per-entry limit', async () => {
    const largeEntry = new Uint8Array(8 * 1024 * 1024 + 1);
    await expect(
      parseMoneyManagerXlsx(
        buildMoneyManagerWorkbook({ extraEntries: { 'oversized.bin': largeEntry } }),
      ),
    ).rejects.toBeInstanceOf(MoneyManagerXlsxError);
  });
});
