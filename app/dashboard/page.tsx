'use client';

import { BatchSendDialog } from '@/components/BatchSendDialog';
import { HistoryModule } from '@/components/HistoryModule';
import { RampModal } from '@/components/RampModal';
import { TransferModule } from '@/components/TransferModule';
import { registerUserAddress } from '@/lib/supabase/actions';
import { getUSDCBalance } from '@/lib/web3/actions';
import { getCircleAddress } from '@/lib/web3/circle-client';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useQuery } from '@tanstack/react-query';
import { Copy, Loader2, LogOut, RefreshCw, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export default function Dashboard() {
  const { ready, authenticated, user, logout } = usePrivy();
  const { wallets } = useWallets();
  const router = useRouter();

  const [smartAddress, setSmartAddress] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [rampModalOpen, setRampModalOpen] = useState(false);
  const [batchSendDialogOpen, setBatchSendDialogOpen] = useState(false);
  const [rampType, setRampType] = useState<'onramp' | 'offramp'>('onramp');

  // Use Query for balance with auto-refreshing
  const {
    data: balance = '0.00',
    isLoading: isBalanceLoading,
    refetch: refetchBalance,
  } = useQuery({
    queryKey: ['balance', smartAddress],
    queryFn: () => getUSDCBalance(smartAddress),
    enabled: !!smartAddress,
    refetchInterval: 10000, // Auto-refresh every 10 seconds
  });

  useEffect(() => {
    if (ready && !authenticated) {
      router.push('/');
    }
  }, [ready, authenticated, router]);

  useEffect(() => {
    async function initAccount() {
      try {
        const embeddedWallet = wallets.find(
          (w) => w.walletClientType === 'privy',
        );
        if (!embeddedWallet) return;

        const provider = await embeddedWallet.getEthereumProvider();
        const address = await getCircleAddress(
          provider as unknown as Parameters<typeof getCircleAddress>[0]
        );

        setSmartAddress(address);

        if (user?.email?.address) {
          registerUserAddress(user.email.address, address).catch(console.error);
        }
      } catch (err) {
        console.error('[Dashboard] INIT ACCOUNT FATAL ERROR:', err);
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to generate smart account',
        );
      }
    }

    if (ready && authenticated && wallets.length > 0) initAccount();
  }, [ready, authenticated, wallets, user]);

  if (!ready || !authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center font-mono uppercase font-bold text-2xl">
        <Loader2 className="animate-spin w-8 h-8 mr-4" /> Initializing Network
        Sync...
      </div>
    );
  }

  const openRamp = (type: 'onramp' | 'offramp') => {
    setRampType(type);
    setRampModalOpen(true);
  };

  return (
    <div className="flex flex-col min-h-[85vh]">
      <header className="flex justify-between items-center border-b-4 border-black dark:border-white pb-6 mb-8 flex-wrap gap-4">
        <h1 className="text-3xl font-oswald font-black uppercase tracking-tighter">
          Sendzz // TERMINAL
        </h1>
        <div className="flex gap-4 items-center">
          <div className="brutal-card px-4 py-2 flex items-center gap-2 font-mono text-sm font-bold bg-neon text-black border-2 border-black">
            <span>AGENT: {user?.email?.address || 'ANONYMOUS'}</span>
          </div>
          <button
            onClick={logout}
            className="brutal-card px-4 py-2 bg-black text-white hover:bg-neon hover:text-black transition-colors"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 flex flex-col gap-8">
          <div className="brutal-card p-6 bg-black text-white dark:bg-white dark:text-black relative">
            <button
              onClick={() => refetchBalance()}
              disabled={isBalanceLoading || !smartAddress}
              className="absolute top-4 right-4 text-neon hover:rotate-180 transition-transform disabled:opacity-50"
            >
              <RefreshCw
                className={`w-5 h-5 ${isBalanceLoading ? 'animate-spin' : ''}`}
              />
            </button>

            <h2 className="font-oswald text-2xl uppercase mb-6 border-b-2 border-white dark:border-black pb-2">
              Active Capital
            </h2>
            <div className="font-oswald font-black text-6xl break-all">
              ${balance}
            </div>
            <p className="font-mono text-xs mt-2 text-gray-400 dark:text-gray-600">
              USDC BALANCE ALIGNED ON BASE
            </p>

            <div className="mt-8">
              <p className="font-mono text-xs mb-2 uppercase font-bold text-neon dark:text-black">
                Smart Account Address
              </p>
              <button
                type="button"
                onClick={() => {
                  if (smartAddress && !error) {
                    navigator.clipboard.writeText(smartAddress);
                    toast.success('Address copied to clipboard');
                  }
                }}
                className={`flex justify-between items-center p-3 bg-white text-black dark:bg-black dark:text-white font-mono text-xs wrap-break-word border-2 cursor-copy hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black transition-colors w-full text-left ${error ? 'border-red-600 bg-red-100' : 'border-neon'}`}
              >
                <span>
                  {error
                    ? `ERROR: ${error}`
                    : smartAddress || 'GENERATING_SC_ADDRESS...'}
                </span>
                {smartAddress && !error && (
                  <Copy className="w-4 h-4 ml-2 shrink-0" />
                )}
              </button>
            </div>
          </div>

          <div className="brutal-card p-6">
            <h2 className="font-oswald text-2xl uppercase mb-4 font-black">
              Batch Operations
            </h2>
            <button
              onClick={() => setBatchSendDialogOpen(true)}
              className="brutal-btn w-full bg-neon! text-black! hover:bg-black! hover:text-neon! border-2 border-black text-sm md:text-base flex items-center justify-center gap-3"
            >
              <Users className="w-5 h-5" />
              DISPATCH BATCH SEND
            </button>
          </div>

          <div className="brutal-card p-6">
            <h2 className="font-oswald text-2xl uppercase mb-4 font-black">
              Fiat Gateways
            </h2>
            <button
              onClick={() => openRamp('offramp')}
              className="brutal-btn w-full mb-4 bg-white! text-black! hover:bg-black! hover:text-neon! border-2 border-black text-sm md:text-base"
            >
              OFF-RAMP (Convert USDC to NGN)
            </button>
            <button
              onClick={() => openRamp('onramp')}
              className="brutal-btn w-full bg-white! text-black! hover:bg-black! hover:text-neon! border-2 border-black text-sm md:text-base"
            >
              ON-RAMP (Convert NGN to USDC)
            </button>
          </div>
        </div>

        <div className="lg:col-span-2 flex flex-col gap-8">
          <TransferModule
            smartAddress={smartAddress}
            embeddedProvider={wallets.find(
              (w) => w.walletClientType === 'privy',
            )}
            balance={balance}
            senderEmail={user?.email?.address || ''}
          />

          <HistoryModule
            userId={user?.id || ''}
            userEmail={user?.email?.address || ''}
          />
        </div>
      </main>

      {rampModalOpen && <RampModal
        isOpen={rampModalOpen}
        onClose={() => setRampModalOpen(false)}
        type={rampType}
        userId={user?.id || ''}
        userAddress={smartAddress}
        balance={balance}
        userEmail={user?.email?.address || ''}
      />}

      {batchSendDialogOpen && <BatchSendDialog
        open={batchSendDialogOpen}
        onOpenChange={setBatchSendDialogOpen}
        maxAmount={parseFloat(balance || '0')}
        smartAddress={smartAddress}
        embeddedProvider={wallets.find((w) => w.walletClientType === 'privy')}
        senderEmail={user?.email?.address || ''}
      />}
    </div>
  );
}
