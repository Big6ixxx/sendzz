'use client';

import { checkOrderById } from '@/lib/actions/ramp';
import { PaycrestOrderStatus } from '@/lib/paycrest/types';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Info,
  Landmark,
  Loader2,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

interface OrderData {
  id: string;
  status: PaycrestOrderStatus;
  amount: string;
  createdAt: string;
  providerAccount?: {
    institution?: string;
    accountIdentifier?: string;
    accountName?: string;
    amountToTransfer?: string;
    currency?: string;
    receiveAddress?: string;
    validUntil?: string;
  };
  source?: { type: string; currency: string };
  destination?: {
    type: string;
    currency: string;
    recipient?: { memo?: string };
  };
}

const STATUS_MAP: Record<
  PaycrestOrderStatus,
  {
    label: string;
    sub: string;
    icon: React.ElementType;
    color: string;
    progress: number;
  }
> = {
  initiated: {
    label: 'Awaiting Bank Transfer',
    sub: 'Please send the exact amount to the bank details below.',
    icon: Clock,
    color: '#3b82f6',
    progress: 20,
  },
  pending: {
    label: 'Payment Detected',
    sub: 'We have spotted your payment. Verifying on-chain...',
    icon: Loader2,
    color: '#00e87a',
    progress: 40,
  },
  deposited: {
    label: 'Deposit Confirmed',
    sub: 'Funds are being processed for final settlement.',
    icon: Loader2,
    color: '#00e87a',
    progress: 60,
  },
  validated: {
    label: 'Order Validated',
    sub: 'Security checks passed. Preparing your wallet transfer.',
    icon: Loader2,
    color: '#00e87a',
    progress: 75,
  },
  settling: {
    label: 'Settling Funds',
    sub: 'Finalizing the transfer to your Base Mainnet address.',
    icon: Loader2,
    color: '#00e87a',
    progress: 90,
  },
  settled: {
    label: 'Successfully Settled',
    sub: 'Transaction complete. Your funds are now in your wallet.',
    icon: CheckCircle2,
    color: '#00e87a',
    progress: 100,
  },
  refunding: {
    label: 'Refunding Payment',
    sub: 'We encountered an issue and are returning your funds.',
    icon: Loader2,
    color: '#f87171',
    progress: 50,
  },
  refunded: {
    label: 'Payment Refunded',
    sub: 'Funds have been successfully returned to your bank.',
    icon: XCircle,
    color: '#f87171',
    progress: 0,
  },
  expired: {
    label: 'Transaction Expired',
    sub: 'The payment window timed out. Please initiate a new order.',
    icon: XCircle,
    color: 'rgba(248,248,246,0.3)',
    progress: 0,
  },
};

