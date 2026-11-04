'use client';

import { getUserActivities } from '@/lib/supabase/transactions';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, CheckCircle2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { parseAppError } from '@/lib/errors/appErrors';
import { formatMoney } from '@/lib/format-usdc';

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

  return (
    <section className="lp-card rounded-[28px] p-2">
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <div className="flex items-center gap-2.5">
          <span className="lp-fixed lp-pulse size-2 rounded-full bg-[var(--lp-green)]" />
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
              <span className="lp-fixed grid size-10 shrink-0 place-items-center rounded-full bg-[var(--lp-green)] text-[var(--lp-ink)]">
                <ArrowDownLeft className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold">{transfer.sender_email}</p>
                <p className="truncate text-[13px] text-[var(--lp-muted)]">
                  <span className="font-semibold text-[var(--lp-good)]">+{formatMoney(transfer.amount)} USDC</span>
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
