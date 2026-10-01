import { DEFAULT_HOUSEHOLD_ID, monthRange, shiftMonth, type DatabaseClient } from '@kobako/db';

export const E2E_MARKER_PREFIX = 'e2e:';
export const SENTINEL_MIN_YEAR = 9000;
export const SENTINEL_MAX_YEAR = 9997;
export const SENTINEL_CLEANUP_END_YEAR = SENTINEL_MAX_YEAR + 2;
export const SENTINEL_MONTH_COUNT = (SENTINEL_MAX_YEAR - SENTINEL_MIN_YEAR) * 12;

export function labelForMonth(value: string): string {
  const [year, monthNumber] = value.split('-');
  return `${year}年${Number(monthNumber)}月`;
}

export function markerFor(runMarkerPrefix: string, testName: string): string {
  return `${runMarkerPrefix}${testName}`;
}

export function assertCleanupMarker(runMarkerPrefix: string): void {
  if (
    !runMarkerPrefix.startsWith(E2E_MARKER_PREFIX) ||
    runMarkerPrefix.length <= E2E_MARKER_PREFIX.length
  ) {
    throw new Error('E2E cleanup marker is invalid');
  }
}

export async function monthIsEmpty(client: DatabaseClient, value: string): Promise<boolean> {
  const range = monthRange(value);
  const rows = await client.sql`
    select 1
    from transactions
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and occurred_on >= ${range.start}
      and occurred_on < ${range.endExclusive}
    union all
    select 1
    from transfers
    where household_id = ${DEFAULT_HOUSEHOLD_ID}
      and occurred_on >= ${range.start}
      and occurred_on < ${range.endExclusive}
    limit 1
  `;
  return rows.length === 0;
}

export async function chooseEmptyMonthPair(
  client: DatabaseClient,
  runId: string,
): Promise<[string, string]> {
  const runOffset = Number(
    BigInt(`0x${runId.replaceAll('-', '').slice(0, 12)}`) % BigInt(SENTINEL_MONTH_COUNT),
  );
  for (let offset = 0; offset < SENTINEL_MONTH_COUNT; offset += 1) {
    const candidateIndex = (runOffset + offset) % SENTINEL_MONTH_COUNT;
    const year = SENTINEL_MIN_YEAR + Math.floor(candidateIndex / 12);
    const monthNumber = (candidateIndex % 12) + 1;
    const candidate = `${year}-${String(monthNumber).padStart(2, '0')}`;
    const candidateNext = shiftMonth(candidate, 1);
    if ((await monthIsEmpty(client, candidate)) && (await monthIsEmpty(client, candidateNext))) {
      return [candidate, candidateNext];
    }
  }
  throw new Error(
    `No empty E2E sentinel month pair is available in ${SENTINEL_MIN_YEAR}-${SENTINEL_MAX_YEAR}; existing data was not deleted`,
  );
}

export async function assertEmptyMonth(client: DatabaseClient, value: string): Promise<void> {
  if (!(await monthIsEmpty(client, value))) {
    throw new Error(
      `E2E sentinel month ${value} is not empty; refusing to assert empty-month UI state`,
    );
  }
}
