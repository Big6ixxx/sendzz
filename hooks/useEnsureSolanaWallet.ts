'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useCreateWallet, useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';

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

const attempts = new Map<string, { status: Exclude<Status, 'unknown' | 'ready'>; promise: Promise<void> }>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The embedded Solana address on the Privy user, if any. */
export function embeddedSolanaAddress(
  user: ReturnType<typeof usePrivy>['user'],
): string | undefined {
  const account = user?.linkedAccounts.find(
    (a) =>
      a.type === 'wallet' &&
      (a as { walletClientType?: string }).walletClientType === 'privy' &&
      (a as { chainType?: string }).chainType === 'solana',
  );
  return account && 'address' in account ? (account as { address: string }).address : undefined;
}

export function useEnsureSolanaWallet(): {
  address: string | undefined;
  status: Status;
  /** Try again after a failure. */
  retry: () => void;
} {
  const { ready, authenticated, user } = usePrivy();
  const { ready: solanaReady } = useSolanaWallets();
  const { createWallet } = useCreateWallet();

  const address = embeddedSolanaAddress(user);
  const userId = user?.id;
  const attempt = useSyncExternalStore(
    subscribe,
    () => (userId ? attempts.get(userId)?.status : undefined),
    () => undefined,
  );

  const start = useCallback(() => {
    if (!userId) return;
    const existing = attempts.get(userId);
    if (existing && existing.status !== 'failed') return;
    const entry = {
      status: 'creating' as const,
      promise: createWallet()
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
  }, [userId, createWallet]);

  const canKnow = ready && authenticated && solanaReady && !!userId;

  useEffect(() => {
    // Automatically once; a failure waits for an explicit retry rather than looping.
    if (canKnow && !address && !attempts.has(userId!)) start();
  }, [canKnow, address, userId, start]);

  const status: Status = address ? 'ready' : !canKnow ? 'unknown' : (attempt ?? 'creating');
  return { address, status, retry: start };
}
