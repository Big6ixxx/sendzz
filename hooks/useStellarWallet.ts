'use client';

/**
 * The one place the app resolves a user's Stellar wallet.
 *
 * Provisioning is idempotent but not free — it reads Supabase, and on a cold wallet it
 * talks to Privy and Horizon. Several surfaces need the same answer (bridge, transfer,
 * activity detail), so this shares a single cached React Query result across all of
 * them rather than each firing its own request on every render.
 *
 * It also owns the one-time signer grant: the server cannot sign for a user-owned
 * Stellar wallet until its key quorum is added as a signer from the client, and that
 * grant has to happen before the account can get its USDC trustline.
 */

import { useStellarSigner } from '@/hooks/useStellarSigner';
import { usePrivy } from '@privy-io/react-auth';
import { useQuery } from '@tanstack/react-query';

export interface StellarWalletInfo {
  walletId: string;
  address: string;
  trustlineReady: boolean;
  signerGranted: boolean;
}

/** Provisioning result is stable for a long time — don't re-derive it on every mount. */
const STALE_MS = 30 * 60 * 1000;

export function useStellarWallet(options?: { enabled?: boolean }) {
  const { user } = usePrivy();
  const { grantServerSigner } = useStellarSigner();

  const privyUserId = user?.id;
  const email = user?.email?.address;

  return useQuery<StellarWalletInfo | null>({
    // Shared with every other consumer of ["stellar-wallet", id] so concurrent callers
    // collapse into a single request.
    queryKey: ['stellar-wallet', privyUserId],
    queryFn: async () => {
      const provision = async (): Promise<StellarWalletInfo | null> => {
        const res = await fetch('/api/stellar/provision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ privyUserId, email }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data?.walletId || !data?.address) return null;
        return {
          walletId: data.walletId,
          address: data.address,
          trustlineReady: !!data.trustlineReady,
          signerGranted: !!data.signerGranted,
        };
      };

      const wallet = await provision();
      if (!wallet || wallet.signerGranted) return wallet;

      // First run for this wallet — grant the server, then re-provision so the trustline
      // setup (which needs that grant) can actually run.
      const granted = await grantServerSigner(wallet.address);
      return granted ? ((await provision()) ?? wallet) : wallet;
    },
    enabled: (options?.enabled ?? true) && !!privyUserId && !!email,
    staleTime: STALE_MS,
    gcTime: STALE_MS,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: 1,
  });
}
