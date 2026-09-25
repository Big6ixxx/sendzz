'use client';

/**
 * Refer & Earn.
 *
 * The page has to answer three questions honestly, because a referral programme that is vague
 * about any of them reads as a trick:
 *
 *   What do I get?  A share of what Sendzz earns when someone you invited adds money by bank
 *                   transfer. Said in those words, including the part people would otherwise
 *                   discover the hard way — that crypto deposits do not count, because they
 *                   earn us nothing to share.
 *   When do I get it? When the balance reaches the payout floor, then straight to the wallet.
 *   Where is it?    A number on screen, and a list of what has actually been sent.
 */

import { DashboardPageHeader } from '@/components/layout/DashboardPageHeader';
import { Check, ChevronRight, Copy, Gift, Loader2, Share2, Wallet } from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { explorerTxUrl } from '@/lib/explorers';
import { getMyMerchantApplication, type MerchantApplication } from '@/lib/actions/merchant';
import { MerchantApplicationCard } from '@/components/referrals/MerchantApplicationCard';

interface PayoutRow {
  id: string;
  amountUsdc: number;
  status: 'pending' | 'paid' | 'failed';
  txHash: string | null;
  chain: string;
  createdAt: string;
}

interface ReferralSummary {
  code: string;
  referredCount: number;
  pendingUsdc: number;
  paidUsdc: number;
  minimumPayoutUsdc: number;
  program: 'retail' | 'merchant';
  feeCreditUsdc: number;
  waiverVolumeUsdc: number;
  milestoneVolumeUsdc: number;
  milestoneCreditUsdc: number;
  tier: 'bronze' | 'silver' | 'gold';
  /** What they earn, as a percentage of what their network withdraws. */
  tierRatePercent: number;
  monthlyVolumeUsdc: number;
  nextTier: { name: string; ratePercent: number; volumeNeededUsdc: number } | null;
  payouts: PayoutRow[];
}

