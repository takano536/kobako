export const AMOUNT_LIMIT = 999_999_999;
export const AMOUNT_LIMIT_TEXT = String(AMOUNT_LIMIT);

/**
 * An amount is an ASCII integer, optionally grouped in comma-separated groups
 * of three digits after a one-to-three digit leading group.
 */
export const AMOUNT_TEXT_PATTERN_SOURCE = String.raw`-?(?:\d+|[1-9]\d{0,2}(?:,\d{3})+)`;
export const AMOUNT_TEXT_PATTERN = new RegExp(`^${AMOUNT_TEXT_PATTERN_SOURCE}$`);

/** A short, shared message for amount fields on the client and server. */
export const AMOUNT_FORMAT_MESSAGE = '整数で入力してください（例: 1,200 / -500）';
