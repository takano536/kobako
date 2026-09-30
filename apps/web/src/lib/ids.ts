import { MAX_INT4_ID } from '@kobako/db/validation';

export { MAX_INT4_ID };
const MAX_INT4_ID_TEXT = String(MAX_INT4_ID);

export function parseInt4Id(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value)) {
    return undefined;
  }
  if (
    value.length > MAX_INT4_ID_TEXT.length ||
    (value.length === MAX_INT4_ID_TEXT.length && value > MAX_INT4_ID_TEXT)
  ) {
    return undefined;
  }
  return Number(value);
}
