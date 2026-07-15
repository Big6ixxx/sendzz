'use client';

import { cn } from '@/lib/utils';
import type { PublicStats } from '@/types/public';
import { Activity, TrendingUp, Users, Wallet } from 'lucide-react';
import type { ComponentType } from 'react';
import { formatUsdc } from '../shared';

function StatCard({
  title,
  value,
  desc,
  Icon,
  color,
  bg,
  loading,
}: {
  title: string;
  value: string;
  desc: string;
  Icon: ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  loading: boolean;
}) {
  return (
    <div className="card-glass relative overflow-hidden">
      <div className="flex items-start justify-between mb-4">
        <div className={cn('p-3 rounded-2xl', bg)}>
          <Icon className={cn('w-6 h-6', color)} />
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-bold text-white/50 uppercase tracking-[0.2em]">{title}</p>
        <p className="text-3xl font-display font-bold text-white tracking-tighter" aria-live="polite">
          {loading ? (
            <span className="inline-block h-9 w-24 bg-white/5 animate-pulse rounded-lg" />
          ) : (
            value
          )}
        </p>
        <p className="text-[10px] font-medium text-white/40 uppercase tracking-wider pt-1">{desc}</p>
      </div>
    </div>
  );
}

interface StatsHeroProps {
  stats: PublicStats | null;
  loading: boolean;
}

export function StatsHero({ stats, loading }: StatsHeroProps) {
  return (
    <section aria-labelledby="stats-heading">
      <h2 id="stats-heading" className="sr-only">
        Platform statistics
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total Volume"
          value={`$${formatUsdc(stats?.total_volume ?? 0)}`}
          desc="Settled USDC throughput"
          Icon={TrendingUp}
          color="text-[#00e87a]"
          bg="bg-[#00e87a]/10"
          loading={loading}
        />
        <StatCard
          title="Total Users"
          value={(stats?.total_users ?? 0).toLocaleString()}
          desc="Registered accounts"
          Icon={Users}
          color="text-blue-400"
          bg="bg-blue-400/10"
          loading={loading}
        />
        <StatCard
          title="Active (24h)"
          value={(stats?.active_users_24h ?? 0).toLocaleString()}
          desc="Unique active users"
          Icon={Activity}
          color="text-purple-400"
          bg="bg-purple-400/10"
          loading={loading}
        />
        <StatCard
          title="Transactions"
          value={(stats?.tx_count_total ?? 0).toLocaleString()}
          desc="All-time count"
          Icon={Wallet}
          color="text-amber-400"
          bg="bg-amber-400/10"
          loading={loading}
        />
      </div>
    </section>
  );
}
