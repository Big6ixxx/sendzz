'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { base, baseSepolia } from 'viem/chains';
import { VIEM_CHAINS } from '@/lib/web3/multichain';
import { ReactNode, useState, useEffect } from 'react';
import { BalanceVisibilityProvider } from '@/components/providers/BalanceVisibilityProvider';
import { useSessionActivity } from '@/hooks/useSessionActivity';
/*
 * Imported for its side effect: registering the `beforeinstallprompt` listener at app boot.
 *
 * The event fires once, early, usually on the first page a user lands on. The hook registers
 * its listener at module load — but the module only loaded when the Settings screen imported
 * it, by which time the event had long since fired and been lost. So the Install button had
 * nothing to fire and always fell through to the manual steps, even in Chrome where a real
 * one-tap install was available.
 *
 * Loading it here, in a provider that mounts with the app, is what makes the capture reliable.
 */
import '@/hooks/usePwaInstall';

/**
 * Runs the inactivity logout. Separate component because the hook needs Privy's context, which
 * only exists inside PrivyProvider — calling it in the component that renders the provider would
 * read a context that is not mounted yet.
 */
function SessionActivityWatcher() {
  useSessionActivity();
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    if ('serviceWorker' in navigator && typeof window !== 'undefined') {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((reg) => console.log('[PWA] Service Worker registered with scope:', reg.scope))
          .catch((err) => console.error('[PWA] Service Worker registration failed:', err));
      });
    }
  }, []);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: true,
            retry: 3,
          },
        },
      }),
  );

  const isProd = process.env.NEXT_PUBLIC_SIMULATION_MODE === 'false';

  return (
    <QueryClientProvider client={queryClient}>
      <PrivyProvider
        appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || 'dummy-app-id'}
        config={{
          loginMethods: ['email'],
          appearance: {
            theme: 'dark',
            accentColor: '#00e87a',
            showWalletLoginFirst: false,
          },
          embeddedWallets: {
            ethereum: {
              createOnLogin: 'all-users',
            },
            solana: {
              createOnLogin: 'all-users',
            },
            /*
             * Sendzz owns the confirmation screen; Privy's pop-up never appears.
             *
             * Privy's prompt is accurate and unreadable. It describes a user operation — raw
             * calldata, a gas ceiling, a contract address — to somebody who came here to send
             * $40 to a friend, and it appears once PER SIGNATURE with no warning that another
             * is coming. A bridge takes two of them, minutes apart, and to a Web2 user the
             * second one does not read as "step two". It reads as "the first one failed", or
             * as something trying to charge them twice.
             *
             * In its place, components/security/PinAuthorizationProvider shows one sheet per
             * TRANSACTION: what is about to happen, the amounts, how many confirmations it
             * will take and roughly how long — and takes the PIN. After that the signatures
             * happen silently, tracked by components/signing/SigningProgress.
             *
             * --- What this flag actually covers -------------------------------------
             *
             * Verified against the shipped bundle rather than assumed, because it matters:
             * the EVM send and bridge paths do not call Privy's hooks at all. They go through
             * a raw EIP-1193 `provider.request({method: 'eth_signTypedData_v4'})` from
             * lib/web3/circle-client.ts, since Circle's smart account needs its own signer
             * shape. In @privy-io/react-auth 3.19, that request routes to
             * `handleSignedTypedData`, which calls the same internal signer as the hook and
             * passes no `uiOptions` — so it falls through to exactly this config flag.
             *
             * The consequence to remember when changing this: with the pop-ups off, Privy
             * shows nothing on ANY embedded-wallet action, so any new signing path must bring
             * its own confirmation. Sign silently and the user is never asked at all.
             */
            showWalletUIs: false,
          },
          solana: {
            rpcs: {
              'solana:mainnet': {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                rpc: createSolanaRpc(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com') as any,
                rpcSubscriptions: createSolanaRpcSubscriptions(
                  (process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com')
                    .replace('https', 'wss')
                    .replace('http', 'ws')
                ),
              },
            },
          },
          defaultChain: isProd ? base : baseSepolia,
          // Privy refuses `wallet_switchEthereumChain` for any chain missing from this array,
          // so it is derived rather than listed — a chain the app supports but this omits fails
          // only at the moment someone claims a bridge on it. Testnet is appended because it is
          // deliberately not in the production registry.
          supportedChains: [...Object.values(VIEM_CHAINS), baseSepolia],
        }}
      >
        <BalanceVisibilityProvider>
          <SessionActivityWatcher />
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: 'rgba(10, 10, 11, 0.8)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#f8f8f6',
                borderRadius: '20px',
              },
            }}
          />
        </BalanceVisibilityProvider>
      </PrivyProvider>
    </QueryClientProvider>
  );
}
