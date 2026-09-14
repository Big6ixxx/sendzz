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

/** A finished wallet never changes — don't re-derive it on every mount. */
const SETTLED_MS = 30 * 60 * 1000;

/**
 * How long to sit on an UNFINISHED wallet before trying again.
 *
 * Short on purpose. A wallet without its signer grant cannot receive USDC at all, and the grant
 * is the one step that can fail quietly — so an incomplete result has to be treated as something
 * to retry, not an answer to cache. Treating it as final is why 15 of 43 wallets sat without a
 * trustline for weeks: the grant failed once, the failure was cached for half an hour, and by
 * the time it expired the user had gone.
 */
const UNFINISHED_MS = 20 * 1000;

const isReady = (w: StellarWalletInfo | null | undefined) =>
  !!w && w.signerGranted && w.trustlineReady;

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
      if (!wallet || isReady(wallet)) return wallet;

      // The signer grant is the one step the server cannot perform for itself, and the one that
      // fails silently — `addSigners` needs the user's own session, so anything that interrupts
      // it (a dismissed prompt, a navigation, a closed tab) leaves the wallet unable to hold
      // USDC. Its result was previously discarded; now a failure is visible and the caller
      // re-tries rather than caching a broken wallet as finished.
      if (!wallet.signerGranted) {
        const granted = await grantServerSigner(wallet.address);
        if (!granted) {
          console.warn(
            `[StellarWallet] Signer grant did not complete for ${wallet.address.slice(0, 6)} — ` +
              `this wallet cannot receive USDC until it does. Will retry.`,
          );
          return wallet;
        }
      }

      // Re-provision so trustline setup runs now that the server can sign.
      return (await provision()) ?? wallet;
    },
    enabled: (options?.enabled ?? true) && !!privyUserId && !!email,

    // An unfinished wallet goes stale almost immediately, so the next mount tries again. A
    // finished one is stable and is left alone.
    staleTime: (query) => (isReady(query.state.data) ? SETTLED_MS : UNFINISHED_MS),
    gcTime: SETTLED_MS,
    refetchOnWindowFocus: (query) => !isReady(query.state.data),
    refetchOnMount: (query) => !isReady(query.state.data),
    refetchOnReconnect: (query) => !isReady(query.state.data),
    retry: 2,
  });
}
