'use client';

import { PageHeader } from '@/components/dashboard/PageHeader';
import { ChainBridgeModule } from '@/components/ChainBridgeModule';
import { PendingBridgeClaims } from '@/components/bridge/PendingBridgeClaims';
import { getCircleAddress } from '@/lib/web3/circle-client';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useStellarWallet } from '@/hooks/useStellarWallet';
import { useEffect, useState } from 'react';
import { PageSkeleton } from '@/components/dashboard/PageSkeleton';



export default function BridgePage() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const [smartAddress, setSmartAddress] = useState<string>('');

  // Embedded Privy Solana wallet
  const privySolAccount = user?.linkedAccounts.find(
    (a) => a.type === 'wallet' && a.walletClientType === 'privy' && a.chainType === 'solana'
  );
  const privySolanaAddress = privySolAccount && 'address' in privySolAccount
    ? (privySolAccount as { address: string }).address
    : undefined;

  useEffect(() => {
    async function initAccount() {
      try {
        const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy');
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

  // Lookup only — Stellar appears once the user has activated it (see hooks/useStellarWallet).
  const { data: stellarWallet } = useStellarWallet();

  if (!ready || !authenticated || !user) {
    return <PageSkeleton variant="form" />;
  }

  return (
    <div className="mx-auto max-w-[1180px] space-y-6 pb-24 md:space-y-8">
      <PageHeader
        eyebrow="Bridge"
        title="Move money"
        italic="between networks."
        subtitle="Your balance can sit on several networks. Move it to the one you need, in a few minutes."
      />

      {/* Burned-but-unclaimed transfers, surfaced above the form so they can't be missed. */}
      <PendingBridgeClaims
        userEmail={user.email?.address || ''}
        solanaAddress={privySolanaAddress}
        stellarWallet={stellarWallet}
      />

      <ChainBridgeModule
        smartAddress={smartAddress}
        userEmail={user.email?.address || ''}
        solanaAddress={privySolanaAddress}
        stellarWallet={stellarWallet}
      />
    </div>
  );
}
