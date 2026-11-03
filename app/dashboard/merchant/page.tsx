'use client';

/**
 * The Merchant dashboard.
 *
 * The retail referrals page answers "how much have I made?". Somebody who has put a community
 * behind Sendzz needs more: which month was good, which of their people are actually
 * transacting, and how far they are from the next rate. Those are what decide whether they
 * push again this month.
 *
 * --- On the chart -----------------------------------------------------------
 *
 * Earnings only, and deliberately NOT earnings-and-volume on one plot. The two are orders of
 * magnitude apart — thousands of dollars of volume against single dollars of commission — and
 * putting them on two y-axes is the most common way a chart lies: the reader compares the
 * heights, and the heights mean nothing because the scales were chosen to make them fit.
 * Volume is context, so it sits in the table underneath where it can be read honestly.
 *
 * --- On what a Merchant sees about their network ----------------------------
 *
 * Per-referee rows are anonymous and coarse. A Merchant sees that somebody joined and roughly
 * how active they are, never their email, their balance, or any individual withdrawal. The
 * referee did not agree to be reported on when they clicked a link — the aggregate is enough
 * to run a programme, and the detail would only be enough to pressure people.
 */

import { PageHeader } from '@/components/dashboard/PageHeader';
import { usePrivy } from '@privy-io/react-auth';
import { ArrowRight, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { referralsEnabled } from '@/lib/features';
import { ComingSoon } from '@/components/ComingSoon';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The single series colour: the brand green, on the forest card. Against #0b3b29 it is well
 * past 3:1 and reads as the same green as everywhere else in the cream brand.
 */
const SERIES = '#00e87a';
const MONO = 'var(--font-geist-mono), ui-monospace, monospace';

/** The chart tooltip: a white card in the page's own type, as on the admin overview. */
const TOOLTIP = {
  contentStyle: {
    backgroundColor: '#fff',
    border: 'none',
    borderRadius: 16,
    boxShadow: '0 0 0 1px rgb(17 26 19 / 0.06), 0 12px 32px -12px rgb(17 26 19 / 0.25)',
    padding: '10px 14px',
  },
  itemStyle: { color: '#111a13', fontSize: 13, fontWeight: 600 },
  labelStyle: { color: '#5b645d', fontSize: 12, marginBottom: 2 },
};

interface MonthlyPoint {
  month: string;
  volumeUsdc: number;
  earnedUsdc: number;
}

interface NetworkMember {
  ref: string;
  joinedAt: string;
  activity: 'none' | 'starting' | 'active' | 'high';
  earnedUsdc: number;
}

interface MerchantData {
  tier: 'bronze' | 'silver' | 'gold';
  tierRatePercent: number;
  monthlyVolumeUsdc: number;
  lifetimeVolumeUsdc: number;
  lifetimeEarnedUsdc: number;
  history: MonthlyPoint[];
  network: NetworkMember[];
}

const TIER_LABELS = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' } as const;

const ACTIVITY_LABELS = {
  none: 'Not yet',
  starting: 'Getting started',
  active: 'Active',
  high: 'High volume',
} as const;

const ACTIVITY_TONE = {
  none: 'bg-[var(--lp-cream)] text-[var(--lp-muted)]',
  starting: 'bg-[#fbedcc] text-[#8a5a00]',
  active: 'bg-[#cdf5de] text-[#0e7a45]',
  high: 'bg-[var(--lp-green)] text-[var(--lp-ink)]',
} as const;

function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(undefined, {
    month: 'short',
  });
}

/**
 * The gate, kept in a wrapper rather than an early return inside the component below.
 *
 * An early return before the hooks is what rules-of-hooks exists to catch, and the rule is
 * right even here: the flag happens to be a build-time constant, so the order could not
 * actually vary, but a reader has to know that to know the code is safe. A wrapper needs no
 * such argument — the real component either mounts with all its hooks or does not mount.
 */
export default function MerchantPage() {
  if (!referralsEnabled()) {
    return (
      <ComingSoon
        title="Merchants"
        body="The Merchant track pays a higher rate for bringing a community to Sendzz. It opens alongside Refer & Earn."
      />
    );
  }
  return <MerchantDashboard />;
}

