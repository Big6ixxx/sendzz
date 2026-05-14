'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { base, baseSepolia } from 'viem/chains';
import { ReactNode, useState } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: true,
        retry: 3,
      },
    },
  }));
  
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
              createOnLogin: 'users-without-wallets',
            },
          },
          defaultChain: isProd ? base : baseSepolia,
          supportedChains: [base, baseSepolia],
        }}
      >
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
      </PrivyProvider>
    </QueryClientProvider>
  );
}
