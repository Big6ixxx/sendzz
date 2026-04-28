'use client';

import { checkOrderById } from '@/lib/actions/ramp';
import { PaycrestOrderStatus } from '@/lib/paycrest/types';
import { ArrowLeft, CheckCircle2, Clock, Copy, Loader2, RefreshCw, XCircle } from 'lucide-react';
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
  destination?: { type: string; currency: string };
}

const STATUS_CONFIG: Record<PaycrestOrderStatus, { label: string; color: string; icon: React.ReactNode; terminal: boolean }> = {
  initiated:  { label: 'Initiated',  color: 'border-gray-400 bg-gray-50 text-gray-700',   icon: <Clock className="w-6 h-6" />,   terminal: false },
  pending:    { label: 'Pending',    color: 'border-yellow-400 bg-yellow-50 text-yellow-700', icon: <Loader2 className="w-6 h-6 animate-spin" />, terminal: false },
  deposited:  { label: 'Deposited',  color: 'border-blue-400 bg-blue-50 text-blue-700',   icon: <Loader2 className="w-6 h-6 animate-spin" />, terminal: false },
  validated:  { label: 'Validated',  color: 'border-blue-500 bg-blue-50 text-blue-800',   icon: <Loader2 className="w-6 h-6 animate-spin" />, terminal: false },
  settling:   { label: 'Settling',   color: 'border-purple-400 bg-purple-50 text-purple-700', icon: <Loader2 className="w-6 h-6 animate-spin" />, terminal: false },
  settled:    { label: 'Settled ✓',  color: 'border-green-500 bg-green-50 text-green-700', icon: <CheckCircle2 className="w-6 h-6" />, terminal: true },
  refunding:  { label: 'Refunding',  color: 'border-orange-400 bg-orange-50 text-orange-700', icon: <Loader2 className="w-6 h-6 animate-spin" />, terminal: false },
  refunded:   { label: 'Refunded',   color: 'border-orange-500 bg-orange-50 text-orange-700', icon: <XCircle className="w-6 h-6" />, terminal: true },
  expired:    { label: 'Expired',    color: 'border-red-400 bg-red-50 text-red-700',      icon: <XCircle className="w-6 h-6" />, terminal: true },
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
        setError('Order not found. Check the ID and try again.');
      } else {
        setOrder(data as OrderData);
        setError('');
      }
    } catch {
      setError('Failed to fetch order. Please try again.');
    }
    setLastChecked(new Date());
    setLoading(false);
  }, [orderId]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  // Auto-poll every 8s if order is not terminal
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
  const isOnramp = order?.source?.type === 'fiat';

  return (
    <div className="min-h-screen p-4 lg:p-8 font-mono">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8 border-b-4 border-black pb-4">
          <Link href="/dashboard" className="hover:bg-neon p-2 border-2 border-black transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="font-oswald text-2xl font-black uppercase">Transaction Status</h1>
            <p className="text-[10px] uppercase opacity-60">Sendzz // Paycrest Order</p>
          </div>
        </div>

        {loading && (
          <div className="brutal-card p-8 flex flex-col items-center gap-4">
            <Loader2 className="w-10 h-10 animate-spin" />
            <p className="font-black uppercase text-sm">Fetching order...</p>
          </div>
        )}

        {error && !loading && (
          <div className="border-4 border-red-500 bg-red-50 p-6 text-red-700">
            <p className="font-black uppercase text-sm mb-2">!! Error</p>
            <p className="text-sm">{error}</p>
            <button onClick={fetchOrder} className="brutal-btn mt-4 text-sm">
              Retry
            </button>
          </div>
        )}

        {order && statusCfg && (
          <div className="flex flex-col gap-4">
            {/* Status Card */}
            <div className={`border-4 p-6 ${statusCfg.color}`}>
              <div className="flex items-center gap-3 mb-2">
                {statusCfg.icon}
                <span className="font-black uppercase text-xl">{statusCfg.label}</span>
                {autoPolling && (
                  <span className="ml-auto text-[10px] opacity-60 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
                    Live
                  </span>
                )}
              </div>
              {lastChecked && (
                <p className="text-[10px] opacity-60">
                  Last checked: {lastChecked.toLocaleTimeString()}
                </p>
              )}
            </div>

            {/* Order Details */}
            <div className="border-4 border-black bg-white p-5 flex flex-col gap-3 text-sm text-black">
              <p className="font-black uppercase text-xs border-b-2 border-black pb-2">Order Details</p>

              <div className="flex justify-between items-center">
                <span className="opacity-60 uppercase text-[10px]">Order ID</span>
                <button
                  onClick={() => copy(order.id, 'Order ID')}
                  className="flex items-center gap-1 font-black text-xs hover:text-blue-600"
                >
                  {order.id.slice(0, 8)}...{order.id.slice(-6)}
                  <Copy className="w-3 h-3" />
                </button>
              </div>

              <div className="flex justify-between">
                <span className="opacity-60 uppercase text-[10px]">Amount</span>
                <span className="font-black">{order.amount} {order.source?.currency}</span>
              </div>

              <div className="flex justify-between">
                <span className="opacity-60 uppercase text-[10px]">Type</span>
                <span className="font-black uppercase">{isOnramp ? 'On-Ramp (NGN → USDC)' : 'Off-Ramp (USDC → NGN)'}</span>
              </div>

              {order.createdAt && (
                <div className="flex justify-between">
                  <span className="opacity-60 uppercase text-[10px]">Created</span>
                  <span className="font-black text-xs">{new Date(order.createdAt).toLocaleString()}</span>
                </div>
              )}
            </div>

            {/* Onramp: show bank transfer details if still pending */}
            {isOnramp && order.providerAccount?.accountIdentifier && !statusCfg.terminal && (
              <div className="border-4 border-black bg-neon/10 p-5 flex flex-col gap-3 text-sm text-black">
                <p className="font-black uppercase text-xs border-b-2 border-black pb-2">
                  Complete Your Transfer
                </p>
                <div className="flex justify-between items-center">
                  <span className="opacity-60 uppercase text-[10px]">Amount to Send</span>
                  <span className="font-black text-lg">{order.providerAccount.amountToTransfer} {order.providerAccount.currency}</span>
                </div>
                <div
                  className="flex justify-between items-center cursor-pointer hover:bg-neon/20 p-2 -mx-2"
                  onClick={() => copy(order.providerAccount!.accountIdentifier!, 'Account number')}
                >
                  <span className="opacity-60 uppercase text-[10px]">Account</span>
                  <span className="font-black flex items-center gap-1">
                    {order.providerAccount.accountIdentifier}
                    <Copy className="w-3 h-3" />
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-60 uppercase text-[10px]">Bank</span>
                  <span className="font-black">{order.providerAccount.institution}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-60 uppercase text-[10px]">Account Name</span>
                  <span className="font-black text-xs text-right">{order.providerAccount.accountName}</span>
                </div>
                {order.providerAccount.validUntil && (
                  <div className="flex justify-between">
                    <span className="opacity-60 uppercase text-[10px]">Expires</span>
                    <span className="font-black text-xs text-red-600">
                      {new Date(order.providerAccount.validUntil).toLocaleTimeString()}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Offramp: show receive address if pending */}
            {!isOnramp && order.providerAccount?.receiveAddress && !statusCfg.terminal && (
              <div className="border-4 border-black bg-neon/10 p-5 flex flex-col gap-3 text-sm text-black">
                <p className="font-black uppercase text-xs border-b-2 border-black pb-2">
                  Send USDC To
                </p>
                <div
                  className="flex items-center gap-2 bg-white border-2 border-black p-3 cursor-pointer hover:bg-neon/20"
                  onClick={() => copy(order.providerAccount!.receiveAddress!, 'Address')}
                >
                  <code className="text-[10px] break-all font-bold flex-1">{order.providerAccount.receiveAddress}</code>
                  <Copy className="w-4 h-4 shrink-0" />
                </div>
                <p className="text-[10px] opacity-60">Network: BASE</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={fetchOrder}
                disabled={loading}
                className="brutal-btn flex-1 flex items-center justify-center gap-2 text-sm"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <Link href="/dashboard" className="brutal-btn flex-1 text-center text-sm bg-black! text-white!">
                Dashboard
              </Link>
            </div>

            {/* Status explanation */}
            <div className="border-2 border-black/20 p-4 text-[10px] opacity-60 uppercase leading-relaxed">
              {order.status === 'initiated' && 'Order created. Waiting for your bank transfer.'}
              {order.status === 'pending' && 'Transfer received. Verifying on-chain...'}
              {order.status === 'deposited' && 'Deposit detected. Processing conversion...'}
              {order.status === 'validated' && 'Validated. Settling to your wallet...'}
              {order.status === 'settling' && 'Sending USDC to your smart account...'}
              {order.status === 'settled' && 'Complete. USDC has been sent to your wallet.'}
              {order.status === 'refunding' && 'Something went wrong. Initiating refund...'}
              {order.status === 'refunded' && 'Refunded. Your NGN has been returned to your bank.'}
              {order.status === 'expired' && 'Order expired without a transfer. Start a new one.'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
