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

import { PageHeader } from '@/components/dashboard/PageHeader';
import { Notice } from '@/components/flow/ui';
import { ArrowRight, Check, Copy, Share2, Wallet } from 'lucide-react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { explorerTxUrl } from '@/lib/explorers';
import { getMyMerchantApplication, type MerchantApplication } from '@/lib/actions/merchant';
import { MerchantApplicationCard } from '@/components/referrals/MerchantApplicationCard';
import { referralsEnabled } from '@/lib/features';
import { ComingSoon } from '@/components/ComingSoon';
import { Skeleton } from '@/components/ui/skeleton';
import { formatUsd } from '@/lib/format-usdc';

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

/**
 * The gate, kept in a wrapper rather than an early return inside the component below.
 *
 * An early return before the hooks is what rules-of-hooks exists to catch, and the rule is
 * right even here: the flag happens to be a build-time constant, so the order could not
 * actually vary, but a reader has to know that to know the code is safe. A wrapper needs no
 * such argument — the real component either mounts with all its hooks or does not mount.
 */
export default function ReferralsPage() {
  if (!referralsEnabled()) {
    return (
      <ComingSoon
        title="Refer & Earn"
        body="Earn a share of what the people you bring to Sendzz withdraw. We are finishing the payout side before opening it up. Nothing is lost in the meantime."
      />
    );
  }
  return <ReferralsDashboard />;
}

