/**
 * Last line of defence between a raw error and a user's screen.
 *
 * Errors pick up things on the way up that must never be shown: JSON envelopes, HTML error
 * pages, request paths, stack frames — and the names of the payment providers we route
 * through, which are our commercial arrangement and not something a user needs or should see.
 *
 * The rule here is deliberately strict: a message is shown **only** if it's clean. Anything
 * carrying machine detail is discarded wholesale rather than patched up, because a partially
 * scrubbed message tends to leak the one fragment you didn't think of. The full original is
 * always logged, so nothing is lost for debugging.
 */

/** Providers we integrate with. Never surfaced to users. */
const PROVIDER_NAMES = /\b(paycrest|bitnob|privy|alchemy|didit|supabase|circle|cctp)\b/i;

/** Signatures of machine detail that has no place in a toast. */
const MACHINE_DETAIL: RegExp[] = [
  /[{}]/, // JSON envelope
  /<\/?[a-z][\s\S]*>/i, // HTML
  /https?:\/\//i, // URLs
  /\.(ts|tsx|js|jsx|mjs|cjs):\d+/i, // source locations / stack frames, anywhere in the string
  /\b(GET|POST|PUT|PATCH|DELETE)\s+\//, // request lines
  /\b\/api\//, // API paths
  /\b(correlation_id|request_id|digest|stack|errorResultXdr)\b/i,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, // uuids
  /0x[0-9a-f]{16,}/i, // hashes / calldata
];

const GENERIC = 'Something went wrong. Please try again.';

/**
 * A message safe to show a user, or null when the input can't be salvaged.
 * `null` means "use your own copy" — never fall back to the raw string.
 */
export function toUserSafeMessage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const msg = raw.trim();
  if (!msg || msg.length > 300) return null;
  if (PROVIDER_NAMES.test(msg)) return null;
  if (MACHINE_DETAIL.some((re) => re.test(msg))) return null;
  // A bare status or error-code string tells a user nothing.
  if (/^(error|failed|bad request|internal server error)\b/i.test(msg)) return null;
  if (/^\d{3}\b/.test(msg)) return null;
  return msg;
}


export const GENERIC_ERROR_MESSAGE = GENERIC;
