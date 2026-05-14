'use client';

import { BatchSendDialog } from '@/components/BatchSendDialog';
import { DashboardPageHeader } from '@/components/DashboardPageHeader';
import { TransferModule } from '@/components/TransferModule';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getUSDCBalance } from '@/lib/web3/actions';
import { getCircleAddress } from '@/lib/web3/circle-client';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ShieldCheck, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function TransfersPage() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const [smartAddress, setSmartAddress] = useState<string>('');
  const [batchSendDialogOpen, setBatchSendDialogOpen] = useState(false);

  const { data: balance = '0.00' } = useQuery({
    queryKey: ['balance', smartAddress],
    queryFn: () => getUSDCBalance(smartAddress),
    enabled: !!smartAddress,
  });

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
        console.error('[Transfer] INIT ACCOUNT ERROR:', err);
      }
    }
    if (ready && authenticated && wallets.length > 0) initAccount();
  }, [ready, authenticated, wallets]);

  return (
    <TooltipProvider>
      <div className="max-w-4xl mx-auto space-y-10">
        <DashboardPageHeader
          title="Transfer"
          subtitle="Send money instantly to anyone, anywhere."
        />

        <div className="grid lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7">
            <TransferModule
              smartAddress={smartAddress}
              embeddedProvider={wallets.find(
                (w) => w.walletClientType === 'privy',
              )}
              balance={balance}
              senderEmail={user?.email?.address || ''}
            />
          </div>

          <div className="lg:col-span-5 space-y-6">
            <div className="card-glass p-8 space-y-6">
              <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10">
                <Users className="w-7 h-7 text-accent" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold tracking-tight text-brand-secondary">
                  Batch Payments
                </h3>
                <p className="text-sm text-brand-secondary/50 leading-relaxed">
                  Paying a team or a group? Use our batch engine to send funds
                  to hundreds of emails in seconds.
                </p>
              </div>
              <button
                onClick={() => setBatchSendDialogOpen(true)}
                className="w-full btn-accent h-14 rounded-2xl flex items-center justify-center gap-3 group text-xs font-bold uppercase tracking-widest"
              >
                Launch Batch Engine
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>

            <div className="card-glass p-8 space-y-4">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-accent">
                <ShieldCheck className="w-4 h-4" />
                Gas-Sponsored
              </div>
              <p className="text-xs text-brand-secondary/40 font-medium leading-relaxed">
                All transfers on Sendzz are gas-sponsored. You never need to
                worry about network fees or holding ETH.
              </p>
            </div>
          </div>
        </div>

        <BatchSendDialog
          open={batchSendDialogOpen}
          onOpenChange={setBatchSendDialogOpen}
          maxAmount={parseFloat(balance || '0')}
          smartAddress={smartAddress}
          embeddedProvider={wallets.find((w) => w.walletClientType === 'privy')}
          senderEmail={user?.email?.address || ''}
        />
      </div>
    </TooltipProvider>
  );
}
