/**
 * The user's embedded Solana wallet address, read from their Privy linked accounts.
 *
 * A claim to Solana needs only the address — the server signs (see /api/bridge/solana-claim) —
 * so claim paths read it here rather than waiting on the `useWallets` object, which loads later
 * and is sometimes never ready, leaving "Solana wallet not ready" as the only answer to a claim
 * that needed nothing from it.
 */

interface LinkedAccountLike {
  type: string;
  address?: string;
  walletClientType?: string;
  chainType?: string;
  walletIndex?: number | null;
}

/**
 * The user's PRIMARY embedded Solana wallet: HD index 0.
 *
 * Some users have two (Privy's create-on-login and useEnsureSolanaWallet raced at signup), and
 * Privy lists linked accounts in no fixed order, so "the first Solana wallet" could be either
 * one, and could differ between sessions: money shown at one address one day and the other the
 * next. Every wallet that has ever moved money is index 0, and the server saves the same one
 * (lib/auth/session, embeddedSolanaAddresses). Every lookup of "the user's Solana wallet" goes
 * through here.
 */
export function primaryPrivySolanaAccount<T>(linkedAccounts: readonly T[] | undefined): T | undefined {
  const solana = ((linkedAccounts ?? []) as unknown as LinkedAccountLike[]).filter(
    (a) => a.type === 'wallet' && a.walletClientType === 'privy' && a.chainType === 'solana' && !!a.address,
  );
  solana.sort((x, y) => byWalletIndex(x.walletIndex, y.walletIndex));
  return solana[0] as T | undefined;
}

/**
 * The one ordering of a user's embedded wallets: HD index 0 first, a missing index last. Shared
 * by this file and the server (lib/auth/session) so the two cannot pick different primaries.
 */
export function byWalletIndex(a: number | null | undefined, b: number | null | undefined): number {
  return (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER);
}

export function privySolanaAddress(
  user: { linkedAccounts?: readonly unknown[] } | null | undefined,
): string | undefined {
  return (primaryPrivySolanaAccount(user?.linkedAccounts) as LinkedAccountLike | undefined)?.address || undefined;
}
