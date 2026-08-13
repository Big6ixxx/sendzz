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
  const candidateSecrets = Array.from(new Set([
    secret,
    process.env.BITNOB_API_KEY,
  ].filter((s): s is string => !!s && s.trim().length > 0)));

  for (const candidateSecret of candidateSecrets) {
    const key = candidateSecret.trim();

    const matches = (body: string): boolean => {
      const computed = crypto.createHmac('sha512', key).update(body).digest('hex').toLowerCase();
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
      if (matches(JSON.stringify(JSON.parse(rawBody)))) return true;
    } catch {
      // ignore
    }
  }

  if (process.env.NODE_ENV === 'development' || process.env.BITNOB_ALLOW_INVALID_SIGNATURE === 'true') {
    console.warn(
      `[Bitnob Webhook Signature] Development mode bypass — HMAC mismatch for signature '${received.slice(0, 16)}...' against local secrets. Accepting event for local testing.`,
    );
    return true;
  }

  return false;
}
