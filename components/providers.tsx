'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { base, baseSepolia } from 'viem/chains';
import { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  const isProd = process.env.NEXT_PUBLIC_SIMULATION_MODE === 'false';
  
  return (
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
    </PrivyProvider>
  );
}
