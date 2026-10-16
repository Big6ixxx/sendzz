/**
 * What a Solana send failure means, from the raw text the RPC or a transaction status gives.
 *
 * Shared by the submit route (which turns them into an error code the client can act on) and
 * lib/errors/appErrors (which turns whatever reaches the browser into a sentence). Kept pure so
 * the wordings — which come from the runtime, the token program and the RPC, not from us — are
 * pinned by tests rather than rediscovered from a user report.
 */

export type SolanaSendErrorCode =
  /** The blockhash lapsed before the transaction landed. Nothing was sent; safe to retry. */
  | 'blockhash_expired'
  /** The token program refused: the sender's USDC account holds less than the transfer. */
  | 'insufficient_usdc'
  /** Our fee payer could not pay the fee or the rent — an ops problem, not the user's. */
  | 'sponsor_unfunded'
  /** This exact transaction already landed (an RPC duplicate), NOT a CCTP replay. */
  | 'already_landed';

export interface SolanaSendError {
  code: SolanaSendErrorCode;
  message: string;
}

export const SOLANA_SEND_MESSAGES: Record<SolanaSendErrorCode, string> = {
  blockhash_expired:
    'This transfer took too long to confirm and expired. Nothing was sent — please try again.',
  insufficient_usdc: "Your Solana USDC balance isn't enough for this transfer (including fees).",
  sponsor_unfunded:
    "We couldn't cover the Solana network fee right now. Nothing was sent — please try again shortly.",
  already_landed:
    "This transfer was already submitted. Please don't send it again — it will appear in your history shortly.",
};

export function classifySolanaSendError(raw: string): SolanaSendError | null {
  const msg = raw.toLowerCase();
  const hit = (code: SolanaSendErrorCode): SolanaSendError => ({
    code,
    message: SOLANA_SEND_MESSAGES[code],
  });

  if (
    msg.includes('blockhash not found') ||
    msg.includes('blockhashnotfound') ||
    msg.includes('block height exceeded') ||
    msg.includes('blockheightexceeded') ||
    msg.includes('blockhash_expired')
  ) {
    return hit('blockhash_expired');
  }

  // The RPC's duplicate-transaction refusal. Distinct from CCTP's "message already received":
  // that means the money arrived; this only means these bytes were already broadcast.
  if (msg.includes('has already been processed') || msg.includes('alreadyprocessed')) {
    return hit('already_landed');
  }

  // A fee payer with no SOL at all is an account the runtime has never seen credited.
  if (
    msg.includes('no record of a prior credit') ||
    msg.includes('insufficient lamports') ||
    msg.includes('insufficientfundsforfee') ||
    msg.includes('insufficient funds for fee') ||
    msg.includes('insufficientfundsforrent') ||
    msg.includes('insufficient funds for rent') ||
    msg.includes('sponsor_unfunded')
  ) {
    return hit('sponsor_unfunded');
  }

  // SPL Token's InsufficientFunds is error 1: "custom program error: 0x1" from preflight,
  // {"Custom":1} in a landed transaction's status.
  if (
    /custom program error: 0x1\b/.test(msg) ||
    msg.includes('{"custom":1}') ||
    msg.includes('error: insufficient funds') ||
    msg.includes('insufficient_usdc')
  ) {
    return hit('insufficient_usdc');
  }

  return null;
}
