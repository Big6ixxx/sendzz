/**
 * PII-safe logging helpers.
 *
 * Server logs are widely readable — platform dashboards, log drains, error trackers, support
 * tooling, and anyone with deploy access — and they're retained long after the request. An
 * email address in a log line is personal data sitting in all of those places, and pairing it
 * with an amount or a bank account turns a log into a record of who paid whom.
 *
 * So the email is masked before it's written. Enough survives to correlate a user's requests
 * while debugging; not enough to identify them from the log alone.
 *
 * Use it at the call site rather than reaching for the raw value:
 *   console.log(`[Transfer] recorded for ${redactEmail(email)}`)
 */

/** `alice@example.com` → `a***e@example.com`. Keeps the domain, which is the useful part. */
export function redactEmail(email: string | null | undefined): string {
  if (!email) return '<none>';
  const at = email.indexOf('@');
  if (at <= 0) return '<redacted>';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local[0]}***${domain}`;
  return `${local[0]}***${local[local.length - 1]}${domain}`;
}
