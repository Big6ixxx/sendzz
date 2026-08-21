/**
 * Where a refund goes back to.
 *
 * A refund must return to the wallet the deposit came FROM, on the chain it came from. Sending
 * USDC to a user's EVM smart account because their Stellar withdrawal failed would be a second
 * loss on top of the first, and an irreversible one.
 *
 * The amount owed is decided in `finalize_withdrawal_failed` (migration 039) and stored on the
 * row, deliberately not recomputed here: two implementations of "what do we owe" is exactly the
 * drift that would let the dashboard and the database disagree about a debt.
 */

/** The wallets we hold for a user, as stored on their profile. */
export interface UserWallets {
  smart_account_address?: string | null;
  solana_address?: string | null;
  stellar_address?: string | null;
}

/**
 * The address to refund to for a deposit made on `chain`, or null when we hold no wallet for
 * it — in which case an operator has to ask the user rather than guess.
 *
 * EVM chains all share the smart account, so anything that is not Solana or Stellar resolves
 * to it. An unknown chain with no smart account on file returns null rather than a best guess.
 */
export function refundDestination(
  chain: string | null | undefined,
  wallets: UserWallets | null | undefined,
): string | null {
  if (!wallets) return null;
  switch ((chain || "").toLowerCase()) {
    case "stellar":
      return wallets.stellar_address ?? null;
    case "solana":
      return wallets.solana_address ?? null;
    default:
      return wallets.smart_account_address ?? null;
  }
}
