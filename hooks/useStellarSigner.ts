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

import { useSigners, useUser, type User } from '@privy-io/react-auth';
import { useCallback, useEffect, useRef } from 'react';

/** Refreshes of the user to try while Privy has not yet linked a just-created wallet. */
const USER_REFRESH_ATTEMPTS = 3;
const USER_REFRESH_GAP_MS = 1_000;

/** How long to wait for a user that already has the wallet to reach a render. */
const RENDER_WAIT_MS = 2_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The same test Privy's `addSigners` applies: an embedded (privy) wallet with exactly this
 * address. Privy only normalises 0x addresses, so a Stellar address must match as is.
 */
const hasWallet = (user: User | null, address: string) =>
  !!user?.linkedAccounts.some(
    (a) => a.type === 'wallet' && a.walletClientType === 'privy' && a.address === address,
  );

type RenderWaiter = { address: string; resolve: () => void };

export function useStellarSigner() {
  const { addSigners } = useSigners();
  const { user, refreshUser } = useUser();

  // `addSigners` looks the address up in the user it was rendered with, so a wallet the server
  // created a moment ago is "not associated with current user" until a render carries the
  // refreshed user. The grant below waits for that render, then calls the `addSigners` from it.
  const addSignersRef = useRef(addSigners);
  const userRef = useRef(user);
  const waiters = useRef<RenderWaiter[]>([]);
  useEffect(() => {
    addSignersRef.current = addSigners;
    userRef.current = user;
    waiters.current = waiters.current.filter((w) => {
      if (!hasWallet(user, w.address)) return true;
      w.resolve();
      return false;
    });
  }, [addSigners, user]);

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

        /** Resolves true once a render carries a user with this wallet, false after the timeout. */
        const waitForRender = () =>
          new Promise<boolean>((resolve) => {
            if (hasWallet(userRef.current, stellarAddress)) return resolve(true);
            const waiter: RenderWaiter = {
              address: stellarAddress,
              resolve: () => {
                clearTimeout(timer);
                resolve(true);
              },
            };
            const timer = setTimeout(() => {
              waiters.current = waiters.current.filter((w) => w !== waiter);
              resolve(false);
            }, RENDER_WAIT_MS);
            waiters.current.push(waiter);
          });

        /** Asks Privy for the user until it lists the wallet. Refresh errors are retried too. */
        const refreshUntilLinked = async (): Promise<boolean> => {
          for (let attempt = 1; attempt <= USER_REFRESH_ATTEMPTS; attempt++) {
            if (attempt > 1) await sleep(USER_REFRESH_GAP_MS);
            let fresh: User;
            try {
              fresh = await refreshUser();
            } catch (err) {
              console.error(`[StellarSigner] Could not refresh the user (attempt ${attempt}):`, err);
              continue;
            }
            if (hasWallet(fresh, stellarAddress)) return true;
            // Linked, but not as an embedded wallet: Privy will never grant on it, so waiting
            // longer changes nothing.
            const other = fresh.linkedAccounts.find(
              (a) => a.type === 'wallet' && a.address === stellarAddress,
            );
            if (other) {
              console.error(
                '[StellarSigner] Wallet is linked but not as an embedded wallet:',
                other.type === 'wallet' ? other.walletClientType : other.type,
              );
              return false;
            }
          }
          return false;
        };

        if (!hasWallet(userRef.current, stellarAddress)) {
          if (!(await refreshUntilLinked())) {
            console.error('[StellarSigner] Wallet is not on the user yet', stellarAddress.slice(0, 6));
            return false;
          }
          if (!(await waitForRender())) {
            console.error('[StellarSigner] Refreshed user did not reach the page in time');
            return false;
          }
        }

        await addSignersRef.current({
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
    [refreshUser],
  );

  return { grantServerSigner };
}
