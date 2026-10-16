/**
 * The history row a Solana send asks /api/solana/submit to write when it is still confirming —
 * see lib/solana/sponsor. Validated here; recordTransfer still checks it against the chain.
 */

/** What a direct send's history row says, given to submit so it can write the row itself. */
export interface SendRecord {
  recipient: string;
  amount: number;
  note?: string;
}

export function parseSendRecord(value: unknown): SendRecord | null {
  if (!value || typeof value !== 'object') return null;
  const { recipient, amount, note } = value as Record<string, unknown>;
  if (typeof recipient !== 'string' || !recipient || recipient.length > 200) return null;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  if (note !== undefined && (typeof note !== 'string' || note.length > 500)) return null;
  return { recipient, amount, note };
}
