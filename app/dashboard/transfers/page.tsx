'use client';

import { BatchSendDialog } from '@/components/BatchSendDialog';
import { TransferModule } from '@/components/TransferModule';
import {
  TooltipProvider
} from '@/components/ui/tooltip';
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
        console.error('[Transfers] INIT ACCOUNT ERROR:', err);
      }
    }
    if (ready && authenticated && wallets.length > 0) initAccount();
  }, [ready, authenticated, wallets]);

  return (
    <TooltipProvider>
      <div className="max-w-4xl mx-auto space-y-10">
        <div className="space-y-2">
          <h1 className="text-3xl font-black uppercase tracking-tight">
            Transfers
          </h1>
          <p className="text-muted-foreground font-medium">
            Send money instantly to anyone, anywhere.
          </p>
        </div>

        <div className="grid md:grid-cols-12 gap-8">
          <div className="md:col-span-7">
            <TransferModule
              smartAddress={smartAddress}
              embeddedProvider={wallets.find(
                (w) => w.walletClientType === 'privy',
              )}
              balance={balance}
              senderEmail={user?.email?.address || ''}
            />
          </div>

          <div className="md:col-span-5 space-y-6">
            <div className="card-elegant p-6 bg-muted/20 border-dashed space-y-4">
              <div className="w-12 h-12 bg-background rounded-2xl flex items-center justify-center shadow-sm">
                <Users className="w-6 h-6 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-black uppercase tracking-tight">
                  Batch Payments
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Paying a team or a group? Use our batch engine to send funds
                  to hundreds of emails in seconds.
                </p>
              </div>
              <button
                onClick={() => setBatchSendDialogOpen(true)}
                className="w-full btn-secondary h-12 rounded-xl flex items-center justify-center gap-2 group"
              >
                Launch Batch Engine
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>

            <div className="card-elegant p-6 space-y-4">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
                Gas-Sponsored
              </div>
              <p className="text-xs text-muted-foreground font-medium leading-relaxed">
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
