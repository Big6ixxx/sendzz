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

import { DashboardPageHeader } from '@/components/layout/DashboardPageHeader';
import { usePrivy } from '@privy-io/react-auth';
import { Loader2, Users } from 'lucide-react';
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

/**
 * The single series colour.
 *
 * NOT the brand accent (#00e87a), which sits at L 0.816 — too light for a data mark on this
 * near-black surface, where it glares rather than reads. This is the same hue stepped down
 * until it passes the categorical lightness band and 3:1 against the surface. Validated, not
 * eyeballed.
 */
const SERIES = '#0aa85a';

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

function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(undefined, {
    month: 'short',
  });
}

export default function MerchantPage() {
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
      <div className="h-[50vh] flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-brand-secondary/25" />
      </div>
    );
  }

  if (forbidden || !data) {
    return (
      <div className="space-y-6 max-w-2xl">
        <DashboardPageHeader
          title="Merchant"
          subtitle="Earn a share of the fees your network generates"
        />
        <div className="card-glass p-8 space-y-3">
          <p className="text-sm text-brand-secondary/70 leading-relaxed">
            This is for people bringing real volume — community leaders, agencies, group
            admins. You are not on the Merchant track yet.
          </p>
          <a href="/dashboard/referrals" className="btn-primary inline-flex">
            Apply from Refer &amp; Earn
          </a>
        </div>
      </div>
    );
  }

  const chartData = data.history.map((point) => ({
    ...point,
    label: monthLabel(point.month),
  }));
  const hasEarnings = data.history.some((point) => point.earnedUsdc > 0);

  return (
    <div className="space-y-8 max-w-4xl">
      <DashboardPageHeader
        title="Merchant"
        subtitle={`${TIER_LABELS[data.tier]} — you earn ${data.tierRatePercent}% of what your network cashes out`}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Tier" value={TIER_LABELS[data.tier]} />
        <Stat label="Your rate" value={`${data.tierRatePercent}%`} />
        <Stat
          label="Network this month"
          value={`$${data.monthlyVolumeUsdc.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        />
        <Stat label="Earned all time" value={`$${data.lifetimeEarnedUsdc.toFixed(2)}`} />
      </div>

      {/* ── Earnings by month ─────────────────────────────────────────────── */}
      <div className="card-glass p-6 space-y-5">
        <div>
          <h2 className="font-bold text-brand-secondary">What you earned, by month</h2>
          <p className="text-[12px] text-brand-secondary/40 mt-0.5">
            Commission in USDC. Network volume is in the table below.
          </p>
        </div>

        {hasEarnings ? (
          <div className="h-56 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.05)"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  stroke="rgba(255,255,255,0.2)"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                />
                <YAxis
                  stroke="rgba(255,255,255,0.2)"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  width={48}
                  tickFormatter={(value: number) => `$${value}`}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{
                    background: 'rgba(10,10,11,0.92)',
                    backdropFilter: 'blur(16px)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 14,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: 'rgba(248,248,246,0.55)' }}
                  formatter={(value) => [`$${Number(value ?? 0).toFixed(2)}`, 'Earned']}
                />
                {/* Rounded data-ends, anchored to the baseline. One series, so no legend —
                    the heading names it. */}
                <Bar dataKey="earnedUsdc" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={44} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-brand-secondary/40 py-8 text-center">
            Nothing yet. Earnings appear here as the people you invited cash out.
          </p>
        )}

        {/* The same figures as a table, so the chart is never the only way to read them. */}
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/5">
                <Th>Month</Th>
                <Th align="right">Network volume</Th>
                <Th align="right">You earned</Th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((point) => (
                <tr key={point.month} className="border-b border-white/[0.03]">
                  <Td>{monthLabel(point.month)}</Td>
                  <Td align="right">
                    ${point.volumeUsdc.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </Td>
                  <Td align="right">${point.earnedUsdc.toFixed(2)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── The network ───────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="text-xs font-bold uppercase tracking-widest text-brand-secondary/35">
            Your network
          </h2>
          <p className="text-[11px] text-brand-secondary/30">
            {data.network.length} {data.network.length === 1 ? 'person' : 'people'}
          </p>
        </div>

        {data.network.length === 0 ? (
          <div className="card-glass p-10 text-center space-y-3">
            <Users className="w-7 h-7 mx-auto text-brand-secondary/20" />
            <p className="text-sm text-brand-secondary/40">
              Nobody has joined with your link yet.
            </p>
          </div>
        ) : (
          <div className="card-glass p-0 overflow-hidden divide-y divide-white/5">
            {data.network.map((member) => (
              <div
                key={member.ref}
                className="p-4 px-5 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-brand-secondary text-[13.5px]">
                    {member.ref}
                  </p>
                  <p className="text-[11.5px] text-brand-secondary/35">
                    Joined{' '}
                    {new Date(member.joinedAt).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-5 shrink-0">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-brand-secondary/35">
                    {ACTIVITY_LABELS[member.activity]}
                  </span>
                  <span className="font-bold text-brand-secondary tabular-nums">
                    ${member.earnedUsdc.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11.5px] text-brand-secondary/30 px-1 leading-relaxed">
          People you invited are shown anonymously. You can see how active they are and what
          they have earned you — not who they are or what they moved.
        </p>
      </div>
    </div>
  );
}

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

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      className={`py-2 text-[10px] font-bold uppercase tracking-[0.15em] text-brand-secondary/30 ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <td
      className={`py-2.5 text-[13px] text-brand-secondary/70 tabular-nums ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      {children}
    </td>
  );
}
