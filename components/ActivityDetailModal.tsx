'use client';

import { format } from 'date-fns';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  Clock,
  ExternalLink,
  History,
  Landmark,
  MessageSquare,
  Network,
  Receipt,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallets } from '@privy-io/react-auth';
import { executeReceiveMessage } from '@/lib/web3/bridge-actions';
import { toast } from 'sonner';
import { CCTP_DOMAINS, type SupportedChain } from '@/lib/circle/gateway';

import { Activity } from './HistoryModule';
import { ReceiptActions } from './receipt/ReceiptActions';
import { activityToReceiptData } from '@/lib/receipt/utils';
import { getOffRampRate } from '@/lib/actions/ramp';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { CHAIN_META } from '@/components/deposit-withdraw/deposit-shared';

const ACTIVITY_LABELS: Record<string, string> = {
  sent: 'Transfer Sent',
  received: 'Funds Received',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  bridge: 'Bridge Transfer',
};

const EXPLORER_BASE_URL = 'https://basescan.org/tx/';

const chainLabel = (chain: string) =>
  (CHAIN_META[chain.toLowerCase()]?.name ?? chain).toUpperCase();

const explorerFor = (chain: string | undefined, hash: string) =>
  (chain ? CHAIN_META[chain.toLowerCase()] : null)?.explorerTx(hash) ??
  `${EXPLORER_BASE_URL}${hash}`;

