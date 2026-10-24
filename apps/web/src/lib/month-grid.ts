/** アプリ内の月選択で扱える年の範囲（月スイッチャーと同じ）。 */
export const MONTH_GRID_MIN_YEAR = 1900;
export const MONTH_GRID_MAX_YEAR = 9998;

export interface MonthGridCell {
  /** `YYYY-MM` */
  value: string;
  /** 「1月」〜「12月」 */
  label: string;
  selected: boolean;
}

/** `YYYY-MM` の年を返します。形式が違えば `null`。 */
export function yearOfMonth(value: string): number | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  return match ? Number(match[1]) : null;
}

/** 年を `delta` だけ動かします。範囲外なら `null`。 */
export function shiftGridYear(year: number, delta: number): number | null {
  const next = year + delta;
  return next < MONTH_GRID_MIN_YEAR || next > MONTH_GRID_MAX_YEAR ? null : next;
}

/** `year` 年の1〜12月を並べ、`selected`（`YYYY-MM`）と同じ月に選択状態を付けます。 */
export function monthGrid(year: number, selected: string | null): MonthGridCell[] {
  const yearText = String(year).padStart(4, '0');
  return Array.from({ length: 12 }, (_, index) => {
    const value = `${yearText}-${String(index + 1).padStart(2, '0')}`;
    return { value, label: `${index + 1}月`, selected: value === selected };
  });
}