export default function ReferralsPage() {
  const { ready, authenticated } = usePrivy();
  const [data, setData] = useState<ReferralSummary | null>(null);
  const [application, setApplication] = useState<MerchantApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!ready || !authenticated) return;
    let cancelled = false;

    fetch('/api/referrals')
      .then((res) => (res.ok ? res.json() : null))
      .then((summary) => {
        if (cancelled) return;
        setData(summary);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    void getMyMerchantApplication().then((result) => {
      if (!cancelled) setApplication(result);
    });

    return () => {
      cancelled = true;
    };
  }, [ready, authenticated]);

  const link = data
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/?ref=${data.code}`
    : '';

  const copy = useCallback(async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success('Link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy. Select the link and copy it manually.');
    }
  }, [link]);

  const share = useCallback(async () => {
    if (!link) return;
    // The native sheet where there is one — on a phone this is the difference between
    // sharing and copy-pasting into the right app by hand.
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'Join me on Sendzz',
          text: 'Send money anywhere with just an email address.',
          url: link,
        });
        return;
      } catch {
        // Dismissing the share sheet is a decision, not a failure.
        return;
      }
    }
    await copy();
  }, [link, copy]);

  if (loading) {
    return (
      <div className="h-[50vh] flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-brand-secondary/25" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-8">
        <DashboardPageHeader title="Refer & Earn" subtitle="Share Sendzz, earn a cut" />
        <p className="text-sm text-brand-secondary/50">
          We could not load your referral details. Refresh the page to try again.
        </p>
      </div>
    );
  }

  const toGo = Math.max(0, data.minimumPayoutUsdc - data.pendingUsdc);
  // Two audiences, two sets of numbers. A retail referrer paid in fee credit has no tier, no
  // pending cash and no payout history — showing them zeros for all three reads as a broken
  // page rather than a different programme.
  const isMerchant = data.program === 'merchant';

  return (
    <div className="space-y-8 max-w-3xl">
      <DashboardPageHeader
        title="Refer & Earn"
        subtitle={
          isMerchant
            ? 'Share Sendzz, earn on every cash-out your people make'
            : 'Give your friends free transfers, earn credit on yours'
        }
      />

      {/* ── The link ──────────────────────────────────────────────────────── */}
      <div className="card-glass p-6 md:p-8 space-y-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shrink-0">
            <Gift className="w-6 h-6" />
          </div>
          <div className="space-y-1 min-w-0">
            <p className="font-bold text-brand-secondary">Your invite link</p>
            <p className="text-[13px] text-brand-secondary/50 leading-relaxed">
              Anyone who signs up through this link is linked to you for good.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="flex-1 min-w-0 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30 mb-1">
              Your code
            </p>
            <p className="font-mono text-[15px] font-bold text-brand-secondary tracking-wider break-all">
              {data.code}
            </p>
          </div>

          <div className="flex gap-2.5 sm:flex-col sm:justify-center">
            <button onClick={copy} className="btn-secondary flex-1 gap-2 whitespace-nowrap">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button onClick={share} className="btn-primary flex-1 gap-2 whitespace-nowrap">
              <Share2 className="w-4 h-4" />
              Share
            </button>
          </div>
        </div>
      </div>

      {/* ── What it has earned ────────────────────────────────────────────── */}
      {isMerchant ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Your tier" value={TIER_LABELS[data.tier]} />
          <Stat label="People joined" value={String(data.referredCount)} />
          <Stat label="Waiting to be paid" value={`$${data.pendingUsdc.toFixed(2)}`} />
          <Stat label="Paid to your wallet" value={`$${data.paidUsdc.toFixed(2)}`} />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Stat label="People joined" value={String(data.referredCount)} />
          <Stat label="Fee credit earned" value={`$${data.feeCreditUsdc.toFixed(2)}`} />
          <Stat
            label="Your fee-free allowance"
            value={`$${data.waiverVolumeUsdc.toFixed(2)}`}
          />
        </div>
      )}

      {/* Progress towards the next tier. Only shown when there is one to reach — a Gold
          affiliate being told they are 0% of the way to nothing is worse than silence. */}
      {isMerchant && data.nextTier && (
        <div className="card-glass p-6 space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-secondary/35">
              Next tier
            </p>
            <p className="text-[12px] text-brand-secondary/50">
              ${data.monthlyVolumeUsdc.toLocaleString()} withdrawn this month
            </p>
          </div>
          <p className="text-[13.5px] text-brand-secondary/80 leading-relaxed">
            <span className="font-semibold text-brand-secondary">
              ${data.nextTier.volumeNeededUsdc.toLocaleString()} more
            </span>{' '}
            in cash-outs from the people you invited and you reach{' '}
            <span className="font-semibold text-brand-secondary">
              {TIER_LABELS[data.nextTier.name as keyof typeof TIER_LABELS] ?? data.nextTier.name}
            </span>
            , which pays {data.nextTier.ratePercent}% instead of {data.tierRatePercent}%.
          </p>
        </div>
      )}

      {/* ── How it works, in plain words ──────────────────────────────────── */}
      <div className="card-glass p-6 md:p-8 space-y-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-secondary/35">
          How this works
        </p>

        <div className="space-y-3.5">
          {isMerchant ? (
            <>
              <Point
                title="You earn when they cash out to a bank"
                body={`You keep ${data.tierRatePercent}% of every withdrawal the people you invited make. It comes out of the fee Sendzz charges, never out of their money — they pay exactly the same whether they used your link or not.`}
              />
              <Point
                title="Your rate doesn't change with theirs"
                body={`Some countries cost us more to pay out to, so the fee there is higher. Your ${data.tierRatePercent}% stays the same either way — you are never paid less because of where someone banks.`}
              />
              <Point
                title="We pay into your Sendzz wallet automatically"
                body={`Once you've earned $${data.minimumPayoutUsdc.toFixed(2)}, your balance is sent to your wallet as USDC. Nothing to claim — it just arrives.${
                  toGo > 0 && data.pendingUsdc > 0
                    ? ` You're $${toGo.toFixed(2)} away from your next payout.`
                    : ''
                }`}
              />
            </>
          ) : (
            <>
              <Point
                title="They get their first cash-outs free"
                body="Anyone who joins with your link pays no Sendzz fee on their first withdrawals, up to a set amount. That's the part worth telling them about — it costs them nothing to try you out."
              />
              <Point
                title={`You get $${data.milestoneCreditUsdc.toFixed(2)} once they cash out $${data.milestoneVolumeUsdc}`}
                body="It lands as Sendzz fee credit, which comes off your own withdrawal fees automatically — no claiming, no minimum, nothing to withdraw. Counted across all their cash-outs, not one big one."
              />
            </>
          )}
        </div>
      </div>

      {/* A Merchant's full view lives on its own screen — network, monthly history, tier
          progress. Linked from here rather than the sidebar, so retail users are not shown a
          nav item for a track they are not on. */}
      {isMerchant && (
        <a
          href="/dashboard/merchant"
          className="card-glass p-6 flex items-center justify-between gap-4 hover:border-accent/30 transition-colors"
        >
          <div className="min-w-0">
            <p className="font-bold text-brand-secondary">Your Merchant dashboard</p>
            <p className="text-[13px] text-brand-secondary/50 mt-0.5">
              Monthly earnings, your network, and progress to the next tier.
            </p>
          </div>
          <ChevronRight className="w-5 h-5 shrink-0 text-brand-secondary/30" />
        </a>
      )}

      {/* Only for retail referrers — a Merchant is already on the track this applies to. */}
      {!isMerchant && (
        <MerchantApplicationCard
          application={application}
          onApplied={() => {
            void getMyMerchantApplication().then(setApplication);
          }}
        />
      )}

      {/* ── What has actually been sent ───────────────────────────────────── */}
      {isMerchant && data.payouts.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-secondary/35 px-1">
            Payouts
          </p>
          <div className="card-glass p-0 overflow-hidden divide-y divide-white/5">
            {data.payouts.map((payout) => (
              <div key={payout.id} className="p-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/8 flex items-center justify-center text-brand-secondary/40 shrink-0">
                    <Wallet className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-brand-secondary">
                      ${payout.amountUsdc.toFixed(2)}
                    </p>
                    <p className="text-[12px] text-brand-secondary/40">
                      {new Date(payout.createdAt).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p
                    className={
                      payout.status === 'paid'
                        ? 'text-[11px] font-bold uppercase tracking-widest text-accent'
                        : payout.status === 'failed'
                          ? 'text-[11px] font-bold uppercase tracking-widest text-orange-400'
                          : 'text-[11px] font-bold uppercase tracking-widest text-brand-secondary/35'
                    }
                  >
                    {payout.status === 'paid'
                      ? 'Sent'
                      : payout.status === 'failed'
                        ? 'Retrying'
                        : 'On its way'}
                  </p>
                  {/* Only once there is a real on-chain hash. A payout is marked sent as
                      soon as Circle accepts it, which is before the transaction is mined —
                      linking then would send people to an explorer page that does not exist
                      yet, which reads as the money having gone missing. */}
                  {payout.status === 'paid' && receiptUrl(payout) && (
                    <a
                      href={receiptUrl(payout)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-brand-secondary/35 hover:text-brand-secondary/70 transition-colors"
                    >
                      View receipt
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The explorer link for a payout, or null while it has no on-chain hash yet. */
function receiptUrl(payout: PayoutRow): string | null {
  return payout.txHash ? explorerTxUrl(payout.chain, payout.txHash) : null;
}

const TIER_LABELS = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
} as const;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-glass p-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30">
        {label}
      </p>
      <p className="text-2xl font-black tracking-tight text-brand-secondary mt-1.5">{value}</p>
    </div>
  );
}

function Point({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="text-[13.5px] font-semibold text-brand-secondary">{title}</p>
      <p className="text-[12.5px] text-brand-secondary/50 leading-relaxed mt-0.5">{body}</p>
    </div>
  );
}
