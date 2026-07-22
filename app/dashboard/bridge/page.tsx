'use client';

import { DashboardPageHeader } from '@/components/layout/DashboardPageHeader';
import { SmartBridgeModule } from '@/components/SmartBridgeModule';
import { ChainBridgeModule } from '@/components/ChainBridgeModule';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getCircleAddress } from '@/lib/web3/circle-client';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

interface StellarWalletState {
  walletId: string;
  address: string;
}



export default function SmartBridgePage() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const [smartAddress, setSmartAddress] = useState<string>('');
  const [stellarWallet, setStellarWallet] = useState<StellarWalletState | null>(null);
  const [tab, setTab] = useState<'move' | 'consolidate'>('move');

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

  // Load Stellar wallet from database/provision API
  useEffect(() => {
    async function initStellar() {
      if (user?.id && user?.email?.address) {
        try {
          const res = await fetch('/api/stellar/provision', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ privyUserId: user.id, email: user.email.address }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.address && data.walletId) {
              setTimeout(() => setStellarWallet({
                walletId: data.walletId,
                address: data.address,
              }), 0);
            }
          }
        } catch (err) {
          console.error('[Bridge] Failed to load Stellar wallet:', err);
        }
      }
    }
    initStellar();
  }, [user?.id, user?.email?.address]);

  if (!ready || !authenticated || !user) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Loader2 className="animate-spin w-8 h-8 text-white/10" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="max-w-5xl mx-auto space-y-8">
        <DashboardPageHeader
          title="Bridge"
          subtitle="Move USDC between your networks, or consolidate idle funds to Base."
        />

        {/* Tab switcher */}
        <div className="flex bg-white/5 p-1 rounded-2xl border border-white/5 max-w-md">
          <button
            onClick={() => setTab('move')}
            className={cn(
              'flex-1 py-3 text-[10px] font-bold uppercase tracking-[0.2em] rounded-xl transition-all',
              tab === 'move'
                ? 'bg-accent text-[#07070a] shadow-lg'
                : 'text-white/40 hover:text-white/60',
            )}
          >
            Move Between Networks
          </button>
          <button
            onClick={() => setTab('consolidate')}
            className={cn(
              'flex-1 py-3 text-[10px] font-bold uppercase tracking-[0.2em] rounded-xl transition-all',
              tab === 'consolidate'
                ? 'bg-accent text-[#07070a] shadow-lg'
                : 'text-white/40 hover:text-white/60',
            )}
          >
            Consolidate to Base
          </button>
        </div>

        {tab === 'move' ? (
          <ChainBridgeModule
            smartAddress={smartAddress}
            userEmail={user.email?.address || ''}
            solanaAddress={privySolanaAddress}
            stellarWallet={stellarWallet}
          />
        ) : (
          <SmartBridgeModule
            smartAddress={smartAddress}
            userEmail={user.email?.address || ''}
            solanaAddress={privySolanaAddress}
            stellarWallet={stellarWallet}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
