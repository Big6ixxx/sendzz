'use client';

import { checkOrderById } from '@/lib/actions/ramp';
import { PaycrestOrderStatus } from '@/lib/paycrest/types';
import { ArrowLeft, CheckCircle2, Clock, Copy, Loader2, RefreshCw, XCircle, ChevronRight, Landmark, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

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
  destination?: { type: string; currency: string };
}

const STATUS_CONFIG: Record<PaycrestOrderStatus, { label: string; color: string; icon: React.ReactNode; terminal: boolean }> = {
  initiated:  { label: 'Waiting for transfer', color: 'bg-muted text-muted-foreground', icon: <Clock className="w-5 h-5" />, terminal: false },
  pending:    { label: 'Payment received', color: 'bg-blue-50 text-blue-600', icon: <Loader2 className="w-5 h-5 animate-spin" />, terminal: false },
  deposited:  { label: 'Processing funds', color: 'bg-blue-50 text-blue-600', icon: <Loader2 className="w-5 h-5 animate-spin" />, terminal: false },
  validated:  { label: 'Verifying payment', color: 'bg-blue-50 text-blue-600', icon: <Loader2 className="w-5 h-5 animate-spin" />, terminal: false },
  settling:   { label: 'Sending to wallet', color: 'bg-blue-50 text-blue-600', icon: <Loader2 className="w-5 h-5 animate-spin" />, terminal: false },
  settled:    { label: 'Complete', color: 'bg-green-50 text-green-600', icon: <CheckCircle2 className="w-5 h-5" />, terminal: true },
  refunding:  { label: 'Refunding payment', color: 'bg-orange-50 text-orange-600', icon: <Loader2 className="w-5 h-5 animate-spin" />, terminal: false },
  refunded:   { label: 'Refunded', color: 'bg-orange-50 text-orange-600', icon: <XCircle className="w-5 h-5" />, terminal: true },
  expired:    { label: 'Expired', color: 'bg-red-50 text-red-600', icon: <XCircle className="w-5 h-5" />, terminal: true },
};

