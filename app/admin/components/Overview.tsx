'use client';

import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AnimatedNumber, EASE, Reveal } from '@/components/landing/motion';
import { cn } from '@/lib/utils';
import { ForestStat, Panel, Shimmer } from './ui';
import { formatUsd } from '@/lib/format-usdc';
import { CHART_TOOLTIP } from '@/components/dashboard/chart-tooltip';

export interface OverviewMetrics {
  totalUsers: number;
  totalVolume: number;
  totalDeposits: number;
  totalWithdrawals: number;
  totalTransfers: number;
  totalBridges: number;
  activeUsers24h: number;
  pendingActions: number;
}

export type AnalyticsPoint = { date: string; volume: number; users: number };

const compactUsd = (n: number) => `$${n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })}`;
const count = (n: number) => Math.round(n).toLocaleString('en-US');
// Dates arrive as YYYY-MM-DD, a UTC day: read them as UTC so a day never shifts by the viewer's clock.
const shortDate = (v: string | number | Date) =>
  new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const MONO = 'var(--font-geist-mono), ui-monospace, monospace';

/** Columns of varying height where a chart will be. */
function ChartShimmer({ onDark, bars = 14 }: { onDark?: boolean; bars?: number }) {
  return (
    <div className="flex h-full items-end gap-1.5 pb-6" role="status" aria-label="Loading chart">
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className={cn('flex-1 animate-pulse rounded-t-[6px]', onDark ? 'bg-[rgba(246,242,233,0.08)]' : 'bg-[rgb(var(--lp-hair)/0.1)]')}
          style={{ height: `${30 + ((i * 37) % 60)}%`, animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}

function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('lp-mono text-[12px] uppercase sm:text-[13px]', className)}>{children}</span>;
}

/* ── 01 Volume ───────────────────────────────────────────────────────────── */

/** All-time volume, large, with the chosen period drawn beside it. */
export function VolumeHero({
  metrics,
  statsLoading,
  analytics,
  analyticsLoading,
  stale,
  periodLabel,
}: {
  metrics: OverviewMetrics;
  statsLoading: boolean;
  analytics: AnalyticsPoint[] | undefined;
  analyticsLoading: boolean;
  /** Showing the previous period while the chosen one loads. */
  stale: boolean;
  periodLabel: string;
}) {
  const points = analytics ?? [];
  const total = points.reduce((sum, d) => sum + (Number(d.volume) || 0), 0);
  const average = points.length ? total / points.length : 0;
  const best = points.reduce<AnalyticsPoint | null>((b, d) => (!b || d.volume > b.volume ? d : b), null);
  const ready = !analyticsLoading && analytics !== undefined;

  return (
    <motion.section
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, ease: EASE, delay: 0.06 }}
      className="lp-on-forest overflow-hidden rounded-[28px] text-[var(--lp-cream)] md:rounded-[36px]"
    >
      <div className="grid grid-cols-1 gap-6 p-5 sm:gap-8 sm:p-8 md:p-10 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:gap-10">
        <div className="flex min-w-0 flex-col">
          <Eyebrow className="text-[var(--lp-green)]">Total volume</Eyebrow>
          <p className="lp-display mt-4 break-words text-[clamp(40px,11vw,96px)] leading-[0.9] tracking-[-0.05em] tabular-nums sm:mt-5 xl:text-[clamp(56px,5vw,88px)]">
            {statsLoading ? (
              <Shimmer onDark className="h-[0.85em] w-[4.2em]" />
            ) : (
              <AnimatedNumber value={metrics.totalVolume} format={(n) => formatUsd(n, 0)} />
            )}
          </p>
          <p className="lp-serif mt-2 text-[clamp(18px,4.6vw,28px)] text-[#cfe0d6]">moved through Sendzz, all time.</p>

          <dl className="mt-6 grid grid-cols-3 gap-2 sm:mt-8 xl:mt-auto xl:pt-10">
            {[
              { label: 'Users', value: metrics.totalUsers },
              { label: 'Active 24h', short: 'Active', value: metrics.activeUsers24h },
              { label: 'Pending', value: metrics.pendingActions },
            ].map((s) => (
              <ForestStat
                key={s.label}
                className="px-3 py-2.5 sm:px-4 sm:py-3"
                label={
                  'short' in s ? (
                    <span title={s.label}>
                      <span className="sm:hidden">{s.short}</span>
                      <span className="hidden sm:inline">{s.label}</span>
                    </span>
                  ) : (
                    s.label
                  )
                }
                value={<AnimatedNumber value={s.value} format={count} />}
                loading={statsLoading}
              />
            ))}
          </dl>
        </div>

        <div className={cn('flex min-w-0 flex-col rounded-[22px] bg-[rgba(245,244,238,0.05)] p-4 transition-opacity duration-300 sm:p-5', stale && 'opacity-60')}>
          <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <span className="lp-mono block text-[11px] uppercase text-[#a9c2b5] sm:text-[12px]">Volume · {periodLabel}</span>
              <span className="lp-display mt-1.5 block text-[clamp(22px,5.6vw,30px)] leading-none tracking-[-0.03em] tabular-nums">
                {ready ? formatUsd(total) : <Shimmer onDark className="h-[0.8em] w-[5em]" />}
              </span>
            </div>
            {ready && total > 0 && (
              <dl className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 text-[12px] sm:flex-col sm:items-end sm:text-right sm:text-[13px]">
                <div className="flex items-center gap-2">
                  <dt className="flex items-center gap-1.5 text-[#a9c2b5]">
                    <span aria-hidden className="w-4 border-t-2 border-dashed border-[rgba(246,242,233,0.55)]" /> Daily avg
                  </dt>
                  <dd className="font-semibold tabular-nums">{compactUsd(average)}</dd>
                </div>
                {best && (
                  <div className="flex items-center gap-2">
                    <dt className="text-[#a9c2b5]">Best day</dt>
                    <dd className="font-semibold tabular-nums">
                      {shortDate(best.date)} · {compactUsd(best.volume)}
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </div>

          {/* The series is drawn in currentColor, so it takes the theme's green (calmer in dark). */}
          <div className="mt-4 h-[200px] text-[var(--lp-green)] sm:h-[240px] md:h-[280px]">
            {!ready ? (
              <ChartShimmer onDark />
            ) : total === 0 ? (
              <div className="grid h-full place-items-center rounded-[18px] border border-dashed border-[rgba(246,242,233,0.15)] px-6 text-center">
                <p className="text-[15px] text-[#cfe0d6]">
                  No completed volume in this period yet.
                  <span className="mt-1 block text-[13px] text-[#a9c2b5]">Deposits, withdrawals, transfers and bridges show here once they settle.</span>
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="admin-volume" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="currentColor" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(246,242,233,0.08)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={shortDate}
                    tick={{ fill: '#a9c2b5', fontSize: 11, fontFamily: MONO }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={28}
                    padding={{ left: 12, right: 12 }}
                    tickMargin={8}
                  />
                  <YAxis
                    tickFormatter={(v: number) => `$${v.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 0 })}`}
                    tick={{ fill: '#a9c2b5', fontSize: 11, fontFamily: MONO }}
                    tickLine={false}
                    axisLine={false}
                    width={50}
                  />
                  <ReferenceLine y={average} stroke="rgba(246,242,233,0.55)" strokeDasharray="4 4" strokeWidth={1.5} />
                  <Tooltip
                    {...CHART_TOOLTIP}
                    cursor={{ stroke: 'rgba(246,242,233,0.35)', strokeWidth: 1 }}
                    labelFormatter={(v) => shortDate(v as string)}
                    formatter={(v) => [formatUsd(Number(v)), 'Volume']}
                  />
                  <Area
                    type="monotone"
                    dataKey="volume"
                    stroke="currentColor"
                    strokeWidth={2}
                    fill="url(#admin-volume)"
                    activeDot={{ r: 5, fill: 'currentColor', stroke: '#0b3b29', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  );
}

/* ── 02 New users ────────────────────────────────────────────────────────── */

export function NewUsersCard({
  analytics,
  loading,
  stale,
  periodLabel,
}: {
  analytics: AnalyticsPoint[] | undefined;
  loading: boolean;
  stale: boolean;
  periodLabel: string;
}) {
  const points = analytics ?? [];
  const joined = points.reduce((sum, d) => sum + (Number(d.users) || 0), 0);
  const busiest = points.reduce<AnalyticsPoint | null>((b, d) => (!b || d.users > b.users ? d : b), null);
  const ready = !loading && analytics !== undefined;

  return (
    <Reveal className="h-full">
      <section className={cn('lp-on-green flex h-full flex-col rounded-[28px] p-5 transition-opacity duration-300 sm:rounded-[32px] sm:p-8', stale && 'opacity-70')}>
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>New users</Eyebrow>
          <span className="lp-mono text-[11px] uppercase sm:text-[12px]">{periodLabel}</span>
        </div>
        <h2 className="lp-display mt-4 text-[clamp(28px,7vw,40px)] font-bold leading-none tracking-[-0.03em] sm:mt-5">
          {ready ? (
            <>
              <AnimatedNumber value={joined} format={count} /> <span className="lp-serif font-normal tracking-[-0.01em]">joined.</span>
            </>
          ) : (
            <Shimmer className="h-[0.85em] w-[5em]" />
          )}
        </h2>
        <p className="mt-2 min-h-[1.5em] text-[14px] sm:text-[15px]">
          {ready && joined > 0 && busiest ? (
            <>
              Busiest on <strong className="font-semibold">{shortDate(busiest.date)}</strong>, with {count(busiest.users)} new.
            </>
          ) : ready ? (
            'Nobody new in this period.'
          ) : null}
        </p>
        <div className="mt-4 h-[160px] sm:h-[180px] lg:mt-auto">
          {!ready ? (
            <ChartShimmer />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={points} margin={{ top: 4, right: 12, left: 12, bottom: 0 }}>
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDate}
                  tick={{ fill: 'currentColor', fontSize: 11, fontFamily: MONO }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                  padding={{ left: 8, right: 8 }}
                />
                <Tooltip
                  {...CHART_TOOLTIP}
                  cursor={{ fill: 'currentColor', fillOpacity: 0.08 }}
                  labelFormatter={(v) => shortDate(v as string)}
                  formatter={(v) => [count(Number(v)), 'New users']}
                />
                <Bar dataKey="users" fill="currentColor" radius={[4, 4, 0, 0]} maxBarSize={28} minPointSize={2} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>
    </Reveal>
  );
}

/* ── 03 Needs attention ──────────────────────────────────────────────────── */

export function AttentionCard({ pending, loading }: { pending: number; loading: boolean }) {
  const clear = !loading && pending === 0;

  return (
    <Reveal delay={0.06} className="h-full">
      <Panel className="flex h-full flex-col p-5 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow className="text-[var(--lp-muted)]">Needs attention</Eyebrow>
          {loading ? (
            <Shimmer className="h-6 w-20" />
          ) : (
            <span
              className={cn(
                'shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold sm:text-[13px]',
                clear ? 'bg-[var(--lp-green)]/15 text-[var(--lp-good)]' : 'bg-[var(--lp-warn-soft)] text-[var(--lp-warn)]',
              )}
            >
              {clear ? 'All clear' : 'Action needed'}
            </span>
          )}
        </div>
        <h2 className="lp-display mt-4 text-[clamp(28px,7vw,40px)] font-bold leading-none tracking-[-0.03em] sm:mt-5">
          {loading ? (
            <Shimmer className="h-[0.85em] w-[5em]" />
          ) : clear ? (
            <>
              Nothing <span className="lp-serif font-normal tracking-[-0.01em]">waiting.</span>
            </>
          ) : (
            <>
              <AnimatedNumber value={pending} format={count} /> <span className="lp-serif font-normal tracking-[-0.01em]">waiting.</span>
            </>
          )}
        </h2>
        <div className="mt-3 max-w-[400px] text-[15px] leading-[1.5] text-[var(--lp-body)] sm:text-[16px]">
          {loading ? (
            <span className="block space-y-2">
              <Shimmer className="h-3.5 w-full" />
              <Shimmer className="h-3.5 w-3/4" />
            </span>
          ) : clear ? (
            'No deposits or withdrawals are stuck in processing right now.'
          ) : (
            'Deposits and withdrawals still processing. Check none has stalled, and that no refund is owed.'
          )}
        </div>
        <div className="mt-auto flex flex-col gap-2 pt-6 sm:flex-row sm:flex-wrap">
          <Link
            href="/admin/transactions"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[var(--lp-ink)] px-5 text-[15px] font-semibold text-[var(--lp-cream)] transition-[scale] duration-150 active:scale-[0.97]"
          >
            Review transactions <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/admin/refunds"
            className="inline-flex h-12 items-center justify-center rounded-full border border-[rgb(var(--lp-hair)/0.15)] px-5 text-[15px] font-semibold transition-colors duration-150 hover:border-[var(--lp-ink)]"
          >
            Refunds owed
          </Link>
        </div>
      </Panel>
    </Reveal>
  );
}

/* ── 04 Where the money moves ────────────────────────────────────────────── */

/** Each kind of activity as a row, largest first: its amount, its share, a bar to compare by. */
export function MoneyFlow({ metrics, loading }: { metrics: OverviewMetrics; loading: boolean }) {
  const rows = [
    { name: 'Deposits', note: 'Fiat in, to USDC', value: metrics.totalDeposits },
    { name: 'Withdrawals', note: 'USDC out, to banks and mobile money', value: metrics.totalWithdrawals },
    { name: 'Transfers', note: 'Between Sendzz accounts and wallets', value: metrics.totalTransfers },
    { name: 'Bridges', note: 'Moved between networks', value: metrics.totalBridges },
  ]
    .map((r) => ({ ...r, value: Number(r.value) || 0 }))
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const net = (Number(metrics.totalDeposits) || 0) - (Number(metrics.totalWithdrawals) || 0);

  return (
    <Reveal>
      <Panel className="grid grid-cols-1 gap-x-[72px] gap-y-8 p-5 sm:gap-y-10 sm:p-[clamp(24px,5vw,56px)] md:rounded-[36px] xl:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
        <div className="min-w-0">
          <Eyebrow className="text-[var(--lp-muted)]">Breakdown</Eyebrow>
          <h2 className="lp-display mt-4 text-[clamp(32px,8vw,64px)] leading-[0.92] tracking-[-0.05em]">
            <span className="block">Where the</span>
            <span className="lp-serif block pb-[0.08em] tracking-[-0.02em]">money moves.</span>
          </h2>
          <p className="mt-4 max-w-[360px] text-[15px] leading-normal text-[var(--lp-body)] sm:mt-5 sm:text-[17px]">
            All-time volume by kind of activity, largest first.
          </p>
          <dl className="mt-6 grid grid-cols-2 gap-2 sm:mt-7 xl:grid-cols-1">
            <div className="min-w-0 rounded-[20px] bg-[var(--lp-cream)] p-4 sm:rounded-[24px] sm:p-6">
              <dt className="text-[13px] text-[var(--lp-muted)] sm:text-[14px]">Across all four</dt>
              <dd className="lp-display mt-1 truncate text-[clamp(22px,6vw,40px)] leading-none tracking-[-0.04em] tabular-nums">
                {loading ? <Shimmer className="h-[0.8em] w-[4em]" /> : <AnimatedNumber value={total} format={(n) => formatUsd(n, 0)} />}
              </dd>
            </div>
            <div className="min-w-0 rounded-[20px] bg-[var(--lp-cream)] p-4 sm:rounded-[24px] sm:p-6">
              <dt className="text-[13px] text-[var(--lp-muted)] sm:text-[14px]">Deposits minus withdrawals</dt>
              <dd
                className={cn(
                  'lp-display mt-1 truncate text-[clamp(22px,6vw,40px)] leading-none tracking-[-0.04em] tabular-nums',
                  !loading && (net >= 0 ? 'text-[var(--lp-good)]' : 'text-[var(--lp-danger)]'),
                )}
              >
                {loading ? (
                  <Shimmer className="h-[0.8em] w-[4em]" />
                ) : (
                  <AnimatedNumber value={net} format={(n) => `${n < 0 ? '−' : '+'}${formatUsd(Math.abs(n), 0)}`} />
                )}
              </dd>
            </div>
          </dl>
        </div>

        <div className="min-w-0">
          <div className="lp-mono flex justify-between gap-4 border-b border-[var(--lp-rule)] pb-3 text-[11px] uppercase text-[var(--lp-muted)] sm:text-[12px]">
            <span>Activity</span>
            <span>Volume</span>
          </div>
          <ul>
            {rows.map((r, i) => {
              const share = total > 0 ? r.value / total : 0;
              return (
                <li key={r.name} className="border-b border-[var(--lp-rule)] pb-5 pt-5 last:border-b-0 last:pb-0 sm:pb-[22px] sm:pt-6">
                  <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[16px] font-semibold leading-6 sm:text-[18px]">{r.name}</p>
                      <p className="truncate text-[12px] leading-normal text-[var(--lp-muted)] sm:text-[13px]">{r.note}</p>
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <p
                        className={cn(
                          'lp-display leading-none tracking-[-0.03em]',
                          i === 0 ? 'text-[clamp(20px,5.4vw,30px)]' : 'text-[clamp(18px,4.6vw,24px)]',
                        )}
                      >
                        {loading ? <Shimmer className="h-[0.8em] w-[4em]" /> : <AnimatedNumber value={r.value} format={(n) => formatUsd(n)} />}
                      </p>
                      <p className="lp-mono mt-1 text-[11px] text-[var(--lp-muted)] sm:text-[12px]">
                        {loading ? '' : `${(share * 100).toFixed(1)}%`}
                      </p>
                    </div>
                  </div>
                  <div
                    className="mt-3 h-[10px] overflow-hidden rounded-full bg-[var(--lp-soft)] sm:h-[14px]"
                    role="img"
                    aria-label={loading ? `${r.name}: loading` : `${r.name}: ${(share * 100).toFixed(1)}% of volume`}
                  >
                    {!loading && (
                      <motion.div
                        className="h-full rounded-full bg-[#04c96a]"
                        initial={{ width: 0 }}
                        whileInView={{ width: `${share * 100}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 1.1, ease: EASE, delay: i * 0.12 }}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </Panel>
    </Reveal>
  );
}
