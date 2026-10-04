import { describe, expect, it } from 'vitest';

import {
  MONEY_MANAGER_HEADERS,
  normalizeMoneyManagerCells,
  planMoneyManagerCategories,
  type MoneyManagerCell,
  type MoneyManagerCellGrid,
  type MoneyManagerGridRow,
  type MoneyManagerNormalizationResult,
} from './money-manager-format.js';

function stringCell(value: string): MoneyManagerCell {
  return { kind: 'string', value };
}

function numberCell(value: string, isDate = false): MoneyManagerCell {
  return { kind: 'number', value, isDate };
}

function blankCell(): MoneyManagerCell {
  return { kind: 'blank' };
}

function headerRow(
  cells: readonly MoneyManagerCell[] = MONEY_MANAGER_HEADERS.map(stringCell),
): MoneyManagerGridRow {
  return { rowNumber: 1, cells };
}

function dataRow(
  overrides: Partial<{
    date: MoneyManagerCell;
    account: MoneyManagerCell;
    category: MoneyManagerCell;
    subcategory: MoneyManagerCell;
    content: MoneyManagerCell;
    amount: MoneyManagerCell;
    type: MoneyManagerCell;
    memo: MoneyManagerCell;
    ignoredAmount: MoneyManagerCell;
    currency: MoneyManagerCell;
    ignoredAsset: MoneyManagerCell;
  }> = {},
  rowNumber = 2,
): MoneyManagerGridRow {
  const values: MoneyManagerCell[] = [
    overrides.date ?? numberCell('46294.53678033565', true),
    overrides.account ?? stringCell('現金'),
    overrides.category ?? stringCell('食費'),
    overrides.subcategory ?? blankCell(),
    overrides.content ?? stringCell('昼食'),
    overrides.amount ?? numberCell('720.0'),
    overrides.type ?? stringCell('支出'),
    overrides.memo ?? blankCell(),
    overrides.ignoredAmount ?? stringCell('720.0'),
    overrides.currency ?? stringCell('JPY'),
    overrides.ignoredAsset ?? numberCell('720'),
  ];
  return { rowNumber, cells: values };
}

function normalize(
  rows: readonly MoneyManagerGridRow[],
  options: { maxRows?: number } = {},
): MoneyManagerNormalizationResult {
  const grid: MoneyManagerCellGrid = { date1904: false, rows };
  return normalizeMoneyManagerCells(grid, options);
}

function firstError(result: MoneyManagerNormalizationResult) {
  const error = result.errors[0];
  if (!error) {
    throw new Error('expected a normalization error');
  }
  return error;
}

