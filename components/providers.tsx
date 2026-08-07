'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import {
  arbitrum,
  arbitrumSepolia,
  avalanche,
  avalancheFuji,
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  sepolia,
} from 'viem/chains';
import { ReactNode, useState, useEffect } from 'react';
import { arcTestnet } from '@/lib/web3/arc-chain';
import { VIEM_CHAINS } from '@/lib/web3/multichain';
import { HOME_CHAIN } from '@/lib/explorers';
import { IS_MAINNET } from '@/lib/web3/network';
import type { SupportedChain } from '@/lib/circle/gateway';
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

  const isProd = IS_MAINNET;

  // Privy keys its Solana RPCs by cluster, so the cluster and the endpoint have to move
  // together — leaving the key on `solana:mainnet` while the rest of the app reads devnet
  // USDC points the embedded Solana wallet at a different network than the balances.
  const solanaCluster = isProd ? 'solana:mainnet' : 'solana:devnet';
  const solanaRpcUrl =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    (isProd ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');

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
              [solanaCluster]: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                rpc: createSolanaRpc(solanaRpcUrl) as any,
                rpcSubscriptions: createSolanaRpcSubscriptions(
                  solanaRpcUrl.replace('https', 'wss').replace('http', 'ws'),
                ),
              },
            },
          },
          // Privy can only switch the embedded wallet to a chain listed here, and a CCTP
          // claim switches to whichever chain the mint lands on. Listing only the
          // mainnet set meant every testnet claim failed to switch and then signed
          // against the wrong network, so both families are declared in full.
          defaultChain: VIEM_CHAINS[HOME_CHAIN as SupportedChain],
          supportedChains: isProd
            ? [mainnet, arbitrum, optimism, polygon, avalanche, base]
            : [
                sepolia,
                arbitrumSepolia,
                optimismSepolia,
                polygonAmoy,
                avalancheFuji,
                baseSepolia,
                arcTestnet,
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
