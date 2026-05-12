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
            theme: 'light',
            accentColor: '#eaff00',
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
          position="top-center"
          toastOptions={{
            className: 'font-sans! font-bold! text-sm! border-2! border-foreground! rounded-xl! shadow-lg!',
          }}
        />
      </PrivyProvider>
    </QueryClientProvider>
  );
}