interface ActivityDetailModalProps {
  activity: Activity | null;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Compact activity summary shown from the dashboard's Recent Activity. Surfaces the key
 * facts + a receipt, with a "View full details" action that opens the full transaction
 * page (/dashboard/activity/[id]) for the complete breakdown.
 */
export function ActivityDetailModal({
  activity,
  isOpen,
  onClose,
}: ActivityDetailModalProps) {
  const router = useRouter();
  const [prevActivityId, setPrevActivityId] = useState<string | null>(null);
  const [estimatedFiatRate, setEstimatedFiatRate] = useState<number | null>(null);

  const { wallets } = useWallets();
  const [isClaiming, setIsClaiming] = useState(false);

  const handleClaim = async () => {
    if (!activity?.txHash) return;
    setIsClaiming(true);
    try {
      const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy');
      if (!embeddedWallet) {
        toast.error('Embedded wallet not found. Please log in.');
        setIsClaiming(false);
        return;
      }

      const sourceChain = activity.sourceChain?.toLowerCase();
      const destChain = activity.destChain?.toLowerCase() as SupportedChain;

      let domain: number | null = null;
      if (sourceChain === 'solana') domain = 5;
      else if (sourceChain === 'stellar') domain = 27;
      else if (sourceChain && sourceChain in CCTP_DOMAINS) {
        domain = CCTP_DOMAINS[sourceChain as keyof typeof CCTP_DOMAINS];
      }

      if (domain === null) {
        toast.error('Invalid bridge source chain.');
        setIsClaiming(false);
        return;
      }

      toast.info('Fetching CCTP attestation from Circle...');
      const res = await fetch(
        `https://iris-api.circle.com/v2/messages/${domain}?transactionHash=${activity.txHash}`
      );
      if (!res.ok) {
        throw new Error(`Circle API error: ${res.statusText}`);
      }
      const data = await res.json();
      const message = data.messages?.[0];
      if (!message || message.status !== 'complete') {
        toast.error('Circle attestation is still pending. Try again in 1-2 minutes.');
        setIsClaiming(false);
        return;
      }

      let mintTxHash = message.forwardTxHash || message.mintTxHash || null;

      const isEvmDest = destChain && destChain in CCTP_DOMAINS;
      if (isEvmDest) {
        if (!mintTxHash) {
          toast.info(`Requesting signature to claim USDC on ${activity.destChain || 'destination'}...`);
          mintTxHash = await executeReceiveMessage(
            embeddedWallet,
            message.message,
            message.attestation,
            destChain
          );
        }
      } else {
        if (!mintTxHash) {
          toast.info("Circle's automatic relayer is currently minting your funds on the destination chain. Please wait 1–2 minutes.");
          setIsClaiming(false);
          return;
        }
      }

      toast.success('USDC claimed successfully!');

      await fetch('/api/bridge/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ burnTxHash: activity.txHash, mintTxHash }),
      });

      window.location.reload();
    } catch (err: unknown) {
      console.error('[Manual Claim] Error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg || 'Failed to claim USDC.');
    } finally {
      setIsClaiming(false);
    }
  };

  // Adjust state during render if activity changes to prevent cascading renders in useEffect
  const currentActivityId = activity?.id || null;
  if (currentActivityId !== prevActivityId) {
    setPrevActivityId(currentActivityId);
    setEstimatedFiatRate(null);
  }

  const activityId = activity?.id;
  const activityType = activity?.type;
  const activityFiatAmount = activity?.fiatAmount;
  const activityFiatCurrency = activity?.fiatCurrency;

  // For old withdrawal records that predate fiat_amount being saved, fetch the
  // current off-ramp rate so the receipt can show an approximate fiat payout.
  useEffect(() => {
    if (!activityId || activityType !== 'withdrawal' || activityFiatAmount != null) {
      return;
    }
    let active = true;
    const currency = activityFiatCurrency || 'NGN';
    getOffRampRate(currency)
      .then((rate) => {
        if (active) setEstimatedFiatRate(rate);
      })
      .catch(() => {
        if (active) setEstimatedFiatRate(null);
      });
    return () => {
      active = false;
    };
  }, [activityId, activityType, activityFiatAmount, activityFiatCurrency]);

  if (!activity) return null;

  const isSuccess =
    activity.status.toLowerCase() === 'settled' ||
    activity.status.toLowerCase() === 'completed' ||
    activity.status.toLowerCase() === 'confirmed' ||
    activity.status.toLowerCase() === 'success' ||
    activity.status.toLowerCase() === 'complete';

  // Network / route line.
  const networkValue =
    activity.type === 'bridge' && activity.sourceChain
      ? `${chainLabel(activity.sourceChain)} → ${chainLabel(activity.destChain ?? 'base')}`
      : activity.type === 'withdrawal' && activity.consolidated
        ? `YOUR NETWORKS → ${chainLabel(activity.sourceChain ?? 'base')}`
        : activity.sourceChain
          ? chainLabel(activity.sourceChain)
          : null;

  const viewFullDetails = () => {
    onClose();
    router.push(`/dashboard/activity/${activity.id}`);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm p-0 overflow-hidden">
        <DialogTitle className="sr-only">
          {activity ? ACTIVITY_LABELS[activity.type] : 'Activity Detail'}
        </DialogTitle>

        <div className="p-8 text-center space-y-8">
          <div className="flex justify-center">
            <div
              className="w-20 h-20 rounded-4xl flex items-center justify-center shadow-2xl relative group"
              style={{
                background: isSuccess
                  ? 'rgba(0, 232, 122, 0.1)'
                  : activity.type === 'sent'
                    ? 'rgba(248, 113, 113, 0.1)'
                    : activity.type === 'received'
                      ? 'rgba(0, 232, 122, 0.1)'
                      : activity.type === 'deposit'
                        ? 'rgba(59, 130, 246, 0.1)'
                        : activity.type === 'bridge'
                          ? 'rgba(96, 165, 250, 0.1)'
                          : 'rgba(251, 146, 60, 0.1)',
                color: isSuccess
                  ? '#00e87a'
                  : activity.type === 'sent'
                    ? '#f87171'
                    : activity.type === 'received'
                      ? '#00e87a'
                      : activity.type === 'deposit'
                        ? '#3b82f6'
                        : activity.type === 'bridge'
                          ? '#60a5fa'
                          : '#fb923c',
                border: `1px solid ${
                  isSuccess
                    ? 'rgba(0, 232, 122, 0.2)'
                    : activity.type === 'sent'
                      ? 'rgba(248, 113, 113, 0.2)'
                      : activity.type === 'received'
                        ? 'rgba(0, 232, 122, 0.2)'
                        : activity.type === 'deposit'
                          ? 'rgba(59, 130, 246, 0.2)'
                          : activity.type === 'bridge'
                            ? 'rgba(96, 165, 250, 0.2)'
                            : 'rgba(251, 146, 60, 0.2)'
                }`,
              }}
            >
              <div className="absolute inset-0 rounded-4xl blur-xl opacity-20 bg-current group-hover:opacity-40 transition-opacity" />
              {activity.type === 'sent' && <ArrowUpRight className="w-10 h-10 relative z-10" />}
              {activity.type === 'received' && <ArrowDownLeft className="w-10 h-10 relative z-10" />}
              {activity.type === 'deposit' && <Wallet className="w-10 h-10 relative z-10" />}
              {activity.type === 'withdrawal' && <Landmark className="w-10 h-10 relative z-10" />}
              {activity.type === 'bridge' && <RefreshCw className="w-10 h-10 relative z-10" />}
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30">
              {ACTIVITY_LABELS[activity.type]}
            </p>
            <h3 className="font-display text-4xl font-bold tracking-tighter text-brand-secondary">
              {activity.amount.toLocaleString()}{' '}
              <span className="text-lg opacity-30 font-bold uppercase">{activity.asset}</span>
            </h3>
            <div className="flex justify-center mt-3">
              <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-white/4 border border-white/8 text-brand-secondary/60">
                {activity.status}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 text-left">
            <div className="p-4 rounded-2xl bg-white/2 border border-white/4">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center gap-2 text-brand-secondary/20">
                <Clock className="w-3 h-3" /> Timestamp
              </p>
              <p className="text-xs font-semibold uppercase truncate text-brand-secondary">
                {format(new Date(activity.timestamp), 'MMMM dd, yyyy @ HH:mm')}
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-white/2 border border-white/4">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center gap-2 text-brand-secondary/20">
                <History className="w-3 h-3" /> Details
              </p>
              <p className="text-xs font-semibold uppercase truncate text-brand-secondary">
                {activity.details}
              </p>
            </div>

            {networkValue && (
              <div className="p-4 rounded-2xl bg-white/2 border border-white/4">
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center gap-2 text-brand-secondary/20">
                  <Network className="w-3 h-3" /> {activity.type === 'bridge' || (activity.type === 'withdrawal' && activity.consolidated) ? 'Route' : 'Network'}
                </p>
                <p className="text-xs font-semibold uppercase truncate text-brand-secondary">
                  {networkValue}
                </p>
              </div>
            )}

            {activity.note && (
              <div className="p-4 rounded-2xl bg-accent/5 border border-accent/10">
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center gap-2 text-accent">
                  <MessageSquare className="w-3 h-3" /> Memo
                </p>
                <p className="text-sm font-medium leading-relaxed text-brand-secondary/80">
                  {activity.note}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/20 text-center flex items-center justify-center gap-2">
              <Receipt className="w-3 h-3" /> Receipt
            </p>
            <ReceiptActions
              data={(() => {
                const base = activityToReceiptData(activity);
                if (
                  activity.type === 'withdrawal' &&
                  base.fiatPayoutAmount == null &&
                  estimatedFiatRate
                ) {
                  return {
                    ...base,
                    fiatPayoutAmount: Math.round(activity.amount * estimatedFiatRate),
                    exchangeRate: estimatedFiatRate,
                  };
                }
                return base;
              })()}
            />
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex gap-3">
              {activity.type === 'bridge' ? (
                <>
                  {activity.txHash && (
                    <a
                      href={explorerFor(activity.sourceChain, activity.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-[10px] uppercase tracking-widest transition-all bg-white/6 text-brand-secondary border border-white/10 hover:bg-white/10 outline-none focus:ring-2 focus:ring-accent/50"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Burn Tx
                    </a>
                  )}

                  {activity.mintTxHash ? (
                    <a
                      href={explorerFor(activity.destChain ?? 'base', activity.mintTxHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-[10px] uppercase tracking-widest transition-all bg-white/6 text-brand-secondary border border-white/10 hover:bg-white/10 outline-none focus:ring-2 focus:ring-accent/50"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Mint Tx
                    </a>
                  ) : (
                    <button
                      onClick={handleClaim}
                      disabled={isClaiming}
                      className="flex-1 h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-[10px] uppercase tracking-widest transition-all bg-accent text-background border border-accent hover:opacity-90 outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50"
                    >
                      {isClaiming ? 'Claiming...' : 'Claim USDC'}
                    </button>
                  )}
                </>
              ) : (
                activity.txHash && (
                  <a
                    href={explorerFor(activity.sourceChain, activity.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-[10px] uppercase tracking-widest transition-all bg-white/6 text-brand-secondary border border-white/10 hover:bg-white/10 outline-none focus:ring-2 focus:ring-accent/50"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Explorer
                  </a>
                )
              )}
            </div>

            <button
              onClick={viewFullDetails}
              className="btn-accent w-full h-12 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 outline-none focus:ring-2 focus:ring-accent/50"
            >
              View Full Details <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              className="w-full h-12 rounded-xl text-[10px] font-bold uppercase tracking-widest bg-white/5 border border-white/8 text-brand-secondary/60 hover:bg-white/10 transition-all outline-none focus:ring-2 focus:ring-accent/50"
            >
              Close
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
