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
}

export function privySolanaAddress(
  user: { linkedAccounts?: readonly unknown[] } | null | undefined,
): string | undefined {
  const account = (user?.linkedAccounts as LinkedAccountLike[] | undefined)?.find(
    (a) => a.type === 'wallet' && a.walletClientType === 'privy' && a.chainType === 'solana',
  );
  return account?.address || undefined;
}
