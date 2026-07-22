'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import {
  arbitrum,
  avalanche,
  base,
  baseSepolia,
  mainnet,
  optimism,
  polygon,
} from 'viem/chains';
import { ReactNode, useState, useEffect } from 'react';
import { BalanceVisibilityProvider } from '@/components/providers/BalanceVisibilityProvider';

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
          supportedChains: [
            mainnet,
            arbitrum,
            optimism,
            polygon,
            avalanche,
            base,
            baseSepolia,
          ],
        }}
      >
        <BalanceVisibilityProvider>
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
