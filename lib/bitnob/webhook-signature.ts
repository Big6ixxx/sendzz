import crypto from 'crypto';

/**
 * Verify a Bitnob webhook's HMAC-SHA512 signature.
 *
 * **Verify the raw body, not a re-serialisation of it.** This lived inline in the webhook route
 * and hashed `JSON.stringify(parsedBody)`, which only equals the bytes Bitnob signed when the
 * parse→stringify round-trip happens to be lossless. It frequently isn't:
 *
 *     50.00  → 50        1.10 → 1.1        1e2 → 100        "é" → "é"
 *
 * Deposit events carry numeric amounts, so `deposit.success` failed verification and was
 * rejected with a 400 — while terminal payout events, whose amounts are strings, verified
 * fine. The visible damage was a Bitnob payout that only ever produced an `expired` event:
 * `finalizePayout` is driven from `deposit.success`, so it was never called, the quote lapsed,
 * and Bitnob expired the order. Extracted here so the rule is testable and stays fixed.
 *
 * The re-stringified form is still accepted as a second attempt, so any event that verifies
 * today keeps verifying — but the raw body is the correct comparison.
 */
export function verifyBitnobSignature(params: {
  /** The request body exactly as received — never a re-serialised object. */
  rawBody: string;
  /** Value of the `x-bitnob-signature` header. */
  signature: string | undefined;
  secret: string | undefined;
}): boolean {
  const { rawBody, signature, secret } = params;
  if (!signature || !secret || !rawBody) return false;

  const received = String(signature).trim().toLowerCase();
  const key = String(secret).trim();

  const matches = (body: string): boolean => {
    const computed = crypto.createHmac('sha512', key).update(body).digest('hex').toLowerCase();
    // timingSafeEqual throws on length mismatch, so compare lengths first.
    if (received.length !== computed.length) return false;
    try {
      return crypto.timingSafeEqual(
        Buffer.from(computed, 'utf8'),
        Buffer.from(received, 'utf8'),
      );
    } catch {
      return false;
    }
  };

  if (matches(rawBody)) return true;

  // Fallback: a compact re-serialisation, for anything genuinely signed that way.
  try {
    return matches(JSON.stringify(JSON.parse(rawBody)));
  } catch {
    return false;
  }
}