function ReferralsDashboard() {
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
      <div className="mx-auto max-w-[1080px] space-y-6 pb-24" aria-label="Loading">
        <Skeleton tone="page" className="h-24 w-2/3 rounded-[24px]" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <Skeleton tone="page" className="h-64 rounded-[32px]" />
          <Skeleton tone="page" className="h-64 rounded-[32px]" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-[1080px] space-y-6 pb-24">
        <PageHeader eyebrow="Refer & earn" title="Bring a friend," italic="share the upside." />
        <Notice tone="danger" title="We couldn't load your referral details">
          Refresh the page to try again.
        </Notice>
      </div>
    );
  }

  const toGo = Math.max(0, data.minimumPayoutUsdc - data.pendingUsdc);
  // Two audiences, two sets of numbers. A retail referrer paid in fee credit has no tier, no
  // pending cash and no payout history — showing them zeros for all three reads as a broken
  // page rather than a different programme.
  const isMerchant = data.program === 'merchant';

  const stats = isMerchant
    ? [
        { label: 'Your tier', value: TIER_LABELS[data.tier], note: `${data.tierRatePercent}% of every cash-out` },
        { label: 'People joined', value: String(data.referredCount) },
        { label: 'Waiting to be paid', value: formatUsd(data.pendingUsdc), note: toGo > 0 ? `${formatUsd(toGo)} to the next payout` : undefined },
        { label: 'Paid to your wallet', value: formatUsd(data.paidUsdc) },
      ]
    : [
        { label: 'People joined', value: String(data.referredCount) },
        { label: 'Fee credit earned', value: formatUsd(data.feeCreditUsdc), note: 'Comes off your own fees' },
        { label: 'Your fee-free allowance', value: formatUsd(data.waiverVolumeUsdc), wide: true },
      ];

  const steps = isMerchant
    ? [
        {
          title: 'You earn when they cash out to a bank',
          body: `You keep ${data.tierRatePercent}% of every withdrawal the people you invited make. It comes out of the fee Sendzz charges, never out of their money. They pay exactly the same whether they used your link or not.`,
        },
        {
          title: "Your rate doesn't change with theirs",
          body: `Some countries cost us more to pay out to, so the fee there is higher. Your ${data.tierRatePercent}% stays the same either way, so you are never paid less because of where someone banks.`,
        },
        {
          title: 'We pay into your Sendzz wallet automatically',
          body: `Once you've earned ${formatUsd(data.minimumPayoutUsdc)}, your balance is sent to your wallet as USDC. Nothing to claim, it just arrives.${
            toGo > 0 && data.pendingUsdc > 0 ? ` You're ${formatUsd(toGo)} away from your next payout.` : ''
          }`,
        },
      ]
    : [
        {
          title: 'Share your link',
          body: 'Anyone who signs up through it is linked to you for good.',
        },
        {
          title: 'They get their first cash-outs free',
          body: "Anyone who joins with your link pays no Sendzz fee on their first withdrawals, up to a set amount. That's the part worth telling them about: it costs them nothing to try you out.",
        },
        {
          title: `You get ${formatUsd(data.milestoneCreditUsdc)} once they cash out $${data.milestoneVolumeUsdc}`,
          body: 'It lands as Sendzz fee credit, which comes off your own withdrawal fees automatically. No claiming, no minimum, nothing to withdraw. Counted across all their cash-outs, not one big one.',
        },
      ];

  const tierProgress =
    isMerchant && data.nextTier
      ? Math.min(100, (data.monthlyVolumeUsdc / (data.monthlyVolumeUsdc + data.nextTier.volumeNeededUsdc)) * 100)
      : 0;

  return (
    <div className="mx-auto max-w-[1080px] space-y-6 pb-24 md:space-y-8">
      <PageHeader
        eyebrow="Refer & earn"
        title="Bring a friend,"
        italic="share the upside."
        subtitle={
          isMerchant
            ? 'Share Sendzz, earn on every cash-out your people make.'
            : 'Give your friends free transfers, earn credit on yours.'
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-5">
        {/* ── The link ──────────────────────────────────────────────────────── */}
        <section className="lp-fixed relative overflow-hidden rounded-[32px] bg-[var(--lp-forest)] p-6 text-[var(--lp-cream)] sm:p-8">
          <p className="lp-mono text-[12px] uppercase text-[var(--lp-green)]">Your invite code</p>
          <p className="lp-display mt-2 break-all text-[clamp(36px,7vw,56px)] leading-[0.95] tracking-[-0.03em]">{data.code}</p>
          <p className="lp-mono mt-3 truncate text-[13px] text-[#a9c2b5]" title={link}>
            {link.replace(/^https?:\/\//, '')}
          </p>
          <p className="mt-4 max-w-[380px] text-[14px] leading-[1.5] text-[#cfe0d6]">
            Anyone who signs up through this link is linked to you for good.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={copy}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[var(--lp-cream)] px-5 text-[15px] font-semibold text-[var(--lp-ink)] transition-transform duration-150 active:scale-[0.98]"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button
              type="button"
              onClick={share}
              className="lp-fixed inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[var(--lp-green)] px-5 text-[15px] font-semibold text-[var(--lp-ink)] transition-transform duration-150 active:scale-[0.98]"
            >
              <Share2 className="size-4" /> Share
            </button>
          </div>
        </section>

        {/* ── What it has earned ────────────────────────────────────────────── */}
        <section className="grid grid-cols-2 gap-3" aria-label="Your numbers">
          {stats.map((s) => (
            <div
              key={s.label}
              className={`lp-card flex flex-col justify-between rounded-[24px] p-5 ${'wide' in s && s.wide ? 'col-span-2' : ''}`}
            >
              <p className="text-[14px] text-[var(--lp-muted)]">{s.label}</p>
              <div className="mt-6">
                <p className="lp-display text-[clamp(28px,4vw,36px)] leading-none tracking-[-0.04em] tabular-nums">{s.value}</p>
                {s.note && <p className="mt-1.5 text-[13px] text-[var(--lp-muted)]">{s.note}</p>}
              </div>
            </div>
          ))}
        </section>
      </div>

      {/* Progress towards the next tier. Only shown when there is one to reach — a Gold
          affiliate being told they are 0% of the way to nothing is worse than silence. */}
      {isMerchant && data.nextTier && (
        <section className="lp-card rounded-[28px] p-6 sm:p-7">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="lp-display text-[24px] tracking-[-0.03em]">
              Next: <span className="lp-serif">{TIER_LABELS[data.nextTier.name as keyof typeof TIER_LABELS] ?? data.nextTier.name}</span>
            </h2>
            <p className="text-[14px] text-[var(--lp-muted)]">${data.monthlyVolumeUsdc.toLocaleString()} cashed out this month</p>
          </div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-[var(--lp-cream)]" role="progressbar" aria-valuenow={Math.round(tierProgress)} aria-valuemin={0} aria-valuemax={100}>
            <div className="lp-fixed h-full rounded-full bg-[var(--lp-green)]" style={{ width: `${tierProgress}%` }} />
          </div>
          <p className="mt-4 text-[15px] leading-[1.55] text-[var(--lp-body)]">
            <span className="font-semibold text-[var(--lp-ink)]">${data.nextTier.volumeNeededUsdc.toLocaleString()} more</span> in cash-outs from the
            people you invited and you move up, earning {data.nextTier.ratePercent}% instead of {data.tierRatePercent}%.
          </p>
        </section>
      )}

      {/* ── How it works, in plain words ──────────────────────────────────── */}
      <section>
        <h2 className="lp-display text-[clamp(26px,4vw,34px)] tracking-[-0.03em]">
          How it <span className="lp-serif">works.</span>
        </h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-3">
          {steps.map((st, i) => (
            <li key={st.title} className="lp-card rounded-[24px] p-5 sm:p-6">
              <span className="lp-serif text-[40px] leading-none text-[var(--lp-good)]">{i + 1}</span>
              <p className="mt-4 text-[16px] font-semibold leading-snug">{st.title}</p>
              <p className="mt-2 text-[14px] leading-[1.55] text-[var(--lp-body)]">{st.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* A Merchant's full view lives on its own screen — network, monthly history, tier
          progress. Linked from here rather than the sidebar, so retail users are not shown a
          nav item for a track they are not on. */}
      {isMerchant && (
        <Link
          href="/dashboard/merchant"
          className="flex items-center justify-between gap-4 rounded-[28px] bg-[var(--lp-sand)] p-6 transition-transform duration-150 hover:-translate-y-px"
        >
          <span className="min-w-0">
            <span className="block text-[17px] font-semibold">Your Merchant dashboard</span>
            <span className="mt-1 block text-[14px] text-[var(--lp-body)]">Monthly earnings, your network, and progress to the next tier.</span>
          </span>
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--lp-ink)] text-[var(--lp-cream)]">
            <ArrowRight className="size-5" />
          </span>
        </Link>
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
        <section className="lp-card rounded-[28px] p-2">
          <h2 className="px-4 pb-1 pt-3 lp-display text-[22px] tracking-[-0.02em]">Payouts</h2>
          <ul className="flex flex-col gap-0.5 p-1">
            {data.payouts.map((payout) => {
              const url = receiptUrl(payout);
              return (
                <li key={payout.id} className="flex items-center gap-3 rounded-[20px] px-3 py-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--lp-good-soft)] text-[var(--lp-good)]">
                    <Wallet className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold tabular-nums">+{formatUsd(payout.amountUsdc)}</span>
                    <span className="block text-[13px] text-[var(--lp-muted)]">
                      {new Date(payout.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`rounded-full px-2 py-px text-[11px] font-semibold ${
                        payout.status === 'paid'
                          ? 'bg-[var(--lp-good-soft)] text-[var(--lp-good)]'
                          : payout.status === 'failed'
                            ? 'bg-[var(--lp-danger-soft)] text-[var(--lp-danger)]'
                            : 'bg-[var(--lp-warn-soft)] text-[var(--lp-warn)]'
                      }`}
                    >
                      {payout.status === 'paid' ? 'Sent' : payout.status === 'failed' ? 'Retrying' : 'On its way'}
                    </span>
                    {/* Only once there is a real on-chain hash. A payout is marked sent as
                        soon as Circle accepts it, which is before the transaction is mined —
                        linking then would send people to an explorer page that does not exist
                        yet, which reads as the money having gone missing. */}
                    {payout.status === 'paid' && url && (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold underline-offset-2 hover:underline">
                        View receipt
                      </a>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
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