function MerchantDashboard() {
  const { ready, authenticated } = usePrivy();
  const [data, setData] = useState<MerchantData | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    if (!ready || !authenticated) return;
    let cancelled = false;

    fetch('/api/referrals/merchant')
      .then(async (res) => {
        if (res.status === 403) {
          if (!cancelled) setForbidden(true);
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then((result) => {
        if (!cancelled && result) setData(result);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ready, authenticated]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1080px] space-y-6 pb-24" aria-label="Loading">
        <Skeleton tone="page" className="h-24 w-2/3 rounded-[24px]" />
        <Skeleton tone="page" className="h-80 rounded-[32px]" />
      </div>
    );
  }

  if (forbidden || !data) {
    return (
      <div className="mx-auto max-w-[1080px] space-y-6 pb-24">
        <PageHeader eyebrow="Merchant" title="Earn on" italic="your network." />
        <section className="max-w-[640px] rounded-[28px] bg-[var(--lp-sand)] p-6 sm:p-8">
          <p className="text-[16px] leading-[1.55] text-[var(--lp-body)]">
            This is for people bringing real volume: community leaders, agencies, group admins. You are not on the Merchant track yet.
          </p>
          <Link
            href="/dashboard/referrals"
            className="mt-5 inline-flex h-12 items-center gap-2 rounded-full bg-[var(--lp-ink)] px-6 text-[15px] font-semibold text-[var(--lp-cream)]"
          >
            Apply from Refer &amp; earn <ArrowRight className="size-4" />
          </Link>
        </section>
      </div>
    );
  }

  const chartData = data.history.map((point) => ({
    ...point,
    label: monthLabel(point.month),
  }));
  const hasEarnings = data.history.some((point) => point.earnedUsdc > 0);
  const whole = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <div className="mx-auto max-w-[1080px] space-y-6 pb-24 md:space-y-8">
      <PageHeader
        eyebrow="Merchant"
        title="Earn on"
        italic="your network."
        subtitle={`${TIER_LABELS[data.tier]} tier. You earn ${data.tierRatePercent}% of what your network cashes out.`}
      />

      {/* ── Earnings by month ─────────────────────────────────────────────── */}
      <section className="rounded-[32px] bg-[var(--lp-forest)] p-6 text-[var(--lp-cream)] sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="lp-mono text-[12px] uppercase text-[var(--lp-green)]">Earned all time</p>
            <p className="lp-display mt-2 text-[clamp(44px,8vw,72px)] leading-[0.9] tracking-[-0.05em] tabular-nums">
              ${data.lifetimeEarnedUsdc.toFixed(2)}
            </p>
          </div>
          <p className="max-w-[280px] text-[14px] leading-[1.5] text-[#a9c2b5]">
            What you earned, by month, in USDC. Network volume is in the table below.
          </p>
        </div>

        {hasEarnings ? (
          <div className="-ml-2 mt-6 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="rgba(246,242,233,0.08)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#a9c2b5', fontSize: 11, fontFamily: MONO }} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tick={{ fill: '#a9c2b5', fontSize: 11, fontFamily: MONO }}
                  tickFormatter={(value: number) => `$${value}`}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(246,242,233,0.06)' }}
                  contentStyle={TOOLTIP.contentStyle}
                  itemStyle={TOOLTIP.itemStyle}
                  labelStyle={TOOLTIP.labelStyle}
                  formatter={(value) => [`$${Number(value ?? 0).toFixed(2)}`, 'Earned']}
                />
                {/* Rounded data-ends, anchored to the baseline. One series, so no legend —
                    the heading names it. */}
                <Bar dataKey="earnedUsdc" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={44} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mt-6 rounded-[22px] bg-[rgba(246,242,233,0.06)] px-5 py-8 text-center text-[15px] text-[#cfe0d6]">
            Nothing yet. Earnings appear here as the people you invited cash out.
          </p>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Your numbers">
        {[
          { label: 'Tier', value: TIER_LABELS[data.tier] },
          { label: 'Your rate', value: `${data.tierRatePercent}%` },
          { label: 'Network this month', value: whole(data.monthlyVolumeUsdc) },
          { label: 'Network all time', value: whole(data.lifetimeVolumeUsdc) },
        ].map((s) => (
          <div key={s.label} className="lp-card rounded-[24px] p-5">
            <p className="text-[14px] text-[var(--lp-muted)]">{s.label}</p>
            <p className="lp-display mt-5 text-[clamp(26px,4vw,34px)] leading-none tracking-[-0.04em] tabular-nums">{s.value}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* The same figures as a table, so the chart is never the only way to read them. */}
        <section className="lp-card rounded-[28px] p-5 sm:p-6">
          <h2 className="lp-display text-[22px] tracking-[-0.02em]">Month by month</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[var(--lp-line)]">
                  <Th>Month</Th>
                  <Th align="right">Network volume</Th>
                  <Th align="right">You earned</Th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((point) => (
                  <tr key={point.month} className="border-b border-[var(--lp-line)] last:border-b-0">
                    <Td>{monthLabel(point.month)}</Td>
                    <Td align="right">{whole(point.volumeUsdc)}</Td>
                    <Td align="right" strong>
                      ${point.earnedUsdc.toFixed(2)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── The network ───────────────────────────────────────────────────── */}
        <section className="lp-card rounded-[28px] p-2">
          <div className="flex items-baseline justify-between gap-3 px-4 pb-1 pt-3">
            <h2 className="lp-display text-[22px] tracking-[-0.02em]">Your network</h2>
            <span className="text-[14px] text-[var(--lp-muted)]">
              {data.network.length} {data.network.length === 1 ? 'person' : 'people'}
            </span>
          </div>

          {data.network.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 pb-8 pt-6 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-[var(--lp-cream)]">
                <Users className="size-5" />
              </span>
              <p className="text-[15px] text-[var(--lp-muted)]">Nobody has joined with your link yet.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5 p-1">
              {data.network.map((member) => (
                <li key={member.ref} className="flex items-center gap-3 rounded-[20px] px-3 py-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--lp-sand)] text-[13px] font-semibold">
                    {member.ref.slice(-2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{member.ref}</span>
                    <span className="block text-[13px] text-[var(--lp-muted)]">
                      Joined {new Date(member.joinedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-[15px] font-semibold tabular-nums">${member.earnedUsdc.toFixed(2)}</span>
                    <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${ACTIVITY_TONE[member.activity]}`}>
                      {ACTIVITY_LABELS[member.activity]}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="px-4 pb-3 pt-1 text-[13px] leading-[1.5] text-[var(--lp-muted)]">
            People you invited are shown anonymously. You can see how active they are and what they have earned you, but not who they are or what they moved.
          </p>
        </section>
      </div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th className={`lp-mono py-2 text-[11.5px] font-normal uppercase text-[var(--lp-muted)] ${align === 'right' ? 'text-right' : ''}`}>
      {children}
    </th>
  );
}

function Td({ children, align, strong }: { children: React.ReactNode; align?: 'right'; strong?: boolean }) {
  return (
    <td className={`py-3 text-[14px] tabular-nums ${strong ? 'font-semibold' : 'text-[var(--lp-body)]'} ${align === 'right' ? 'text-right' : ''}`}>
      {children}
    </td>
  );
}