describe('Money Manager pure cell normalizer', () => {
  it('normalizes ordinary expense and income rows', () => {
    const result = normalize([headerRow(), dataRow(), dataRow({ type: stringCell('収入') }, 3)]);
    expect(result.errors).toEqual([]);
    expect(result.rows).toMatchObject([
      { sourceRow: 2, type: 'expense', amount: 720, categoryName: '食費' },
      { sourceRow: 3, type: 'income', amount: 720, categoryName: '食費' },
    ]);
  });

  it('uses Category when Subcategory is blank', () => {
    const result = normalize([headerRow(), dataRow({ category: stringCell('交通') })]);
    const row = result.rows[0];
    expect(row?.type === 'transfer' ? undefined : row?.categoryName).toBe('交通');
  });

  it('combines Category and Subcategory', () => {
    const result = normalize([
      headerRow(),
      dataRow({ category: stringCell('食費'), subcategory: stringCell('外食') }),
    ]);
    const row = result.rows[0];
    expect(row?.type === 'transfer' ? undefined : row?.categoryName).toBe('食費 / 外食');
  });

  it('plans category reuse and creation without conflating transaction types', () => {
    const result = normalize([
      headerRow(),
      dataRow({ category: stringCell('食費') }),
      dataRow({ category: stringCell('給与'), type: stringCell('収入') }, 3),
      dataRow({ category: stringCell('新カテゴリ') }, 4),
    ]);
    const plan = planMoneyManagerCategories(result.rows, [
      { type: 'expense', name: '食費' },
      { type: 'income', name: '食費' },
    ]);
    expect(plan).toEqual([
      { type: 'expense', name: '食費', action: 'reuse' },
      { type: 'income', name: '給与', action: 'create' },
      { type: 'expense', name: '新カテゴリ', action: 'create' },
    ]);
  });

  it('floors a fractional Excel date serial without timezone conversion', () => {
    const result = normalize([headerRow(), dataRow({ date: numberCell('46294.99999', true) })]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.occurredOn).toBe('2026-09-29');
  });

  it('rejects string date cells because the export uses numeric serials', () => {
    const result = normalize([headerRow(), dataRow({ date: stringCell('2026/09/29') })]);
    expect(firstError(result)).toMatchObject({ code: 'invalid-date', row: 2 });
  });

  it('accepts an integer amount represented as 720.0', () => {
    const result = normalize([headerRow(), dataRow({ amount: numberCell('720.0') })]);
    expect(result.rows[0]?.amount).toBe(720);
  });

  it('rejects comma-grouped amount strings because the export does not use them', () => {
    const result = normalize([headerRow(), dataRow({ amount: stringCell('1,200') })]);
    expect(firstError(result)).toMatchObject({ code: 'invalid-amount', row: 2 });
  });

  it('allows zero and preserves a negative expense amount', () => {
    const zero = normalize([headerRow(), dataRow({ amount: numberCell('0.0') })]);
    const negative = normalize([headerRow(), dataRow({ amount: numberCell('-1922.0') })]);
    expect(zero.rows[0]?.amount).toBe(0);
    expect(negative.rows[0]).toMatchObject({ amount: -1922, type: 'expense' });
  });

  it('ignores trailing blank rows', () => {
    const result = normalize([headerRow(), dataRow(), { rowNumber: 3, cells: [] }]);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
  });

  it('rejects a non-empty footer or summary row', () => {
    const result = normalize([
      headerRow(),
      dataRow(),
      { rowNumber: 3, cells: [stringCell('合計')] },
    ]);
    expect(firstError(result)).toMatchObject({ scope: 'row', row: 3 });
  });

  it('rejects a missing required header column', () => {
    const result = normalize([headerRow(MONEY_MANAGER_HEADERS.slice(0, 10).map(stringCell))]);
    expect(firstError(result)).toMatchObject({ code: 'unsupported-header', row: 1 });
  });

  it('rejects the unsupported ten-column PC layout', () => {
    const pcHeaders = [
      '日付',
      '資産',
      '分類',
      '小分類',
      '内容',
      '金額(￥)',
      '収入/支出',
      'メモ',
      '金額',
      '通貨',
    ];
    const result = normalize([headerRow(pcHeaders.map(stringCell))]);
    expect(firstError(result)).toMatchObject({ code: 'unsupported-header', row: 1 });
  });

  it('rejects an invalid Excel date serial', () => {
    const result = normalize([headerRow(), dataRow({ date: numberCell('60.0', true) })]);
    expect(firstError(result)).toMatchObject({ code: 'invalid-date', row: 2 });
  });
  it('rejects an oversized date serial lexeme before integer conversion', () => {
    const result = normalize([
      headerRow(),
      dataRow({ date: numberCell(`${'9'.repeat(100_000)}.5`, true) }),
    ]);
    expect(firstError(result)).toMatchObject({ code: 'invalid-date', row: 2 });
  });

  it('includes source cell values in row errors for import previews', () => {
    const result = normalize([
      headerRow(),
      dataRow({
        account: stringCell('みずうみ銀行'),
        category: stringCell('食費'),
        content: stringCell('ランチ'),
        amount: numberCell('12.5'),
        type: stringCell('支出'),
      }),
    ]);
    expect(firstError(result)).toMatchObject({
      code: 'invalid-amount',
      row: 2,
      excerpt: '日付=2026-09-29・資産=みずうみ銀行・分類=食費・内容=ランチ・金額=12.5・種別=支出',
    });
  });

  it('rejects a decimal amount other than .0', () => {
    const result = normalize([headerRow(), dataRow({ amount: numberCell('720.5') })]);
    expect(firstError(result)).toMatchObject({ code: 'invalid-amount', row: 2 });
  });

  it('rejects an out-of-range amount', () => {
    const result = normalize([headerRow(), dataRow({ amount: numberCell('1000000000.0') })]);
    expect(firstError(result)).toMatchObject({ code: 'invalid-amount', row: 2 });
  });
  it('rejects an oversized amount lexeme before integer conversion', () => {
    const result = normalize([
      headerRow(),
      dataRow({ amount: numberCell(`${'9'.repeat(100_000)}.0`) }),
    ]);
    expect(firstError(result)).toMatchObject({ code: 'invalid-amount', row: 2 });
  });

  it('rejects a blank amount', () => {
    const result = normalize([headerRow(), dataRow({ amount: blankCell() })]);
    expect(firstError(result)).toMatchObject({ code: 'invalid-amount', row: 2 });
  });

  it('rejects an unknown transaction type', () => {
    const result = normalize([headerRow(), dataRow({ type: stringCell('返金') })]);
    expect(firstError(result)).toMatchObject({ code: 'unknown-type', row: 2 });
  });

  it('rejects a non-JPY currency row', () => {
    const result = normalize([headerRow(), dataRow({ currency: stringCell('USD') })]);
    expect(firstError(result)).toMatchObject({ code: 'unsupported-currency', row: 2 });
  });

  it('parses a transfer with source and destination asset names', () => {
    const result = normalize([
      headerRow(),
      dataRow(
        {
          account: stringCell('銀行'),
          category: stringCell('現金'),
          content: stringCell('引き出し'),
          amount: numberCell('5000.0'),
          type: stringCell('引き出し'),
        },
        2,
      ),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        sourceRow: 2,
        type: 'transfer',
        amount: 5000,
        occurredOn: '2026-09-29',
        fromAccountName: '銀行',
        toAccountName: '現金',
        memo: '引き出し',
      },
    ]);
  });
  it('rejects transfers with empty, same, or non-positive asset data', () => {
    const empty = normalize([
      headerRow(),
      dataRow({
        account: blankCell(),
        category: stringCell('現金'),
        type: stringCell('引き出し'),
      }),
    ]);
    expect(firstError(empty)).toMatchObject({ code: 'invalid-asset', row: 2 });

    const same = normalize([
      headerRow(),
      dataRow({
        account: stringCell('現金'),
        category: stringCell('現金'),
        type: stringCell('引き出し'),
      }),
    ]);
    expect(firstError(same)).toMatchObject({ code: 'same-asset', row: 2 });

    const negative = normalize([
      headerRow(),
      dataRow({
        account: stringCell('銀行'),
        category: stringCell('現金'),
        amount: numberCell('-1.0'),
        type: stringCell('引き出し'),
      }),
    ]);
    expect(firstError(negative)).toMatchObject({ code: 'invalid-amount', row: 2 });
  });

  it('rejects a memo over 200 characters', () => {
    const result = normalize([headerRow(), dataRow({ content: stringCell('x'.repeat(201)) })]);
    expect(firstError(result)).toMatchObject({ code: 'memo-too-long', row: 2 });
  });

  it('rejects a category over 80 characters', () => {
    const result = normalize([headerRow(), dataRow({ category: stringCell('x'.repeat(81)) })]);
    expect(firstError(result)).toMatchObject({ code: 'category-too-long', row: 2 });
  });

  it('rejects formula cells instead of using a cached value', () => {
    const result = normalize([
      headerRow(),
      dataRow({ amount: { kind: 'number', value: '720.0', formula: true } }),
    ]);
    expect(firstError(result)).toMatchObject({ code: 'formula', row: 2 });
    expect(result.rows).toEqual([]);
  });

  it('rejects more than the configured maximum rows', () => {
    const result = normalize([headerRow(), dataRow(), dataRow({}, 3)], { maxRows: 1 });
    expect(firstError(result)).toMatchObject({ code: 'max-rows' });
  });
});
