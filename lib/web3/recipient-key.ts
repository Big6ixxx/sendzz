/**
 * How a transfer's recipient is stored in `transfers.recipient_email`.
 *
 * The column holds an email for app-to-app sends and the destination address for sends to an
 * external wallet. Emails and EVM addresses are case-insensitive and stored lowercased, as they
 * always were. Solana (base58) and Stellar (base32) addresses are NOT: lowercasing one turns it
 * into a different, usually invalid, address — and the history then shows, and links to, a
 * wallet that never received anything.
 */
export function normalizeRecipient(recipient: string): string {
  const trimmed = recipient.trim();
  if (trimmed.includes('@') || /^0x[0-9a-fA-F]{40}$/.test(trimmed)) return trimmed.toLowerCase();
  return trimmed;
}
