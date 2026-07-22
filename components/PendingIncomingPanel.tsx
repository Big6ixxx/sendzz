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
}: {
  userId: string;
  userEmail: string;
}) {
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: pendingTransfers } = useQuery({
    queryKey: ['pending-incoming', userEmail],
    queryFn: async (): Promise<PendingTransfer[]> => {
      const data = await getUserActivities(userEmail);
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
                      +{transfer.amount.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
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
