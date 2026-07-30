'use client';

/**
 * Grants the server permission to sign for the user's Stellar wallet.
 *
 * Stellar wallets are created user-owned in Privy, so the app secret plus the
 * authorization key are not enough to sign — `rawSign` returns 401 until the user
 * grants the server's key quorum as an additional signer. That grant can only come
 * from the client, in the user's authenticated session; ownership cannot be moved
 * server-side because reassigning it requires the current owner's signature.
 *
 * Until this runs, every server-signed Stellar operation fails: no USDC trustline,
 * so no sending from Stellar and no claiming a CCTP bridge whose destination is
 * Stellar (the burn succeeds and the mint reverts on the transfer leg).
 */

import { useSigners } from '@privy-io/react-auth';
import { useCallback } from 'react';

export function useStellarSigner() {
  const { addSigners } = useSigners();

  /**
   * Idempotent — Privy accepts a repeat grant for a quorum that is already a signer.
   * Returns true when the server can sign for this wallet.
   */
  const grantServerSigner = useCallback(
    async (stellarAddress: string): Promise<boolean> => {
      try {
        const res = await fetch('/api/stellar/signer-id');
        if (!res.ok) {
          console.error('[StellarSigner] Server key quorum is not configured.');
          return false;
        }
        const { keyQuorumId } = await res.json();
        if (!keyQuorumId) return false;

        await addSigners({
          address: stellarAddress,
          signers: [{ signerId: keyQuorumId }],
        });
        console.log('[StellarSigner] Server signer granted for', stellarAddress.slice(0, 6));
        return true;
      } catch (err) {
        // Privy rejects a re-grant with "Duplicate signer(s) provided" rather than
        // treating it as a no-op — which means the signer is already there, i.e. the
        // exact state we were trying to reach.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes('duplicate')) return true;

        console.error('[StellarSigner] Failed to grant server signer:', err);
        return false;
      }
    },
    [addSigners],
  );

  return { grantServerSigner };
}