export default function TxStatusPage({
  params,
}: {
  params: Promise<{ orderId: string }> | { orderId: string };
}) {
  // Safe param unwrapping for Next.js 15/16 client components
  const isPromise =
    params &&
    typeof (params as Promise<{ orderId: string }>).then === 'function';
  const unwrappedParams = isPromise
    ? use(params as Promise<{ orderId: string }>)
    : (params as { orderId: string });
  const orderId = unwrappedParams?.orderId;

  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!orderId) return;
    try {
      const data = await checkOrderById(orderId);
      if (data) {
        setOrder(data as OrderData);
        setError('');
      } else {
        setError('Order resolution failed. Record not found.');
      }
    } catch {
      setError('Network synchronization error.');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Polling logic
  useEffect(() => {
    if (
      !order ||
      order.status === 'settled' ||
      order.status === 'expired' ||
      order.status === 'refunded'
    )
      return;
    const interval = setInterval(refreshStatus, 8000);
    return () => clearInterval(interval);
  }, [order, refreshStatus]);

  const copyToClipboard = (text: string, title: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast.success(`${title} copied`);
  };

  if (!mounted) return null;
  if (!orderId)
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#07070a] text-white">
        <p className="opacity-40 animate-pulse uppercase tracking-[0.3em] font-bold text-[10px]">
          Invalid Reference
        </p>
      </div>
    );

  const status = order ? STATUS_MAP[order.status] : null;

  return (
    <div
      className="min-h-screen relative selection:bg-accent/30"
      style={{ background: '#07070a' }}
    >
      {/* Background Ambience */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-5%] w-[60%] h-[60%] rounded-full bg-accent opacity-[0.05] blur-[160px]" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[50%] h-[50%] rounded-full bg-[#3b82f6] opacity-[0.04] blur-[140px]" />
      </div>

      <main className="max-w-2xl mx-auto px-6 py-12 md:py-24 relative z-10 space-y-12">
        {/* Header */}
        <header className="flex items-center justify-between pb-8 border-b border-white/6">
          <div className="flex items-center gap-6">
            <Link
              href="/dashboard"
              className="w-12 h-12 rounded-2xl flex items-center justify-center transition-all hover:bg-white/5 border border-white/8"
              style={{ color: 'rgba(248,248,246,0.6)' }}
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="space-y-1">
              <h1 className="font-display text-2xl font-bold tracking-tight text-brand-secondary">
                Order Status
              </h1>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                <code className="text-[10px] font-bold uppercase tracking-widest opacity-30">
                  REF: {orderId}
                </code>
              </div>
            </div>
          </div>
          <button
            onClick={refreshStatus}
            disabled={loading}
            className="p-3 rounded-xl transition-all hover:bg-white/5 text-accent"
          >
            <RefreshCw className={cn('w-5 h-5', loading && 'animate-spin')} />
          </button>
        </header>

        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="py-24 flex flex-col items-center gap-8"
            >
              <div className="relative">
                <Loader2
                  className="w-16 h-16 animate-spin opacity-20"
                  style={{ color: '#00e87a' }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-8 h-8 rounded-full bg-accent/10 animate-pulse" />
                </div>
              </div>
              <p className="text-xs font-bold uppercase tracking-[0.3em] opacity-30">
                Syncing with Paycrest...
              </p>
            </motion.div>
          ) : error ? (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="card-glass p-12 text-center space-y-8 border-red-500/20"
            >
              <div className="w-20 h-20 rounded-3xl bg-red-500/10 flex items-center justify-center mx-auto text-red-500 border border-red-500/20">
                <XCircle className="w-10 h-10" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-brand-secondary">
                  Data Resolution Failed
                </h2>
                <p className="text-sm opacity-40 max-w-xs mx-auto">{error}</p>
              </div>
              <button
                onClick={refreshStatus}
                className="btn-accent h-14 px-8 text-xs font-bold"
              >
                Attempt Re-Sync
              </button>
            </motion.div>
          ) : (
            order &&
            status && (
              <motion.div
                key="content"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-12"
              >
                {/* Primary Status Card */}
                <div className="text-center space-y-6">
                  <div
                    className="w-28 h-28 rounded-[2.5rem] flex items-center justify-center mx-auto relative group shadow-2xl"
                    style={{
                      background: `rgba(${status.color === '#00e87a' ? '0,232,122' : '59,130,246'}, 0.08)`,
                      border: `1px solid ${status.color}33`,
                      color: status.color,
                    }}
                  >
                    <div className="absolute inset-0 rounded-[2.5rem] blur-3xl opacity-20 bg-current" />
                    <status.icon
                      className={cn(
                        'w-12 h-12 relative z-10',
                        status.progress < 100 &&
                          status.progress > 0 &&
                          'animate-pulse',
                      )}
                    />
                  </div>

                  <div className="space-y-2">
                    <h2 className="font-display text-4xl font-bold tracking-tight text-brand-secondary">
                      {status.label}
                    </h2>
                    <p className="text-sm opacity-50 max-w-md mx-auto">
                      {status.sub}
                    </p>
                  </div>

                  {/* Progress Bar */}
                  {status.progress > 0 && (
                    <div className="max-w-xs mx-auto pt-4 space-y-4">
                      <div className="h-1.5 w-full bg-white/3 rounded-full overflow-hidden border border-white/5">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${status.progress}%` }}
                          transition={{ duration: 1.5, ease: 'circOut' }}
                          className="h-full bg-linear-to-r from-accent to-[#3b82f6] shadow-[0_0_12px_rgba(0,232,122,0.4)]"
                        />
                      </div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-20">
                        Network Finalization: {status.progress}%
                      </p>
                    </div>
                  )}
                </div>

                {/* Financial Summary */}
                <div className="card-glass p-10 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-accent opacity-[0.03] blur-3xl rounded-full" />

                  <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-10">
                    <div className="space-y-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.3em] opacity-30">
                        Settlement Value
                      </p>
                      <div className="flex items-baseline gap-4">
                        <span className="font-display text-6xl md:text-7xl font-bold tracking-tighter text-brand-secondary">
                          {order.amount}
                        </span>
                        <span className="text-2xl font-bold opacity-20 text-brand-secondary">
                          {order.source?.currency}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col md:items-end gap-4">
                      <div className="px-4 py-2 rounded-xl bg-accent/10 border border-accent/20 flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-accent" />
                        <span className="text-[11px] font-bold uppercase tracking-widest text-accent">
                          Base Mainnet
                        </span>
                      </div>
                      <p className="text-[10px] font-bold opacity-30 uppercase tracking-widest">
                        Ledger Updated:{' '}
                        {new Date(order.createdAt).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>

                  <div className="mt-10 pt-10 border-t border-white/6 grid grid-cols-2 md:grid-cols-3 gap-8">
                    <div className="space-y-1.5">
                      <p className="text-[9px] font-bold uppercase tracking-widest opacity-30">
                        Order Type
                      </p>
                      <p className="text-xs font-bold text-brand-secondary uppercase tracking-tight">
                        {order.source?.type === 'fiat'
                          ? 'Fiat Deposit'
                          : 'Crypto Payout'}
                      </p>
                    </div>
                    <div className="space-y-1.5 text-right md:text-left">
                      <p className="text-[9px] font-bold uppercase tracking-widest opacity-30">
                        Status Phase
                      </p>
                      <p
                        className="text-xs font-bold uppercase tracking-tight"
                        style={{ color: status.color }}
                      >
                        {order.status}
                      </p>
                    </div>
                    {order.destination?.recipient?.memo && (
                      <div className="col-span-2 md:col-span-1 space-y-1.5">
                        <p className="text-[9px] font-bold uppercase tracking-widest opacity-30 flex items-center gap-2">
                          <MessageSquare className="w-3 h-3" /> Note
                        </p>
                        <p className="text-xs font-bold text-brand-secondary italic truncate">
                          &quot;{order.destination.recipient.memo}&quot;
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Action Panels */}
                {order.source?.type === 'fiat' &&
                  order.providerAccount?.accountIdentifier &&
                  order.status === 'initiated' && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="card-glass p-8 space-y-8 bg-white/2 border-accent/20 shadow-[0_32px_80px_rgba(0,0,0,0.6)]"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center border border-accent/20">
                          <Landmark className="w-7 h-7 text-accent" />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-brand-secondary">
                            Deposit Instructions
                          </h3>
                          <p className="text-xs opacity-40">
                            Complete the transfer from your bank app
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[
                          {
                            label: 'Transfer Amount',
                            value: `${order.providerAccount.amountToTransfer} ${order.providerAccount.currency}`,
                            accent: true,
                          },
                          {
                            label: 'Institution',
                            value: order.providerAccount.institution,
                          },
                          {
                            label: 'Account Identity',
                            value: order.providerAccount.accountName,
                          },
                          {
                            label: 'Account Number',
                            value: order.providerAccount.accountIdentifier,
                            copy: true,
                          },
                        ].map((item) => (
                          <div
                            key={item.label}
                            className="p-4 rounded-2xl bg-black/40 border border-white/4 space-y-1"
                          >
                            <p className="text-[9px] font-bold uppercase tracking-[0.2em] opacity-20">
                              {item.label}
                            </p>
                            {item.copy ? (
                              <button
                                onClick={() =>
                                  copyToClipboard(item.value!, 'Account number')
                                }
                                className="w-full flex items-center justify-between group text-left"
                              >
                                <span className="text-sm font-bold font-mono text-brand-secondary">
                                  {item.value}
                                </span>
                                <Copy className="w-4 h-4 opacity-10 group-hover:opacity-100 transition-opacity text-accent" />
                              </button>
                            ) : (
                              <p
                                className={cn(
                                  'text-sm font-bold truncate',
                                  item.accent
                                    ? 'text-accent text-lg'
                                    : 'text-brand-secondary',
                                )}
                              >
                                {item.value}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="flex items-start gap-4 p-5 rounded-2xl bg-accent/5 border border-accent/10">
                        <Info className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                        <p className="text-[11px] leading-relaxed text-accent opacity-80 font-medium">
                          Funds will be credited automatically once the transfer
                          is verified. Please ensure the amount matches exactly
                          to avoid delays.
                        </p>
                      </div>
                    </motion.div>
                  )}

                {/* Utility Footer */}
                <footer className="flex flex-col sm:flex-row gap-4 pt-8">
                  <button
                    onClick={() => window.location.reload()}
                    className="flex-1 h-16 rounded-2xl bg-white/4 border border-white/8 text-brand-secondary font-bold text-[10px] uppercase tracking-[0.3em] transition-all hover:bg-white/8 flex items-center justify-center gap-3"
                  >
                    <RefreshCw className="w-4 h-4" /> Hard Refresh
                  </button>
                  <Link
                    href="/dashboard"
                    className="flex-1 h-16 rounded-2xl bg-accent text-[#07070a] font-bold text-[10px] uppercase tracking-[0.3em] flex items-center justify-center gap-3 transition-all hover:brightness-110 shadow-[0_20px_40px_rgba(0,232,122,0.2)]"
                  >
                    Return to Portal <ChevronRight className="w-4 h-4" />
                  </Link>
                </footer>
              </motion.div>
            )
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
