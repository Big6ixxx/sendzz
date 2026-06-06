'use client';

import { DashboardPageHeader } from '@/components/layout/DashboardPageHeader';
import { SmartBridgeModule } from '@/components/SmartBridgeModule';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getCircleAddress } from '@/lib/web3/circle-client';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function SmartBridgePage() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const [smartAddress, setSmartAddress] = useState<string>('');

  // Embedded Privy Solana wallet — look up address via linkedAccounts (walletClientType is not exposed on ConnectedStandardSolanaWallet)
  const privySolAccount = user?.linkedAccounts.find(
    (a) => a.type === 'wallet' && a.walletClientType === 'privy' && a.chainType === 'solana'
  );
  const privySolanaAddress = privySolAccount && 'address' in privySolAccount
    ? (privySolAccount as { address: string }).address
    : undefined;

  useEffect(() => {
    async function initAccount() {
      try {
        const embeddedWallet = wallets.find(
          (w) => w.walletClientType === 'privy',
        );
        if (!embeddedWallet) return;
        const provider = await embeddedWallet.getEthereumProvider();
        const address = await getCircleAddress(provider);
        setSmartAddress(address);
      } catch (err) {
        console.error('[Bridge] INIT ACCOUNT ERROR:', err);
      }
    }
    if (ready && authenticated && wallets.length > 0) initAccount();
  }, [ready, authenticated, wallets]);

  if (!ready || !authenticated || !user) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Loader2 className="animate-spin w-8 h-8 text-white/10" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="max-w-3xl mx-auto space-y-10">
        <DashboardPageHeader
          title="Smart Bridge"
          subtitle="Consolidate your funds from other chains to Base instantly."
        />

        <SmartBridgeModule
          smartAddress={smartAddress}
          userEmail={user.email?.address || ''}
          solanaAddress={privySolanaAddress}
        />
      </div>
    </TooltipProvider>
  );
}
