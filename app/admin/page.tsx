'use client';

import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getAdminAnalytics, getAdminStats } from '@/lib/supabase/admin';
import { AttentionCard, MoneyFlow, NewUsersCard, VolumeHero, type OverviewMetrics } from './components/Overview';
import { PageHeader, Pills, RefreshButton } from './components/ui';

// `all` is the server's longest window, 90 days (getAdminAnalytics), so it is named as such.
const PERIODS = { '7d': '7 days', '30d': '30 days', all: '90 days' } as const;
type Period = keyof typeof PERIODS;

const EMPTY: OverviewMetrics = {
  totalUsers: 0,
  totalVolume: 0,
  totalDeposits: 0,
  totalWithdrawals: 0,
  totalTransfers: 0,
  totalBridges: 0,
  activeUsers24h: 0,
  pendingActions: 0,
};

export default function AdminOverview() {
  const { user, getAccessToken } = usePrivy();
  const [period, setPeriod] = useState<Period>('7d');

  // `isPending` rather than `isLoading`: it is also true before the query can run (no user
  // yet), so nothing reads as "zero" or "none" before the first answer.
  const stats = useQuery({
    queryKey: ['admin-stats', user?.email?.address],
    queryFn: async () => getAdminStats((await getAccessToken()) ?? undefined),
    enabled: !!user?.email?.address,
  });

  // The last period stays on screen, dimmed, while a newly chosen one loads.
  const analytics = useQuery({
    queryKey: ['admin-analytics', user?.email?.address, period],
    queryFn: async () => getAdminAnalytics(period, (await getAccessToken()) ?? undefined),
    enabled: !!user?.email?.address,
    placeholderData: keepPreviousData,
  });

  const metrics = stats.data ?? EMPTY;
  const periodLabel = `Last ${PERIODS[period]}`;

  return (
    <div className="space-y-5 md:space-y-8">
      <PageHeader
        eyebrow="Overview"
        title="Platform,"
        italic="at a glance."
        actions={
          <>
            <Pills
              label="Period"
              options={(Object.keys(PERIODS) as Period[]).map((p) => ({ label: PERIODS[p], value: p }))}
              value={period}
              onChange={setPeriod}
            />
            <RefreshButton
              onClick={() => {
                stats.refetch();
                analytics.refetch();
              }}
              spinning={stats.isFetching || analytics.isFetching}
            />
          </>
        }
      />

      <VolumeHero
        metrics={metrics}
        statsLoading={stats.isPending}
        analytics={analytics.data}
        analyticsLoading={analytics.isPending}
        stale={analytics.isPlaceholderData}
        periodLabel={periodLabel}
      />

      <div className="grid grid-cols-1 gap-5 md:gap-6 lg:grid-cols-2">
        <NewUsersCard
          analytics={analytics.data}
          loading={analytics.isPending}
          stale={analytics.isPlaceholderData}
          periodLabel={periodLabel}
        />
        <AttentionCard pending={metrics.pendingActions} loading={stats.isPending} />
      </div>

      <MoneyFlow metrics={metrics} loading={stats.isPending} />
    </div>
  );
}
