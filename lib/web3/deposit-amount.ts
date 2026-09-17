/**
 * Reading a USDC amount off an Alchemy transfer.
 *
 * Its own module, with no imports, so it can be tested without pulling in the scanner's
 * Supabase client — and so the one piece of arithmetic that decides what a user is credited
 * is small enough to read in full.
 */

/** The fields of an `alchemy_getAssetTransfers` result that bear on the amount. */
export interface AlchemyTransfer {
  hash: string;
  value: number | null;
  from: string;
  blockNum: string;
  metadata?: { blockTimestamp?: string };
  /** "external" is a native-currency transfer; "erc20" is a token Transfer event. */
  category?: string;
  /** The untouched on-chain amount. `decimal` is absent when Alchemy has no token metadata. */
  rawContract?: { value?: string | null; decimal?: string | null; address?: string | null };
}

/** USDC is 6 decimals on every chain this app touches. */
const USDC_DECIMALS = 6;

/**
 * The USDC amount of one transfer, or null if it cannot be established.
 *
 * `value` is NOT safe to read directly. Alchemy scales it only when it can look the token's
 * decimals up, and on Arc it cannot: USDC there is a precompile rather than a deployed ERC-20,
 * so `asset` and `rawContract.decimal` both come back null and `value` carries the RAW integer.
 * A 0.938136 USDC deposit arrives as 938136, and reading it straight through wrote that
 * six-orders-of-magnitude error into the ledger and the deposit email.
 *
 * So the raw integer is the source of truth wherever it is available, scaled here. That is
 * sound on every chain, not just Arc, because the caller queries by the USDC contract address —
 * the token is never in doubt.
 */
export function transferAmountUsdc(t: AlchemyTransfer): number | null {
  const raw = t.rawContract?.value;
  if (raw) {
    try {
      return Number(BigInt(raw)) / 10 ** decimalsFor(t);
    } catch {
      // Unparseable hex. Fall through to Alchemy's own figure.
    }
  }

  // No raw amount. Alchemy's `value` is only trustworthy where it reports the decimals it
  // scaled by; without that we cannot tell a scaled amount from an unscaled one.
  if (t.rawContract?.decimal) return t.value;
  return null;
}

/**
 * How many decimals this transfer's raw value is denominated in.
 *
 * Alchemy's own figure wins wherever it has one, because the same USDC arrives at two scales on
 * Arc: 6 as a token, 18 when sent natively as gas. Assuming 6 turned a 0.5 USDC deposit into
 * 500,000,000,000. The fallback is safe because the caller queries by USDC contract address.
 */
function decimalsFor(t: AlchemyTransfer): number {
  const reported = t.rawContract?.decimal;
  if (reported) {
    const n = Number.parseInt(reported, 16);
    if (Number.isFinite(n) && n >= 0 && n <= 36) return n;
  }
  return USDC_DECIMALS;
}
