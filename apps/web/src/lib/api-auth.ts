import { getCurrentHouseholdId, isDemoDeployment } from './ledger-data';

/** Name of the environment variable that holds the single bearer token. */
export const API_TOKEN_ENV = 'KOBAKO_API_TOKEN';

export type ApiAuth =
  { status: 'ok'; householdId: string } | { status: 'disabled' } | { status: 'unauthorized' };

/**
 * The API exists only outside demo deployments, where the household comes from a cookie and no
 * operator owns the data. A missing token disables the API instead of opening it.
 */
export function apiEnabled(): boolean {
  return !isDemoDeployment() && (process.env[API_TOKEN_ENV] ?? '').trim().length > 0;
}

/** Compare every byte so a wrong token cannot be guessed from response timing. */
function constantTimeEqual(left: string, right: string): boolean {
  const encodedLeft = new TextEncoder().encode(left);
  const encodedRight = new TextEncoder().encode(right);
  if (encodedLeft.length !== encodedRight.length) return false;
  let difference = 0;
  for (let index = 0; index < encodedLeft.length; index += 1) {
    difference |= encodedLeft[index]! ^ encodedRight[index]!;
  }
  return difference === 0;
}

export async function authorizeApiRequest(request: Request): Promise<ApiAuth> {
  const token = (process.env[API_TOKEN_ENV] ?? '').trim();
  if (isDemoDeployment() || token === '') return { status: 'disabled' };
  const header = request.headers.get('authorization') ?? '';
  const presented = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1]?.trim() ?? '';
  if (presented === '' || !constantTimeEqual(presented, token)) {
    return { status: 'unauthorized' };
  }
  return { status: 'ok', householdId: await getCurrentHouseholdId() };
}
