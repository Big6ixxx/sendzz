'use client';

/**
 * The one place the app resolves a user's Stellar wallet.
 *
 * Stellar is opt-in. `useStellarWallet` only LOOKS: it returns the wallet the user already
 * has, or null, and never creates or activates one. Activation costs the sponsor an account
 * reserve and a USDC trustline per user, so it happens only through `useActivateStellar`,
 * which runs when someone explicitly asks for Stellar.
 *
 * Several surfaces need the same answer (bridge, transfer, receive, activity detail), so the
 * lookup is one cached React Query result shared across all of them.
 */

import { useStellarSigner } from '@/hooks/useStellarSigner';
import { usePrivy } from '@privy-io/react-auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

export interface StellarWalletInfo {
  walletId: string;
  address: string;
  trustlineReady: boolean;
  signerGranted: boolean;
}

/**
 * A looked-up wallet only changes when the user activates it, and activation writes the new
 * state straight into this cache — so there is nothing to poll for.
 */
const LOOKUP_STALE_MS = 30 * 60 * 1000;

export const isStellarReady = (w: StellarWalletInfo | null | undefined): w is StellarWalletInfo =>
  !!w && w.signerGranted && w.trustlineReady;

async function provision(privyUserId: string, activate: boolean): Promise<StellarWalletInfo | null> {
  const res = await fetch('/api/stellar/provision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ privyUserId, activate }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.provisioned || !data.walletId || !data.address) return null;
  return {
    walletId: data.walletId,
    address: data.address,
    trustlineReady: !!data.trustlineReady,
    signerGranted: !!data.signerGranted,
  };
}

const walletKey = (privyUserId: string | undefined) => ['stellar-wallet', privyUserId];

/** The user's Stellar wallet if they have one, else null. Never creates or activates. */
export function useStellarWallet(options?: { enabled?: boolean }) {
  const { user } = usePrivy();
  const privyUserId = user?.id;

  return useQuery<StellarWalletInfo | null>({
    queryKey: walletKey(privyUserId),
    queryFn: () => provision(privyUserId!, false),
    enabled: (options?.enabled ?? true) && !!privyUserId,
    staleTime: LOOKUP_STALE_MS,
    gcTime: LOOKUP_STALE_MS,
    refetchOnWindowFocus: false,
    retry: 2,
  });
}

/**
 * Set up Stellar for this user, on their explicit request: create the wallet if needed, grant
 * the server its signer (the one step only the user's own session can do), then activate the
 * account and add the USDC trustline. Resolves to the wallet — ready or not — or null if it
 * could not be created. Every consumer of `useStellarWallet` sees the result immediately.
 */
export function useActivateStellar() {
  const { user } = usePrivy();
  const { grantServerSigner } = useStellarSigner();
  const queryClient = useQueryClient();
  const privyUserId = user?.id;

  return useCallback(async (): Promise<StellarWalletInfo | null> => {
    if (!privyUserId) return null;

    let wallet = await provision(privyUserId, true);
    if (wallet && !wallet.signerGranted) {
      const granted = await grantServerSigner(wallet.address);
      if (!granted) {
        console.warn(`[StellarWallet] Signer grant did not complete for ${wallet.address.slice(0, 6)}`);
      } else {
        // The server can sign now, so this pass activates the account and adds the trustline.
        wallet = (await provision(privyUserId, true)) ?? wallet;
      }
    }

    queryClient.setQueryData(walletKey(privyUserId), wallet);
    if (wallet) queryClient.invalidateQueries({ queryKey: ['balance-stellar', wallet.address] });
    return wallet;
  }, [privyUserId, grantServerSigner, queryClient]);
}
