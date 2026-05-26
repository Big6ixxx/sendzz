'use client';

import { ActivityDetailModal } from '@/components/ActivityDetailModal';
import { BatchSendDialog } from '@/components/batch-send/BatchSendDialog';
import { BridgeNudge } from '@/components/BridgeNudge';
import { DepositWithdrawDialog } from '@/components/deposit-withdraw/DepositWithdrawDialog';
import { Activity, HistoryModule } from '@/components/HistoryModule';
import { TransferModule } from '@/components/TransferModule';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { registerUserAddress } from '@/lib/supabase/users';
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
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(
    null,
  );

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

  if (!ready || !authenticated || !user) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Loader2
          className="animate-spin w-8 h-8"
          style={{ color: 'rgba(248,248,246,0.2)' }}
        />
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
        {/* Balance Header */}
        <section>
          <div className="card-glass p-8 md:p-10 rounded-3xl">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8">
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <p
                    className="text-[10px] font-bold uppercase tracking-[0.25em]"
                    style={{ color: 'rgba(248,248,246,0.35)' }}
                  >
                    Global Portfolio
                  </p>
                  <div
                    className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest"
                    style={{
                      background: 'rgba(0, 232, 122, 0.1)',
                      color: '#00e87a',
                      border: '1px solid rgba(0,232,122,0.2)',
                    }}
                  >
                    Base
                  </div>
                </div>
                <div className="flex items-baseline flex-wrap gap-x-4 gap-y-2">
                  <h2
                    className="font-display text-5xl md:text-7xl font-bold tracking-tighter leading-none"
                    style={{ color: '#f8f8f6' }}
                  >
                    ${balance}
                  </h2>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xl font-bold uppercase tracking-tighter"
                      style={{ color: 'rgba(248,248,246,0.2)' }}
                    >
                      USDC
                    </span>
                    <button
                      onClick={() => refetchBalance()}
                      disabled={isBalanceLoading || !smartAddress}
                      className="p-2 rounded-full transition-all disabled:opacity-50"
                      style={{ color: 'rgba(248,248,246,0.3)' }}
                    >
                      <RefreshCw
                        className={cn(
                          'w-5 h-5',
                          isBalanceLoading && 'animate-spin',
                        )}
                      />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-2">
                  <div
                    className="flex items-center gap-2 group cursor-pointer"
                    onClick={() => (
                      navigator.clipboard.writeText(smartAddress),
                      toast.success('Address copied')
                    )}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full animate-beacon"
                      style={{ background: '#00e87a' }}
                    />
                    <span
                      className="text-[10px] font-mono font-bold transition-colors"
                      style={{ color: 'rgba(248,248,246,0.4)' }}
                    >
                      {smartAddress
                        ? `${smartAddress.slice(0, 6)}...${smartAddress.slice(-4)}`
                        : 'Loading...'}
                    </span>
                    <Copy
                      className="w-3 h-3"
                      style={{ color: 'rgba(248,248,246,0.2)' }}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck
                      className="w-3.5 h-3.5"
                      style={{ color: 'rgba(248,248,246,0.25)' }}
                    />
                    <span
                      className="text-[10px] font-bold uppercase tracking-widest"
                      style={{ color: 'rgba(248,248,246,0.3)' }}
                    >
                      Non-Custodial
                    </span>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="w-3 h-3 opacity-30 hover:opacity-100 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[280px] text-xs leading-relaxed p-4">
                        <p className="font-bold mb-1 text-accent">Secure MPC Architecture</p>
                        We use Privy's MPC technology to ensure your funds are truly yours. Your keys are split into shares, meaning no single party—including Sendzz—ever has access to your full private key. This provides self-custody with the ease of a traditional login.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => openRamp('deposit')}
                  className="btn-accent flex-1 sm:flex-none h-14 md:h-16 px-6 md:px-10 gap-3 rounded-2xl text-sm md:text-base transition-all"
                >
                  <ArrowDown className="w-4 h-4 md:w-5 md:h-5" />
                  <span className="uppercase tracking-tight font-bold">
                    Deposit
                  </span>
                </button>
                <button
                  onClick={() => openRamp('withdraw')}
                  className="flex-1 sm:flex-none h-14 md:h-16 px-6 md:px-10 gap-3 rounded-2xl flex items-center justify-center text-sm md:text-base font-semibold transition-all"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'rgba(248,248,246,0.7)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                  }}
                >
                  <ArrowUp className="w-4 h-4 md:w-5 md:h-5" />
                  <span className="uppercase tracking-tight">Withdraw</span>
                </button>
              </div>
            </div>
          </div>

          <BridgeNudge smartAddress={smartAddress} />
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

            <div
              className="card-glass p-8 rounded-3xl space-y-6 group overflow-hidden relative"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <Users
                className="absolute -right-4 -top-4 w-32 h-32 opacity-5 -rotate-12 transition-transform group-hover:scale-110 group-hover:rotate-0 duration-700"
                style={{ color: '#00e87a' }}
              />
              <div className="space-y-2 relative z-10">
                <h3
                  className="text-2xl font-display font-bold tracking-tight"
                  style={{ color: '#f8f8f6' }}
                >
                  Batch Payroll
                </h3>
                <p
                  className="text-sm font-medium leading-relaxed max-w-sm"
                  style={{ color: 'rgba(248,248,246,0.4)' }}
                >
                  Distribute payments to your entire network simultaneously.
                  Perfect for payroll or global payouts.
                </p>
              </div>
              <button
                onClick={() => setBatchSendDialogOpen(true)}
                className="w-full h-12 rounded-xl flex items-center justify-center gap-2 relative z-10 font-bold text-xs uppercase tracking-widest transition-all"
                style={{
                  background: 'rgba(0,232,122,0.1)',
                  color: '#00e87a',
                  border: '1px solid rgba(0,232,122,0.2)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(0,232,122,0.18)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(0,232,122,0.1)';
                }}
              >
                Launch Batch Engine
              </button>
            </div>
          </div>

          <div className="lg:col-span-5 space-y-4 min-w-0 w-full max-w-full">
            <div className="flex items-center justify-between px-1">
              <h3
                className="text-xs font-bold uppercase tracking-[0.2em]"
                style={{ color: 'rgba(248,248,246,0.35)' }}
              >
                Recent Activity
              </h3>
              <button
                onClick={() => router.push('/dashboard/history')}
                className="text-[10px] font-bold uppercase tracking-widest transition-colors"
                style={{ color: 'rgba(0,232,122,0.7)' }}
              >
                View All
              </button>
            </div>
            <div className="card-glass p-1 rounded-3xl overflow-hidden relative w-full">
              <div className="w-full">
                <HistoryModule
                  userId={user.id}
                  userEmail={user.email?.address || ''}
                  limit={5}
                  hideHeader={true}
                  onTxClick={setSelectedActivity}
                />
              </div>
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

        <ActivityDetailModal
          isOpen={!!selectedActivity}
          activity={selectedActivity}
          onClose={() => setSelectedActivity(null)}
        />
      </div>
    </TooltipProvider>
  );
}
