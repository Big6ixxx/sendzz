/**
 * PII-safe logging helpers.
 *
 * Server logs are widely readable — platform dashboards, log drains, error trackers, support
 * tooling, and anyone with deploy access — and they're retained long after the request. An
 * email address in a log line is personal data sitting in all of those places, and pairing it
 * with an amount or a bank account turns a log into a record of who paid whom.
 *
 * So identifiers get masked before they're written. Enough survives to correlate a user's
 * requests while debugging; not enough to identify them from the log alone.
 *
 * Use `redactEmail` / `maskAddress` at the call site rather than reaching for the raw value:
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

/** `0x1234…abcd`. Public on-chain, but still a stable identifier — shorten it in logs. */
export function maskAddress(address: string | null | undefined): string {
  if (!address) return '<none>';
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Bank account numbers: last 4 only, the same convention statements use. */
export function maskAccountNumber(accountNumber: string | null | undefined): string {
  if (!accountNumber) return '<none>';
  const digits = accountNumber.replace(/\s/g, '');
  if (digits.length <= 4) return '****';
  return `****${digits.slice(-4)}`;
}

/**
 * A stable, non-reversible tag for one account — for correlating a user's log lines across a
 * session without writing down who they are. Not a security control; just not plaintext.
 */
export function userTag(email: string | null | undefined): string {
  if (!email) return 'anon';
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = (hash << 5) - hash + email.charCodeAt(i);
    hash |= 0;
  }
  return `u_${Math.abs(hash).toString(36)}`;
}
