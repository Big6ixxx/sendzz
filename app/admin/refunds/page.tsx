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
import { getPendingRefunds, markFiatPayoutSent, markRefundPaid } from '@/lib/supabase/admin';
import type { AdminPendingRefund } from '@/types/admin';
import { usePrivy } from '@privy-io/react-auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { AlertTriangle, Check, Copy, ExternalLink, Landmark, Loader2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EASE } from '@/components/landing/motion';
import { CardsShimmer, PageHeader, Panel, PrimaryButton, RefreshButton, SecondaryButton, Shimmer } from '../components/ui';

export default function AdminRefunds() {
  const { user, getAccessToken } = usePrivy();
  const queryClient = useQueryClient();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [hashInput, setHashInput] = useState('');

  const { data, isPending, refetch, isRefetching } = useQuery({
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
      toast.success('Refund recorded. The withdrawal now shows as reversed.');
      setOpenFor(null);
      setHashInput('');
      queryClient.invalidateQueries({ queryKey: ['admin-refunds'] });
    },
    onError: () => toast.error('Could not record the refund.'),
  });

  /**
   * Settling by paying the bank instead of reversing.
   *
   * Confirmed separately from the reversal because the two are not interchangeable and cannot
   * both be undone: one returns USDC, the other declares the withdrawal delivered.
   */
  const payFiat = useMutation({
    mutationFn: async ({ id }: { id: string }) => markFiatPayoutSent(id, undefined, (await getAccessToken()) ?? undefined),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.reason ?? 'Could not record the payout.');
        return;
      }
      toast.success('Payout recorded. The withdrawal now shows as completed and the user has been notified.');
      queryClient.invalidateQueries({ queryKey: ['admin-refunds'] });
    },
    onError: () => toast.error('Could not record the payout.'),
  });

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <div className="space-y-5 md:space-y-8">
      <PageHeader
        eyebrow="Refunds"
        title="Money we"
        italic="owe back."
        aside="Withdrawals where the deposit landed but no payout was made. The user is out of pocket until each of these is settled."
        actions={<RefreshButton onClick={() => refetch()} spinning={isRefetching} disabled={isRefetching} />}
      />

      {/* ── What is outstanding ───────────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: EASE, delay: 0.06 }}
        className={
          !isPending && refunds.length === 0
            ? 'lp-on-green rounded-[28px] p-5 sm:p-8 md:rounded-[36px] md:p-10'
            : 'lp-on-forest rounded-[28px] p-5 text-[var(--lp-cream)] sm:p-8 md:rounded-[36px] md:p-10'
        }
      >
        {isPending ? (
          <>
            <Shimmer onDark className="h-4 w-32" />
            <Shimmer onDark className="mt-5 h-[clamp(40px,9vw,80px)] w-3/5" />
          </>
        ) : refunds.length === 0 ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <span className="lp-mono text-[12px] uppercase sm:text-[13px]">Outstanding</span>
              <p className="lp-display mt-4 text-[clamp(40px,9vw,80px)] leading-[0.9] tracking-[-0.05em]">
                Nothing <span className="lp-serif tracking-[-0.02em]">owed.</span>
              </p>
            </div>
            <p className="max-w-[320px] text-[15px] leading-normal sm:text-right">Every funded withdrawal either paid out or has been refunded.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <span className="lp-mono flex items-center gap-2 text-[12px] uppercase text-[#f5c451] sm:text-[13px]">
                <AlertTriangle className="size-4" /> Outstanding
              </span>
              <p className="lp-display mt-4 break-words text-[clamp(36px,8.4vw,80px)] leading-[0.9] tracking-[-0.05em] tabular-nums">
                {totalOwed.toFixed(6)} <span className="lp-serif text-[0.45em] tracking-[-0.01em] text-[#cfe0d6]">USDC</span>
              </p>
            </div>
            <p className="text-[15px] text-[#cfe0d6] sm:text-right">
              Owed across{' '}
              <strong className="font-semibold text-[var(--lp-cream)]">
                {refunds.length} withdrawal{refunds.length === 1 ? '' : 's'}
              </strong>
            </p>
          </div>
        )}
      </motion.section>

      {/* ── Each debt ─────────────────────────────────────────────────────── */}
      {isPending ? (
        <CardsShimmer />
      ) : (
        refunds.length > 0 && (
          <div className="space-y-4 md:space-y-5">
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
                onRecord={() => record.mutate({ id: r.withdrawalId, hash: hashInput, amount: r.owedUsdc })}
                recording={record.isPending}
                onPayFiat={() => payFiat.mutate({ id: r.withdrawalId })}
                payingFiat={payFiat.isPending}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
}

function CopyChip({ text, label, onCopy }: { text: string; label: string; onCopy: (text: string, label: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onCopy(text, label)}
      className="lp-mono inline-flex max-w-full items-center gap-2 rounded-[14px] bg-[var(--lp-surface)] px-3 py-2 text-left text-[12px] text-[var(--lp-ink)] shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)] transition-colors hover:bg-[var(--lp-raised)]"
      aria-label={`Copy ${label.toLowerCase()}`}
    >
      <span className="break-all">{text}</span>
      <Copy className="size-3.5 shrink-0 opacity-50" />
    </button>
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
  onPayFiat,
  payingFiat,
}: {
  refund: AdminPendingRefund;
  open: boolean;
  onToggle: () => void;
  hashInput: string;
  setHashInput: (v: string) => void;
  onCopy: (text: string, label: string) => void;
  onRecord: () => void;
  recording: boolean;
  onPayFiat: () => void;
  payingFiat: boolean;
}) {
  const original = explorerTxUrl(r.chain, r.txHash);

  return (
    <Panel className="p-5 sm:p-8">
      {/* Who, and how much */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-[17px] font-semibold">{r.email ?? 'Unknown account'}</p>
            {r.email && (
              <button
                type="button"
                onClick={() => onCopy(r.email!, 'Email')}
                className="grid size-8 shrink-0 place-items-center rounded-full text-[var(--lp-muted)] transition-colors hover:bg-[var(--lp-cream)] hover:text-[var(--lp-ink)]"
                aria-label="Copy email"
              >
                <Copy className="size-3.5" />
              </button>
            )}
          </div>
          <p className="mt-0.5 text-[13px] text-[var(--lp-muted)]">
            {format(new Date(r.createdAt), 'd MMM yyyy, HH:mm')} · {r.provider ?? '—'} · {r.chain ?? '—'}
          </p>
        </div>
        <div className="shrink-0 sm:text-right">
          <p className="lp-display text-[clamp(24px,6vw,32px)] leading-none tracking-[-0.03em] text-[var(--lp-danger)] tabular-nums">
            {r.owedUsdc.toFixed(6)} <span className="text-[0.55em]">USDC</span>
          </p>
          <p className="mt-1 text-[13px] text-[var(--lp-muted)] tabular-nums">
            {r.amountUsdc.toFixed(6)} payout + {r.feeUsdc.toFixed(6)} fee
          </p>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-[18px] bg-[var(--lp-cream)] px-4 py-3">
          <dt className="text-[13px] text-[var(--lp-muted)]">Was to receive</dt>
          <dd className="mt-0.5 text-[15px] font-semibold">
            {r.fiatAmount != null ? `${r.fiatAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${r.fiatCurrency}` : '—'}
          </dd>
        </div>
        <div className="min-w-0 rounded-[18px] bg-[var(--lp-cream)] px-4 py-3">
          <dt className="text-[13px] text-[var(--lp-muted)]">Order</dt>
          <dd className="lp-mono mt-0.5 break-all text-[13px]">{r.orderId ?? '—'}</dd>
        </div>
      </dl>

      {/* Two ways to settle. They are different outcomes, and neither can be undone. */}
      <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col rounded-[22px] border border-[var(--lp-rule)] p-4 sm:p-5">
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            <Undo2 className="size-4" /> Reverse in USDC
          </p>
          <div className="mt-3 space-y-3 text-[13px]">
            <div className="space-y-1.5">
              <p className="text-[var(--lp-muted)]">Send back to the wallet the deposit came from</p>
              {r.refundAddress ? (
                <CopyChip text={r.refundAddress} label="Address" onCopy={onCopy} />
              ) : (
                <p className="text-[var(--lp-warn)]">No {r.chain ?? ''} wallet on file. Ask the user where to send it.</p>
              )}
            </div>
            {r.txHash && (
              <div className="space-y-1.5">
                <p className="text-[var(--lp-muted)]">Their deposit</p>
                <div className="flex min-w-0 items-center gap-2">
                  <code className="lp-mono min-w-0 truncate text-[12px]">{r.txHash}</code>
                  {original && (
                    <a
                      href={original}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="grid size-8 shrink-0 place-items-center rounded-full text-[var(--lp-muted)] transition-colors hover:bg-[var(--lp-cream)] hover:text-[var(--lp-ink)]"
                      aria-label="View on explorer"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>

          {!open ? (
            <PrimaryButton onClick={onToggle} className="mt-5 w-full lg:mt-auto">
              Reverse in USDC
            </PrimaryButton>
          ) : (
            <div className="mt-5 space-y-3">
              <p className="text-[13px] leading-normal text-[var(--lp-body)]">
                Send {r.owedUsdc.toFixed(6)} USDC on {r.chain ?? 'the original chain'}, then paste the transaction hash. This marks the
                withdrawal reversed and cannot be undone.
              </p>
              <input
                value={hashInput}
                onChange={(e) => setHashInput(e.target.value)}
                placeholder="Refund transaction hash"
                className="lp-mono h-12 w-full rounded-full bg-[var(--lp-cream)] px-4 text-base outline-2 outline-offset-2 outline-transparent transition-[outline-color] focus:outline-[var(--lp-ink)] sm:text-[13px]"
              />
              <div className="flex gap-2">
                <SecondaryButton onClick={onToggle} className="flex-1">
                  Cancel
                </SecondaryButton>
                <PrimaryButton onClick={onRecord} disabled={!hashInput.trim() || recording} className="flex-1">
                  {recording ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Confirm
                </PrimaryButton>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col rounded-[22px] border border-[var(--lp-rule)] p-4 sm:p-5">
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            <Landmark className="size-4" /> Pay their bank instead
          </p>
          <div className="mt-3 space-y-1.5 text-[13px]">
            {r.payout.payable ? (
              <>
                <p className="text-[var(--lp-muted)]">
                  {r.payout.bankName ?? 'Bank unknown'}
                  {r.payout.accountName ? ` · ${r.payout.accountName}` : ''}
                </p>
                <CopyChip text={r.payout.accountNumber!} label="Account number" onCopy={onCopy} />
                {r.payout.source === 'contact' && <p className="text-[var(--lp-warn)]">From a saved contact. Check it matches.</p>}
              </>
            ) : (
              <p className="text-[var(--lp-warn)]">
                Not recoverable{r.payout.masked ? ` (only ${r.payout.masked} on file)` : ''}. Reverse the USDC instead.
              </p>
            )}
          </div>
          {r.payout.payable && !open && (
            <SecondaryButton onClick={onPayFiat} disabled={payingFiat} className="mt-5 h-auto min-h-12 w-full whitespace-normal py-3 lg:mt-auto">
              {payingFiat ? <Loader2 className="size-4 animate-spin" /> : `I paid ${r.fiatAmount ?? ''} ${r.fiatCurrency} to this account`}
            </SecondaryButton>
          )}
        </div>
      </div>
    </Panel>
  );
}
