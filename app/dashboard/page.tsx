'use client';

import { BatchSendDialog } from '@/components/BatchSendDialog';
import { DepositWithdrawDialog } from '@/components/deposit-withdraw/DepositWithdrawDialog';
import { HistoryModule } from '@/components/HistoryModule';
import { TransferModule } from '@/components/TransferModule';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { registerUserAddress } from '@/lib/supabase/actions';
import { cn } from '@/lib/utils';
import { getUSDCBalance } from '@/lib/web3/actions';
import { getCircleAddress } from '@/lib/web3/circle-client';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export default function Dashboard() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const router = useRouter();

  const [smartAddress, setSmartAddress] = useState<string>('');
  const [rampModalOpen, setRampModalOpen] = useState(false);
  const [batchSendDialogOpen, setBatchSendDialogOpen] = useState(false);
  const [rampType, setRampType] = useState<'deposit' | 'withdraw'>('deposit');

  const {
    data: balance = '0.00',
    isLoading: isBalanceLoading,
    refetch: refetchBalance,
  } = useQuery({
    queryKey: ['balance', smartAddress],
    queryFn: () => getUSDCBalance(smartAddress),
    enabled: !!smartAddress,
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (ready && !authenticated) router.push('/');
  }, [ready, authenticated, router]);

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
        if (user?.email?.address) {
          registerUserAddress(user.email.address, address).catch(console.error);
        }
      } catch (err) {
        console.error('[Dashboard] INIT ACCOUNT FATAL ERROR:', err);
      }
    }
    if (ready && authenticated && wallets.length > 0) initAccount();
  }, [ready, authenticated, wallets, user]);

  if (!ready || !authenticated) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Loader2 className="animate-spin w-8 h-8 text-muted-foreground/50" />
      </div>
    );
  }

  const openRamp = (type: 'deposit' | 'withdraw') => {
    setRampType(type);
    setRampModalOpen(true);
  };

  return (
    <TooltipProvider>
      <div className="max-w-5xl mx-auto space-y-12">
        {/* Modern integrated Header Section */}
        <section className="space-y-8 md:space-y-10">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8 pb-10 border-b border-border/50">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.25em]">
                  Global Portfolio
                </p>
                <div className="px-2 py-0.5 bg-muted rounded text-[10px] font-bold uppercase tracking-widest text-muted-foreground border border-border/50">
                  Base
                </div>
              </div>
              <div className="flex items-baseline flex-wrap gap-x-4 gap-y-2">
                <h2 className="text-5xl md:text-7xl font-black tracking-tighter leading-none">
                  ${balance}
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold opacity-20 uppercase tracking-tighter">
                    USDC
                  </span>
                  <button
                    onClick={() => refetchBalance()}
                    disabled={isBalanceLoading || !smartAddress}
                    className="p-2 hover:bg-muted rounded-full transition-all disabled:opacity-50"
                  >
                    <RefreshCw
                      className={cn(
                        'w-5 h-5 text-muted-foreground/40',
                        isBalanceLoading && 'animate-spin',
                      )}
                    />
                  </button>
                </div>
              </div>

              {/* Account mini-details */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-2">
                <div
                  className="flex items-center gap-2 group cursor-pointer"
                  onClick={() => (
                    navigator.clipboard.writeText(smartAddress),
                    toast.success('Address copied')
                  )}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] font-mono font-bold text-muted-foreground group-hover:text-foreground transition-colors">
                    {smartAddress
                      ? `${smartAddress.slice(0, 6)}...${smartAddress.slice(-4)}`
                      : 'Generating...'}
                  </span>
                  <Copy className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground/40" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                    Non-Custodial
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => openRamp('deposit')}
                className="btn-primary flex-1 sm:flex-none h-14 md:h-16 px-6 md:px-10 gap-3 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.08)] hover:shadow-[0_20px_50px_rgba(0,0,0,0.15)] hover:scale-105 transition-all"
              >
                <ArrowDown className="w-4 h-4 md:w-5 md:h-5" />
                <span className="uppercase tracking-tight text-sm md:text-base">Deposit</span>
              </button>
              <button
                onClick={() => openRamp('withdraw')}
                className="btn-secondary flex-1 sm:flex-none h-14 md:h-16 px-6 md:px-10 gap-3 rounded-2xl border-border/50 hover:bg-background hover:border-foreground transition-all"
              >
                <ArrowUp className="w-4 h-4 md:w-5 md:h-5" />
                <span className="uppercase tracking-tight text-sm md:text-base">Withdraw</span>
              </button>
            </div>
          </div>
        </section>

        {/* Main Grid: Clean & Segmented */}
        <div className="grid lg:grid-cols-12 gap-12 items-start">
          <div className="lg:col-span-7 space-y-10">
            <div className="space-y-4">
              <div className="flex items-center gap-2 px-1">
                <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
                  Quick Transfer
                </h3>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="w-3 h-3 opacity-30 hover:opacity-100" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Send funds instantly to any email address on the network.
                  </TooltipContent>
                </Tooltip>
              </div>
              <TransferModule
                smartAddress={smartAddress}
                embeddedProvider={wallets.find(
                  (w) => w.walletClientType === 'privy',
                )}
                balance={balance}
                senderEmail={user?.email?.address || ''}
              />
            </div>

            <div className="card-elegant bg-foreground text-background p-8 rounded-3xl space-y-6 group overflow-hidden relative">
              <Users className="absolute -right-4 -top-4 w-32 h-32 opacity-5 -rotate-12 transition-transform group-hover:scale-110 group-hover:rotate-0 duration-700" />
              <div className="space-y-2 relative z-10">
                <h3 className="text-2xl font-black uppercase tracking-tight">
                  Batch Operations
                </h3>
                <p className="text-sm opacity-60 font-medium leading-relaxed max-w-sm">
                  Distribute payments to your entire network simultaneously.
                  Perfect for payroll or global payouts.
                </p>
              </div>
              <button
                onClick={() => setBatchSendDialogOpen(true)}
                className="btn-secondary w-full h-14 rounded-xl bg-background text-foreground border-none relative z-10 hover:bg-muted transition-colors"
              >
                <span className="uppercase tracking-widest font-black text-xs text-foreground">
                  Launch Batch Engine
                </span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-5 space-y-4">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Recent Activity
              </h3>
              <button
                onClick={() => router.push('/dashboard/history')}
                className="text-[10px] font-bold uppercase tracking-widest hover:underline text-muted-foreground/60"
              >
                View All
              </button>
            </div>
            <div className="card-elegant p-1 rounded-3xl border-border/40">
              <HistoryModule
                userId={user?.id || ''}
                userEmail={user?.email?.address || ''}
              />
            </div>
          </div>
        </div>

        <DepositWithdrawDialog
          isOpen={rampModalOpen}
          onClose={() => setRampModalOpen(false)}
          type={rampType}
          userId={user?.id || ''}
          userAddress={smartAddress}
          balance={balance}
          userEmail={user?.email?.address || ''}
          embeddedProvider={wallets.find((w) => w.walletClientType === 'privy')}
        />

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
