'use client';

import { getUserActivities } from '@/lib/supabase/transactions';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, CheckCircle2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { parseAppError } from '@/lib/errors/appErrors';

interface PendingTransfer {
  id: string;
  amount: number;
  sender_email: string;
  sender_id: string | null;
  note: string | null;
}

/**
 * Prominently surfaces incoming payments that are awaiting the user's acceptance.
 * Renders nothing when there are no pending incoming payments.
 */
export function PendingIncomingPanel({
  userId,
  userEmail,
  tone = 'dark',
}: {
  userId: string;
  userEmail: string;
  /** "light" is the cream brand style; other dashboard routes keep the dark default for now. */
  tone?: 'dark' | 'light';
}) {
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: pendingTransfers } = useQuery({
    queryKey: ['pending-incoming', userEmail],
    queryFn: async (): Promise<PendingTransfer[]> => {
      const data = await getUserActivities();
      return (data.received || [])
        .filter((t) => t.status === 'pending_claim' && t.sender_id !== userId)
        .map((t) => ({
          id: t.id,
          amount: t.amount,
          sender_email: t.sender_email,
          sender_id: t.sender_id,
          note: t.note,
        }));
    },
    enabled: !!userEmail,
    refetchInterval: 15_000,
  });

  async function handleAccept(transferId: string) {
    setAcceptingId(transferId);
    try {
      const res = await fetch('/api/transfer/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transferId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(parseAppError(data.error || 'Could not accept payment'));
      } else {
        toast.success('Payment accepted! Funds added to your balance');
        queryClient.invalidateQueries({ queryKey: ['pending-incoming', userEmail] });
        queryClient.invalidateQueries({ queryKey: ['history', userEmail] });
        queryClient.invalidateQueries({ queryKey: ['balance'] });
      }
    } catch (err) {
      toast.error(parseAppError(err));
    } finally {
      setAcceptingId(null);
    }
  }

  // Nothing to show
  if (!pendingTransfers || pendingTransfers.length === 0) return null;

  const usdc = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (tone === 'light') {
    return (
      <section className="rounded-[28px] bg-white p-2 shadow-[0_0_0_1px_rgb(17_26_19/0.06)]">
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <div className="flex items-center gap-2.5">
            <span className="lp-pulse size-2 rounded-full bg-[var(--lp-green)]" />
            <h2 className="lp-display text-[20px] font-semibold tracking-[-0.02em]">Waiting for you to accept</h2>
          </div>
          <span className="lp-mono rounded-full bg-[var(--lp-ink)] px-2.5 py-1 text-[12px] text-[var(--lp-green)]">
            {pendingTransfers.length}
          </span>
        </div>
        <ul className="flex flex-col gap-1">
          {pendingTransfers.map((transfer) => (
            <li key={transfer.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] bg-[var(--lp-cream)] px-4 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--lp-green)] text-[var(--lp-ink)]">
                  <ArrowDownLeft className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold">{transfer.sender_email}</p>
                  <p className="truncate text-[13px] text-[var(--lp-muted)]">
                    <span className="font-semibold text-[#0e7a45]">+{usdc(transfer.amount)} USDC</span>
                    {transfer.note && <> · &ldquo;{transfer.note}&rdquo;</>}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleAccept(transfer.id)}
                disabled={acceptingId === transfer.id}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[var(--lp-ink)] px-4 text-[14px] font-semibold text-[var(--lp-cream)] transition-[scale] duration-150 active:scale-[0.97] disabled:opacity-60 max-sm:w-full"
              >
                {acceptingId === transfer.id ? <RefreshCw className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                {acceptingId === transfer.id ? 'Accepting…' : 'Accept'}
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section>
      <div
        className="rounded-3xl overflow-hidden"
        style={{
          background: 'rgba(0,232,122,0.04)',
          border: '1px solid rgba(0,232,122,0.15)',
        }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid rgba(0,232,122,0.1)' }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ background: '#00e87a' }}
            />
            <span
              className="text-xs font-bold uppercase tracking-widest"
              style={{ color: '#00e87a' }}
            >
              Incoming Payments
            </span>
          </div>
          <span
            className="text-xs font-bold px-2 py-0.5 rounded-full"
            style={{
              background: 'rgba(0,232,122,0.12)',
              color: '#00e87a',
              border: '1px solid rgba(0,232,122,0.2)',
            }}
          >
            {pendingTransfers.length}
          </span>
        </div>

        {/* Transfer rows */}
        <div className="divide-y divide-white/5">
          {pendingTransfers.map((transfer) => (
            <div
              key={transfer.id}
              className="px-6 py-4 flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    background: 'rgba(0,232,122,0.08)',
                    border: '1px solid rgba(0,232,122,0.15)',
                    color: '#00e87a',
                  }}
                >
                  <ArrowDownLeft className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-sm text-brand-secondary truncate">
                    {transfer.sender_email}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className="text-sm font-bold tabular-nums"
                      style={{ color: '#00e87a' }}
                    >
                      +{usdc(transfer.amount)}{' '}
                      <span className="text-[10px] opacity-50 font-bold uppercase">USDC</span>
                    </span>
                    {transfer.note && (
                      <span className="text-[10px] text-brand-secondary/30 truncate max-w-[120px]">
                        &ldquo;{transfer.note}&rdquo;
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleAccept(transfer.id)}
                disabled={acceptingId === transfer.id}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all disabled:opacity-50 shrink-0 hover:scale-105 active:scale-95"
                style={{
                  background: 'rgba(0,232,122,0.12)',
                  color: '#00e87a',
                  border: '1px solid rgba(0,232,122,0.25)',
                }}
              >
                {acceptingId === transfer.id ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Accepting…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3 h-3" />
                    Accept
                  </>
                )}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
