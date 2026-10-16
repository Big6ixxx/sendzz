/**
 * Reading the errors a Solana `receive_message` claim fails with.
 *
 * The program's own words are in the transaction logs, not the error object: an Anchor failure
 * surfaces as `custom program error: 0x…` with the name and message only in a log line. Matching
 * the error object alone missed every one of them, so an expired attestation read as a generic
 * failure and the user was told to retry something that could never succeed.
 */

/**
 * A replayed claim is the expected outcome of a double-click or a retry after a dropped
 * response, not a failure — the funds are already delivered.
 *
 * "already in use" is the System Program refusing to create the message's `used_nonce` account
 * because a previous delivery already did.
 */
export function isAlreadyClaimed(raw: string): boolean {
  const lower = raw.toLowerCase();
  return (
    lower.includes('nonce already used') ||
    lower.includes('already received') ||
    lower.includes('already processed') ||
    lower.includes('alreadyprocessed') ||
    lower.includes('already in use')
  );
}

/** The attestation's expiry has passed; Circle has to sign the message again. */
export function isExpiredAttestation(raw: string): boolean {
  const lower = raw.toLowerCase();
  return (
    lower.includes('messageexpired') ||
    lower.includes('message expired') ||
    lower.includes('message has expired') ||
    lower.includes('attestation expired')
  );
}

/** The error text plus any logs carried on it (SendTransactionError keeps them separately). */
export function errorText(err: unknown, logs?: string[] | null): string {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
  const carried =
    logs ?? ((err as { logs?: unknown })?.logs as string[] | undefined) ?? undefined;
  return Array.isArray(carried) && carried.length > 0 ? `${message}\n${carried.join('\n')}` : message;
}

/**
 * The program's own error, from an Anchor log line such as
 * `Program log: AnchorError … Error Code: MessageExpired. Error Number: 6017. Error Message: …`.
 * Safe to show: it names a rule, never an account or a key.
 */
export function programErrorCode(raw: string): string | null {
  const match = raw.match(/Error Code: ([A-Za-z0-9_]+)/);
  return match ? match[1] : null;
}

export type ClaimFailure =
  | { kind: 'already_claimed' }
  | { kind: 'attestation_expired'; error: string; code: 'attestation_expired' }
  | { kind: 'program_error'; error: string; code: 'program_error'; detail: string | null };

/** Turn a failed claim's error text into the response the route sends. */
export function classifyClaimFailure(raw: string): ClaimFailure {
  if (isAlreadyClaimed(raw)) return { kind: 'already_claimed' };
  if (isExpiredAttestation(raw)) {
    // Worded for classifyAppError, which files "must be re-signed" under attestation_expired —
    // the category whose handler asks Circle for a fresh signature.
    return {
      kind: 'attestation_expired',
      error: 'This transfer must be re-signed before it can be delivered (message expired).',
      code: 'attestation_expired',
    };
  }
  return {
    kind: 'program_error',
    error: "We couldn't complete the claim right now. Your funds are safe — please try again shortly.",
    code: 'program_error',
    detail: programErrorCode(raw),
  };
}
