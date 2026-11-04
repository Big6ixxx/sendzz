'use client';

import { checkOrderById } from '@/lib/actions/ramp';
import { RampOrderStatus } from '@/lib/ramp';
import { cn } from '@/lib/utils';
import { ArrowLeft, Copy, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { publicOrderId } from '@/lib/ramp/public-order-id';
import { DetailRows, Notice, FlowLabel } from '@/components/flow/ui';
import { BareBrandPage, statusAction } from '@/components/landing/StatusScreen';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';

interface OrderData {
  id: string;
  status: RampOrderStatus;
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

type Tone = 'moving' | 'done' | 'problem' | 'closed';

const STATUS_MAP: Record<RampOrderStatus, { label: string; italic: string; sub: string; tone: Tone; progress: number }> = {
  initiated: { label: 'Waiting for', italic: 'your transfer.', sub: 'Send the exact amount to the account below from your bank app.', tone: 'moving', progress: 20 },
  pending: { label: 'Payment', italic: 'spotted.', sub: 'We can see your payment and are confirming it now.', tone: 'moving', progress: 40 },
  deposited: { label: 'Deposit', italic: 'confirmed.', sub: 'Your money has arrived. We are converting it now.', tone: 'moving', progress: 60 },
  validated: { label: 'Checks', italic: 'passed.', sub: 'Everything checks out. Getting it ready to send.', tone: 'moving', progress: 75 },
  settling: { label: 'Almost', italic: 'there.', sub: 'Sending it to its destination.', tone: 'moving', progress: 90 },
  settled: { label: 'All', italic: 'done.', sub: 'This order is complete and the money has arrived.', tone: 'done', progress: 100 },
  refunding: { label: 'Sending it', italic: 'back.', sub: 'Something went wrong, so we are returning your money.', tone: 'problem', progress: 50 },
  refunded: { label: 'Money', italic: 'returned.', sub: 'Your money has been sent back to where it came from.', tone: 'problem', progress: 0 },
  expired: { label: 'This order', italic: 'expired.', sub: 'The payment window closed before any money arrived. Start a new order to try again.', tone: 'closed', progress: 0 },
  failed: { label: 'This order', italic: 'failed.', sub: 'It could not be completed. Start a new one, or message us on Telegram.', tone: 'problem', progress: 0 },
};

const TONE_DOT: Record<Tone, string> = {
  moving: 'lp-fixed bg-[var(--lp-green)] lp-pulse',
  done: 'lp-fixed bg-[var(--lp-green)]',
  problem: 'bg-[#f0a58f]',
  closed: 'bg-[#9fb8aa]',
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
        setError('We couldn\u2019t find this order. Check the link and try again.');
      }
    } catch {
      setError('We couldn\u2019t reach Sendzz. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // A check the person asked for: shown on the button, and never two at once.
  const [refreshing, setRefreshing] = useState(false);
  const checkNow = async () => {
    if (refreshing) return;
    setRefreshing(true);
    await refreshStatus();
    setRefreshing(false);
  };

  // Keep checking until the order can no longer change.
  useEffect(() => {
    if (!order || (['settled', 'expired', 'refunded', 'failed'] as RampOrderStatus[]).includes(order.status)) return;
    const interval = setInterval(refreshStatus, 8000);
    return () => clearInterval(interval);
  }, [order, refreshStatus]);

  const copyToClipboard = (text: string, title: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast.success(`${title} copied`);
  };

  if (!mounted) return null;

  const status = order ? STATUS_MAP[order.status] : null;

  return (
    <BareBrandPage>
      <div className="mx-auto w-full max-w-[640px] space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-[15px] font-medium text-[var(--lp-body)] transition-colors hover:text-[var(--lp-ink)]"
          >
            <ArrowLeft className="size-4" /> My account
          </Link>
          {orderId && (
            <button
              type="button"
              onClick={checkNow}
              disabled={loading || refreshing}
              aria-label={refreshing ? 'Checking the status' : 'Check the status again'}
              className="lp-card grid size-10 place-items-center rounded-full transition-[scale] duration-150 active:scale-[0.94] disabled:active:scale-100"
            >
              <RefreshCw className={cn('size-4', (loading || refreshing) && 'animate-spin')} />
            </button>
          )}
        </div>

        <header>
          <p className="lp-mono text-[13px] uppercase">Order</p>
          {orderId && <p className="lp-mono mt-2 break-all text-[13px] text-[var(--lp-muted)]">Ref {publicOrderId(orderId)}</p>}
        </header>

        {!orderId ? (
          <Notice tone="danger" title="This link has no order in it.">
            Open the order from your account history instead.
          </Notice>
        ) : loading && !order ? (
          <SkeletonGroup label="Checking the order" className="space-y-6">
            <div className="lp-fixed space-y-5 rounded-[28px] bg-[var(--lp-forest)] p-7 sm:p-8">
              <Skeleton tone="forest" className="h-3 w-20" />
              <Skeleton tone="forest" className="h-12 w-2/3 rounded-[16px]" />
              <Skeleton tone="forest" className="h-3.5 w-1/2" />
              <Skeleton tone="forest" className="h-1.5 w-full" />
            </div>
            <div className="lp-card space-y-5 rounded-[28px] p-6 sm:p-7">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-12 w-40 rounded-[16px]" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-3/4" />
            </div>
          </SkeletonGroup>
        ) : error && !order ? (
          <Notice
            tone="danger"
            title={error}
            action={
              <button type="button" onClick={checkNow} className="text-[14px] font-semibold underline underline-offset-2">
                Try again
              </button>
            }
          />
        ) : (
          order &&
          status && (
            <>
              {/* Where it is now, on forest like the summary panel in the send and withdraw flows. */}
              <section aria-live="polite" className="lp-fixed rounded-[28px] bg-[var(--lp-forest)] p-7 text-[var(--lp-cream)] sm:p-8">
                <p className="lp-mono flex items-center gap-2 text-[12px] uppercase text-[var(--lp-green)]">
                  <span className={cn('size-2 rounded-full', TONE_DOT[status.tone])} aria-hidden /> Status
                </p>
                <h1 className="lp-display mt-5 text-[clamp(40px,9vw,60px)] leading-[0.95] tracking-[-0.05em]">
                  {status.label} <span className="lp-serif tracking-[-0.02em]">{status.italic}</span>
                </h1>
                <p className="mt-4 max-w-[460px] text-[16px] leading-[1.55] text-[#cfe0d6]">{status.sub}</p>
                {status.progress > 0 && (
                  <div
                    className="mt-7 h-1.5 overflow-hidden rounded-full bg-[rgba(246,242,233,0.15)]"
                    role="progressbar"
                    aria-label="Order progress"
                    aria-valuenow={status.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className={cn('h-full rounded-full transition-[width] duration-700', status.tone === 'problem' ? 'bg-[#f0a58f]' : 'lp-fixed bg-[var(--lp-green)]')}
                      style={{ width: `${status.progress}%` }}
                    />
                  </div>
                )}
              </section>

              <section aria-label="Order details" className="lp-card rounded-[28px] p-6 sm:p-7">
                <FlowLabel>Amount</FlowLabel>
                <p className="lp-display mt-3 break-words text-[clamp(40px,10vw,56px)] leading-none tracking-[-0.05em] tabular-nums">
                  {order.amount}
                  {order.source?.currency && (
                    <span className="lp-mono ml-2 align-middle text-[14px] tracking-normal text-[var(--lp-muted)]">{order.source.currency}</span>
                  )}
                </p>
                <DetailRows
                  className="mt-6 border-b-0"
                  rows={[
                    { label: 'Type', value: order.source?.type === 'fiat' ? 'Bank deposit' : 'Payout' },
                    {
                      label: 'Started',
                      value: (
                        <span className="lp-mono text-[14px]">
                          {new Date(order.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                        </span>
                      ),
                    },
                    !!order.destination?.recipient?.memo && {
                      label: 'Note',
                      value: (
                        <span className="lp-serif block truncate text-[18px] font-normal">&ldquo;{order.destination.recipient.memo}&rdquo;</span>
                      ),
                    },
                  ]}
                />
              </section>

              {order.source?.type === 'fiat' && order.providerAccount?.accountIdentifier && order.status === 'initiated' && (
                <section aria-label="Where to send it" className="lp-card rounded-[28px] p-6 sm:p-7">
                  <FlowLabel>Send exactly</FlowLabel>
                  <p className="lp-display mt-3 break-words text-[clamp(32px,8vw,44px)] leading-none tracking-[-0.04em] tabular-nums">
                    {order.providerAccount.amountToTransfer}
                    <span className="lp-mono ml-2 align-middle text-[14px] tracking-normal text-[var(--lp-muted)]">
                      {order.providerAccount.currency}
                    </span>
                  </p>
                  <DetailRows
                    className="mt-6 border-b-0"
                    rows={[
                      !!order.providerAccount.institution && { label: 'Bank', value: order.providerAccount.institution },
                      !!order.providerAccount.accountName && { label: 'Account name', value: order.providerAccount.accountName },
                      {
                        label: 'Account number',
                        value: (
                          <button
                            type="button"
                            onClick={() => copyToClipboard(order.providerAccount!.accountIdentifier!, 'Account number')}
                            className="lp-mono inline-flex items-center gap-2 text-[15px] transition-colors hover:text-[var(--lp-link)]"
                            aria-label={`Copy account number ${order.providerAccount.accountIdentifier}`}
                          >
                            {order.providerAccount.accountIdentifier} <Copy className="size-4" />
                          </button>
                        ),
                      },
                    ]}
                  />
                  <div className="mt-5">
                    <Notice tone="info">
                      Send the exact amount, in one transfer. Your balance updates by itself once it is confirmed.
                    </Notice>
                  </div>
                </section>
              )}

              {error && <Notice tone="warning" title={error}>The details above may be out of date.</Notice>}

              <Link href="/dashboard" className={`${statusAction.primary} w-full`}>
                Back to my account
              </Link>
            </>
          )
        )}
      </div>
    </BareBrandPage>
  );
}