export default function TxStatusPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [autoPolling, setAutoPolling] = useState(false);

  const fetchOrder = useCallback(async () => {
    try {
      const data = await checkOrderById(orderId);
      if (!data) {
        setError('Order not found. Please check the ID.');
      } else {
        setOrder(data as OrderData);
        setError('');
      }
    } catch {
      setError('Failed to fetch transaction details.');
    }
    setLastChecked(new Date());
    setLoading(false);
  }, [orderId]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  useEffect(() => {
    if (!order) return;
    const cfg = STATUS_CONFIG[order.status];
    if (cfg?.terminal) {
      setAutoPolling(false);
      return;
    }
    setAutoPolling(true);
    const id = setInterval(fetchOrder, 8000);
    return () => clearInterval(id);
  }, [order?.status, fetchOrder, order]);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  const statusCfg = order ? STATUS_CONFIG[order.status] : null;
  const isDeposit = order?.source?.type === 'fiat';

  return (
    <div className="min-h-screen bg-background py-8 md:py-16 px-4">
      <div className="max-w-xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between pb-6 border-b border-border/50">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="p-2.5 hover:bg-muted rounded-full transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="space-y-0.5">
              <h1 className="text-xl font-black uppercase tracking-tight">Transaction Status</h1>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Order ID: {orderId.slice(0, 8)}...</p>
            </div>
          </div>
          {autoPolling && (
            <div className="flex items-center gap-2 px-3 py-1 bg-muted rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Live</span>
            </div>
          )}
        </div>

        {loading && (
          <div className="card-elegant py-20 flex flex-col items-center justify-center gap-6">
            <Loader2 className="w-10 h-10 animate-spin text-muted-foreground opacity-20" />
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground animate-pulse">Fetching details</p>
          </div>
        )}

        {error && !loading && (
          <div className="card-elegant p-8 border-red-100 bg-red-50/30 text-center space-y-6">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
              <XCircle className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <p className="font-bold uppercase text-red-600 tracking-tight">Something went wrong</p>
              <p className="text-sm text-red-600/70">{error}</p>
            </div>
            <button onClick={fetchOrder} className="btn-primary h-12 px-8 text-xs">
              Try Again
            </button>
          </div>
        )}

        {order && statusCfg && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Main Status Card */}
            <div className="card-elegant p-8 bg-foreground text-background dark:bg-foreground dark:text-background space-y-8 relative overflow-hidden">
              <div className="flex justify-between items-start relative z-10">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-60">
                    {isDeposit ? 'Deposit' : 'Withdrawal'} Amount
                  </p>
                  <h2 className="text-5xl font-black tracking-tighter">
                    {order.amount} <span className="text-sm opacity-40">{order.source?.currency}</span>
                  </h2>
                </div>
                <div className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-background/10 text-background border border-background/20"
                )}>
                  {statusCfg.icon}
                  {statusCfg.label}
                </div>
              </div>

              <div className="pt-8 border-t border-background/10 flex justify-between items-end relative z-10">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-60">Created On</p>
                  <p className="text-xs font-semibold">{new Date(order.createdAt).toLocaleString()}</p>
                </div>
                <div className="text-right space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-60">Current Network</p>
                  <p className="text-xs font-semibold">Base</p>
                </div>
              </div>
            </div>

            {/* Action/Instructions Card */}
            {isDeposit && order.providerAccount?.accountIdentifier && !statusCfg.terminal && (
              <div className="card-elegant p-6 space-y-6 animate-in slide-in-from-top-4 duration-500">
                <div className="flex items-center gap-3 text-sm font-bold uppercase tracking-tight">
                  <Landmark className="w-5 h-5 text-muted-foreground" />
                  Complete Your Deposit
                </div>
                
                <div className="space-y-4">
                  {[
                    { label: 'Transfer Amount', value: `${order.providerAccount.amountToTransfer} ${order.providerAccount.currency}`, highlight: true },
                    { label: 'Bank Name', value: order.providerAccount.institution },
                    { label: 'Account Number', value: order.providerAccount.accountIdentifier, copy: true },
                    { label: 'Account Name', value: order.providerAccount.accountName },
                  ].map((item) => (
                    <div key={item.label} className="flex justify-between items-baseline gap-4 py-2 border-b border-border/30 last:border-0">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest shrink-0">{item.label}</span>
                      {item.copy ? (
                        <button 
                          onClick={() => copy(item.value!, 'Account number')}
                          className="text-sm font-bold hover:text-muted-foreground transition-colors flex items-center gap-2 truncate"
                        >
                          {item.value} <Copy className="w-3.5 h-3.5 opacity-40" />
                        </button>
                      ) : (
                        <span className={cn("text-sm font-bold text-right", item.highlight && "text-lg")}>{item.value}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!isDeposit && order.providerAccount?.receiveAddress && !statusCfg.terminal && (
              <div className="card-elegant p-6 space-y-6">
                <div className="flex items-center gap-3 text-sm font-bold uppercase tracking-tight">
                  <ExternalLink className="w-5 h-5 text-muted-foreground" />
                  Withdrawal Destination
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Send USDC to this address:</p>
                  <button
                    onClick={() => copy(order.providerAccount!.receiveAddress!, 'Address')}
                    className="w-full flex items-center justify-between p-4 bg-muted/50 hover:bg-muted rounded-xl transition-all group border border-border/50"
                  >
                    <code className="text-[10px] font-mono font-bold break-all pr-4 text-left leading-relaxed">
                      {order.providerAccount.receiveAddress}
                    </code>
                    <Copy className="w-4 h-4 shrink-0 opacity-20 group-hover:opacity-100 transition-opacity" />
                  </button>
                </div>
              </div>
            )}

            {/* Utility buttons */}
            <div className="flex gap-4">
              <button
                onClick={fetchOrder}
                disabled={loading}
                className="btn-secondary flex-1 h-14 text-sm gap-2"
              >
                <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                Refresh
              </button>
              <Link href="/dashboard" className="btn-primary flex-1 h-14 text-sm">
                Dashboard
              </Link>
            </div>

            {/* Helper Text */}
            <div className="px-4 text-center">
              <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest leading-relaxed">
                {order.status === 'initiated' && 'Awaiting your manual bank transfer to the details provided above.'}
                {order.status === 'pending' && 'Payment detected. Finalizing transaction on the blockchain.'}
                {order.status === 'settled' && 'Success! Your funds have been successfully settled.'}
                {order.status === 'expired' && 'Order has expired. Please initiate a new one from the dashboard.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
