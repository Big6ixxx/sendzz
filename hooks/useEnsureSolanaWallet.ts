'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { usePrivy, useUser } from '@privy-io/react-auth';
import { useCreateWallet, useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { privySolanaAddress } from '@/lib/solana/privy-address';

/**
 * Make sure the signed-in user has an embedded Solana wallet, creating one if not.
 *
 * `createOnLogin: 'all-users'` (components/providers) only acts at LOGIN. Anyone who signed in
 * before Solana was added to that config — or whose session simply persisted across it — never
 * logs in again, so never got one. Nothing else created it: the receive screen said "still being
 * set up" forever, and any Solana USDC they held had no signer, so it could not be spent.
 *
 * Waits for Privy AND its Solana wallet list to be ready, because "no Solana account" is not
 * knowable before then and `createWallet` errors if one already exists. Creation is shared by
 * every caller through a module-level map keyed by user, so the dashboard and the receive
 * screen mounting together still make exactly one request.
 */

type Status = 'unknown' | 'ready' | 'creating' | 'failed';

/**
 * How long to let Privy's own create-on-login finish before deciding the user has no wallet.
 * Creating in the gap before the page sees that wallet is how users got a second one.
 */
const CREATE_ON_LOGIN_GRACE_MS = 4_000;

/** Tries at re-reading the user before a wallet creation is given up as failed. */
const REFRESH_ATTEMPTS = 3;

const attempts = new Map<string, { status: Exclude<Status, 'unknown' | 'ready'>; promise: Promise<void> }>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useEnsureSolanaWallet(): {
  address: string | undefined;
  status: Status;
  /** Try again after a failure. */
  retry: () => void;
} {
  const { ready, authenticated, user } = usePrivy();
  const { ready: solanaReady } = useSolanaWallets();
  const { createWallet } = useCreateWallet();
  const { refreshUser } = useUser();

  // Not knowing is not "none": a wallet created without a fresh answer risks a second one, so
  // a failed refresh is tried again before the attempt is given up as failed.
  const refreshUserPatiently = useCallback(async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await refreshUser();
      } catch (err) {
        if (attempt >= REFRESH_ATTEMPTS) throw err;
        await new Promise((r) => setTimeout(r, 2_000 * attempt));
      }
    }
  }, [refreshUser]);

  const address = privySolanaAddress(user);
  const userId = user?.id;
  const attempt = useSyncExternalStore(
    subscribe,
    () => (userId ? attempts.get(userId)?.status : undefined),
    () => undefined,
  );

  /** `grace`: only the automatic first attempt waits for Privy's create-on-login. */
  const start = useCallback((grace = false) => {
    if (!userId) return;
    const existing = attempts.get(userId);
    if (existing && existing.status !== 'failed') return;
    const entry = {
      status: 'creating' as const,
      promise: (async () => {
        if (grace) await new Promise((r) => setTimeout(r, CREATE_ON_LOGIN_GRACE_MS));
        if (privySolanaAddress(await refreshUserPatiently())) return; // Privy's got there first
        await createWallet();
      })()
        .then(() => {
          // Privy updates `user.linkedAccounts` itself; the address appears from there. The
          // entry is kept, so the gap before it does cannot start a second (failing) create.
        })
        .catch((err: unknown) => {
          console.error('[Solana wallet] creation failed:', err);
          attempts.set(userId, { status: 'failed', promise: Promise.resolve() });
          notify();
        }),
    };
    attempts.set(userId, entry);
    notify();
  }, [userId, createWallet, refreshUserPatiently]);

  const canKnow = ready && authenticated && solanaReady && !!userId;

  useEffect(() => {
    // Automatically once; a failure waits for an explicit retry rather than looping.
    if (canKnow && !address && !attempts.has(userId!)) start(true);
  }, [canKnow, address, userId, start]);

  const status: Status = address ? 'ready' : !canKnow ? 'unknown' : (attempt ?? 'creating');
  return { address, status, retry: () => start() };
}
