/**
 * Is our Solana fee payer able to pay for what it is about to sign?
 *
 * Every sponsored Solana transaction — a send, an off-ramp settlement, a CCTP burn or claim — is
 * paid from one Circle wallet's SOL. When it runs dry, every one of those fails with the
 * runtime's "Attempt to debit an account but found no record of a prior credit", which reads to
 * a user as their own problem and to us as nothing at all. So: check before signing, refuse
 * with a sentence instead of a simulation dump, and tell the admins while there is still time
 * to top up. The Stellar sponsor does the same (lib/stellar/privy-wallet).
 */

/** Rent-exempt minimum for a 165-byte SPL token account. */
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280;

/** Two signatures at 5000 lamports, plus the most priority fee the sponsor policy allows. */
export const MAX_SPONSORED_FEE_LAMPORTS = 10_000 + 80_000;

/** Below this the admins hear about it. Overridable, in SOL. */
export const DEFAULT_ALERT_THRESHOLD_LAMPORTS = 500_000_000; // 0.5 SOL

export type FeePayerVerdict = 'ok' | 'low' | 'insufficient';

/** Lamports needed to pay for one sponsored transaction that opens `newAccounts` accounts. */
export function lamportsNeeded(newAccounts: number): number {
  return MAX_SPONSORED_FEE_LAMPORTS + newAccounts * TOKEN_ACCOUNT_RENT_LAMPORTS;
}

export function alertThresholdLamports(env: string | undefined): number {
  const sol = env ? Number(env) : NaN;
  return Number.isFinite(sol) && sol > 0 ? Math.round(sol * 1e9) : DEFAULT_ALERT_THRESHOLD_LAMPORTS;
}

export function feePayerVerdict(
  balanceLamports: number,
  neededLamports: number,
  thresholdLamports: number,
): FeePayerVerdict {
  if (balanceLamports < neededLamports) return 'insufficient';
  if (balanceLamports < thresholdLamports) return 'low';
  return 'ok';
}
