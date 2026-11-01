type FixedCostFrequency = {
  intervalCount: number;
  intervalUnit: 'month' | 'year';
};

export function fixedCostFrequencyGroupLabel(row: FixedCostFrequency): string {
  if (row.intervalUnit === 'month') {
    return row.intervalCount === 1 ? '毎月' : `${row.intervalCount}か月ごと`;
  }
  return row.intervalCount === 1 ? '毎年' : `${row.intervalCount}年ごと`;
}

function frequencySortKey(row: FixedCostFrequency): readonly [number, number] {
  if (row.intervalUnit === 'month') {
    return row.intervalCount === 1 ? [0, 0] : [1, row.intervalCount];
  }
  return row.intervalCount === 1 ? [2, 0] : [3, row.intervalCount];
}

export function groupFixedCostsByFrequency<T extends FixedCostFrequency>(
  rows: readonly T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const label = fixedCostFrequencyGroupLabel(row);
    const group = groups.get(label);
    if (group) {
      group.push(row);
    } else {
      groups.set(label, [row]);
    }
  }

  return new Map(
    [...groups.entries()].sort(([firstLabel, firstRows], [secondLabel, secondRows]) => {
      const first = frequencySortKey(firstRows[0]!);
      const second = frequencySortKey(secondRows[0]!);
      return first[0] - second[0] || first[1] - second[1] || firstLabel.localeCompare(secondLabel);
    }),
  );
}
