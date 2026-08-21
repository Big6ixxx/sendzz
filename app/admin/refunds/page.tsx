'use client';

/**
 * Refunds owed.
 *
 * Every row here is a person whose USDC left their wallet and never reached their bank. They
 * are not history — they are debts, and until now nothing surfaced them: the withdrawal read as
 * "failed", which looks identical to one where nothing was ever sent and nobody is owed a thing.
 * The only reason the first was found is that the user complained.
 *
 * Recording a refund needs the hash of the transfer that paid it, because a refund with no
 * evidence is not a refund. The database rejects a hash already used elsewhere and the RPC
 * refuses a debt that is already settled, so nobody can be paid twice from here.
 */

import { explorerTxUrl } from '@/lib/explorers';
import { getPendingRefunds, markRefundPaid } from '@/lib/supabase/admin';
import type { AdminPendingRefund } from '@/types/admin';
import { usePrivy } from '@privy-io/react-auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { AlertTriangle, Check, Copy, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

export default function AdminRefunds() {
  const { user, getAccessToken } = usePrivy();
  const queryClient = useQueryClient();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [hashInput, setHashInput] = useState('');

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['admin-refunds', user?.email?.address],
    queryFn: async () => getPendingRefunds((await getAccessToken()) ?? undefined),
    enabled: !!user?.email?.address,
  });

  const refunds = data ?? [];
  const totalOwed = refunds.reduce((t, r) => t + r.owedUsdc, 0);

  const record = useMutation({
    mutationFn: async ({ id, hash, amount }: { id: string; hash: string; amount: number }) =>
      markRefundPaid(id, hash, amount, (await getAccessToken()) ?? undefined),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.reason ?? 'Could not record the refund.');
        return;
      }
      toast.success('Refund recorded — the withdrawal now shows as reversed.');
      setOpenFor(null);
      setHashInput('');
      queryClient.invalidateQueries({ queryKey: ['admin-refunds'] });
    },
    onError: () => toast.error('Could not record the refund.'),
  });

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Refunds Owed</h1>
          <p className="text-[12px] mt-1" style={{ color: 'rgba(248,248,246,0.4)' }}>
            Withdrawals where the deposit landed but no payout was made. The user is out of
            pocket until each of these is sent back.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isRefetching}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-colors hover:bg-white/5"
          style={{
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(248,248,246,0.6)',
          }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ── Total outstanding ───────────────────────────────────── */}
      {refunds.length > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-xl"
          style={{
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.2)',
          }}
        >
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="text-[12.5px]">
            <span className="font-bold text-red-400">
              {totalOwed.toFixed(6)} USDC
            </span>{' '}
            <span style={{ color: 'rgba(248,248,246,0.6)' }}>
              owed across {refunds.length} withdrawal{refunds.length === 1 ? '' : 's'}
            </span>
          </span>
        </div>
      )}

      {/* ── List ────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'rgba(248,248,246,0.3)' }} />
        </div>
      ) : refunds.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-20 rounded-2xl"
          style={{ border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <Check className="w-8 h-8 mb-3" style={{ color: '#00e87a' }} />
          <p className="text-[13px] font-bold">Nothing owed</p>
          <p className="text-[11.5px] mt-1" style={{ color: 'rgba(248,248,246,0.35)' }}>
            Every funded withdrawal either paid out or has been refunded.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {refunds.map((r) => (
            <RefundCard
              key={r.withdrawalId}
              refund={r}
              open={openFor === r.withdrawalId}
              onToggle={() => {
                setOpenFor(openFor === r.withdrawalId ? null : r.withdrawalId);
                setHashInput('');
              }}
              hashInput={hashInput}
              setHashInput={setHashInput}
              onCopy={copy}
              onRecord={() =>
                record.mutate({
                  id: r.withdrawalId,
                  hash: hashInput,
                  amount: r.owedUsdc,
                })
              }
              recording={record.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RefundCard({
  refund: r,
  open,
  onToggle,
  hashInput,
  setHashInput,
  onCopy,
  onRecord,
  recording,
}: {
  refund: AdminPendingRefund;
  open: boolean;
  onToggle: () => void;
  hashInput: string;
  setHashInput: (v: string) => void;
  onCopy: (text: string, label: string) => void;
  onRecord: () => void;
  recording: boolean;
}) {
  const original = explorerTxUrl(r.chain, r.txHash);

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <div className="p-4 space-y-3">
        {/* Who + how much */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold truncate">
                {r.email ?? 'unknown account'}
              </span>
              {r.email && (
                <button
                  type="button"
                  onClick={() => onCopy(r.email!, 'Email')}
                  className="opacity-40 hover:opacity-100 transition-opacity"
                  aria-label="Copy email"
                >
                  <Copy className="w-3 h-3" />
                </button>
              )}
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: 'rgba(248,248,246,0.35)' }}>
              {format(new Date(r.createdAt), 'd MMM yyyy, HH:mm')} · {r.provider ?? '—'} ·{' '}
              {r.chain ?? '—'}
            </p>
          </div>

          <div className="text-right shrink-0">
            <p className="text-[15px] font-black tabular-nums text-red-400">
              {r.owedUsdc.toFixed(6)} USDC
            </p>
            <p className="text-[10.5px]" style={{ color: 'rgba(248,248,246,0.35)' }}>
              {r.amountUsdc.toFixed(6)} payout + {r.feeUsdc.toFixed(6)} fee
            </p>
          </div>
        </div>

        {/* What they were expecting */}
        <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-[11px]">
          <Field label="Was to receive">
            {r.fiatAmount != null
              ? `${r.fiatAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${r.fiatCurrency}`
              : '—'}
          </Field>
          <Field label="Order">{r.orderId ?? '—'}</Field>
        </div>

        {/* Refund destination — the wallet the deposit came from */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span style={{ color: 'rgba(248,248,246,0.35)' }}>Send back to</span>
          {r.refundAddress ? (
            <>
              <code
                className="px-2 py-1 rounded-lg font-mono text-[10.5px] break-all"
                style={{ background: 'rgba(255,255,255,0.05)' }}
              >
                {r.refundAddress}
              </code>
              <button
                type="button"
                onClick={() => onCopy(r.refundAddress!, 'Address')}
                className="opacity-40 hover:opacity-100 transition-opacity"
                aria-label="Copy address"
              >
                <Copy className="w-3 h-3" />
              </button>
            </>
          ) : (
            <span className="text-amber-400">
              no {r.chain ?? ''} wallet on file — ask the user where to send it
            </span>
          )}
        </div>

        {/* Proof their money left */}
        {r.txHash && (
          <div className="flex items-center gap-2 text-[11px]">
            <span style={{ color: 'rgba(248,248,246,0.35)' }}>Their deposit</span>
            <code className="font-mono text-[10.5px] truncate max-w-[280px]">{r.txHash}</code>
            {original && (
              <a
                href={original}
                target="_blank"
                rel="noopener noreferrer"
                className="opacity-40 hover:opacity-100 transition-opacity"
                aria-label="View on explorer"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* Record the payment */}
        {!open ? (
          <button
            type="button"
            onClick={onToggle}
            className="w-full mt-1 py-2.5 rounded-xl text-[11.5px] font-bold transition-transform hover:scale-[1.01]"
            style={{ background: 'rgba(0,232,122,0.13)', color: '#00e87a' }}
          >
            Mark as refunded
          </button>
        ) : (
          <div className="space-y-2 pt-1">
            <p className="text-[10.5px]" style={{ color: 'rgba(248,248,246,0.4)' }}>
              Send {r.owedUsdc.toFixed(6)} USDC on {r.chain ?? 'the original chain'}, then paste
              the transaction hash below. This marks the withdrawal reversed and cannot be
              undone.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                value={hashInput}
                onChange={(e) => setHashInput(e.target.value)}
                placeholder="Refund transaction hash"
                className="flex-1 min-w-[220px] text-[11.5px] px-3 py-2.5 rounded-xl outline-none font-mono"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#f8f8f6',
                }}
              />
              <button
                type="button"
                onClick={onRecord}
                disabled={!hashInput.trim() || recording}
                className="px-4 py-2.5 rounded-xl text-[11.5px] font-bold disabled:opacity-30 transition-opacity"
                style={{ background: 'rgba(0,232,122,0.15)', color: '#00e87a' }}
              >
                {recording ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
              </button>
              <button
                type="button"
                onClick={onToggle}
                className="px-3 py-2.5 rounded-xl text-[11.5px] font-medium hover:bg-white/5 transition-colors"
                style={{ color: 'rgba(248,248,246,0.4)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span>
      <span style={{ color: 'rgba(248,248,246,0.35)' }}>{label} </span>
      <span className="font-medium">{children}</span>
    </span>
  );
}
