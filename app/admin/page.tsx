'use client';

import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAdminAnalytics, getAdminStats } from '@/lib/supabase/admin';
import { AdminStatCards } from './components/AdminStatCards';
import { AdminCharts } from './components/AdminCharts';
import { AdminActivityBreakdown } from './components/AdminActivityBreakdown';

export default function AdminOverview() {
  const { user } = usePrivy();
  const [period, setPeriod] = useState<'7d' | '30d' | 'all'>('7d');

  const {
    data: stats,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ['admin-stats', user?.email?.address],
    queryFn: () => getAdminStats(user!.email!.address!),
    enabled: !!user?.email?.address,
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['admin-analytics', user?.email?.address, period],
    queryFn: () => getAdminAnalytics(user!.email!.address!, period),
    enabled: !!user?.email?.address,
  });

  const metrics = stats || {
    totalUsers: 0,
    totalVolume: 0,
    totalDeposits: 0,
    totalWithdrawals: 0,
    totalTransfers: 0,
    totalBridges: 0,
    activeUsers24h: 0,
    pendingActions: 0,
  };

  return (
    <div className="space-y-10 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-display font-bold text-white tracking-tight mb-2">
            Platform Overview
          </h1>
          <p className="text-white/40 font-medium">
            Monitoring real-time performance and user activity
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-white/5 p-1 rounded-xl border border-white/5">
            {(['7d', '30d', 'all'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  'px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all',
                  period === p
                    ? 'bg-white/10 text-white shadow-xl'
                    : 'text-white/30 hover:text-white',
                )}
              >
                {p}
              </button>
            ))}
          </div>
          <button
            onClick={() => refetchStats()}
            className="p-3 rounded-xl bg-white/5 border border-white/5 text-white/40 hover:text-white hover:bg-white/10 transition-all active:scale-95"
          >
            <RefreshCw
              className={cn('w-5 h-5', statsLoading && 'animate-spin')}
            />
          </button>
        </div>
      </div>

      <AdminStatCards metrics={metrics} isLoading={statsLoading} />

      <AdminCharts analytics={analytics} isLoading={analyticsLoading} />

      <AdminActivityBreakdown metrics={metrics} isLoading={statsLoading} />
    </div>
  );
}
