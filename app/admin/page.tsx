'use client';

import { cn } from '@/lib/utils';
import { usePrivy } from '@privy-io/react-auth';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Activity,
  AlertCircle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  Clock,
  Link as LinkIcon,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { getAdminAnalytics, getAdminStats } from '@/lib/supabase/admin';

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

  const statCards = [
    {
      title: 'Total Volume',
      value: `$${metrics.totalVolume.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      desc: 'Cumulative transaction throughput',
      icon: TrendingUp,
      color: 'text-[#00e87a]',
      bg: 'bg-[#00e87a]/10',
    },
    {
      title: 'Platform Users',
      value: metrics.totalUsers.toLocaleString(),
      desc: 'Total registered smart accounts',
      icon: Users,
      color: 'text-blue-400',
      bg: 'bg-blue-400/10',
    },
    {
      title: 'Active (24h)',
      value: metrics.activeUsers24h.toLocaleString(),
      desc: 'Unique users with activity',
      icon: Activity,
      color: 'text-purple-400',
      bg: 'bg-purple-400/10',
    },
    {
      title: 'Pending Actions',
      value: metrics.pendingActions.toLocaleString(),
      desc: 'Deposits/Withdrawals awaiting processing',
      icon: Clock,
      color: 'text-amber-400',
      bg: 'bg-amber-400/10',
      alert: metrics.pendingActions > 0,
    },
  ];

  const subMetrics = [
    {
      label: 'Deposits',
      value: metrics.totalDeposits || 0,
      color: '#00e87a',
    },
    {
      label: 'Withdrawals',
      value: metrics.totalWithdrawals || 0,
      color: '#f87171', // red-400
    },
    {
      label: 'Transfers',
      value: metrics.totalTransfers || 0,
      color: '#60a5fa', // blue-400
    },
    {
      label: 'Bridges',
      value: (metrics as any).totalBridges || 0,
      color: '#a855f7', // purple-500
    },
  ];

  const totalBreakdown = subMetrics.reduce((acc, curr) => acc + (Number(curr.value) || 0), 0);
  
  const chartData = subMetrics.map(m => ({
    name: m.label,
    value: Number(m.value) || 0,
    color: m.color
  })).filter(d => d.value > 0);

  // Fallback for empty state
  const displayData = chartData.length > 0 ? chartData : [{ name: 'No Data', value: 1, color: 'rgba(255,255,255,0.05)' }];

  return (
    <div className="space-y-10 pb-20">
      {/* Header */}
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

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat, i) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="card-glass relative overflow-hidden group"
          >
            {stat.alert && (
              <div className="absolute top-0 right-0 p-2">
                <AlertCircle className="w-5 h-5 text-amber-400 animate-pulse" />
              </div>
            )}
            <div className="flex items-start justify-between mb-4">
              <div className={cn('p-3 rounded-2xl', stat.bg)}>
                <stat.icon className={cn('w-6 h-6', stat.color)} />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-bold text-white/30 uppercase tracking-[0.2em]">
                {stat.title}
              </p>
              <h3 className="text-3xl font-display font-bold text-white tracking-tighter">
                {statsLoading ? (
                  <div className="h-9 w-24 bg-white/5 animate-pulse rounded-lg" />
                ) : (
                  stat.value
                )}
              </h3>
              <p className="text-[10px] font-medium text-white/20 uppercase tracking-wider pt-1">
                {stat.desc}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
      
      {/* Analytics Charts */}
      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-white/30" />
              <h3 className="text-xs font-bold text-white/40 uppercase tracking-[0.2em]">
                Transaction Volume
              </h3>
            </div>
            <div className="flex items-center gap-4 text-[10px] font-bold text-white/20 uppercase tracking-widest">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-accent" />
                Volume (USDC)
              </div>
            </div>
          </div>

          <div className="card-glass p-8 h-[400px]">
            {analyticsLoading ? (
              <div className="w-full h-full flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-white/10 animate-spin" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analytics || []}>
                  <defs>
                    <linearGradient
                      id="colorVolume"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor="#00e87a" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#00e87a" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.05)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    stroke="rgba(255,255,255,0.2)"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val: string | number | Date) =>
                      new Date(val).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })
                    }
                  />
                  <YAxis
                    stroke="rgba(255,255,255,0.2)"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val: number) => `$${val}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(10,10,10,0.9)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '12px',
                    }}
                    itemStyle={{
                      color: '#fff',
                      fontSize: '12px',
                      fontWeight: 'bold',
                    }}
                    labelStyle={{
                      color: 'rgba(255,255,255,0.4)',
                      fontSize: '10px',
                      marginBottom: '4px',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="volume"
                    stroke="#00e87a"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorVolume)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* User Growth */}
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-white/30" />
            <h3 className="text-xs font-bold text-white/40 uppercase tracking-[0.2em]">
              User Onboarding
            </h3>
          </div>
          <div className="card-glass p-8 h-[400px]">
            {analyticsLoading ? (
              <div className="w-full h-full flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-white/10 animate-spin" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics || []}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.05)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    stroke="rgba(255,255,255,0.2)"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val: string | number | Date) =>
                      new Date(val).toLocaleDateString(undefined, {
                        day: 'numeric',
                      })
                    }
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                    contentStyle={{
                      backgroundColor: 'rgba(10,10,10,0.9)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '12px',
                    }}
                  />
                  <Bar dataKey="users" fill="#60a5fa" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Activity Breakdown */}
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-white/30" />
          <h3 className="text-xs font-bold text-white/40 uppercase tracking-[0.2em]">
            Activity Breakdown
          </h3>
        </div>
        <div className="card-glass p-8 lg:p-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="h-[320px] relative">
              {statsLoading ? (
                <div className="w-full h-full flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-white/10" />
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={displayData}
                      cx="50%"
                      cy="50%"
                      innerRadius={80}
                      outerRadius={120}
                      paddingAngle={5}
                      dataKey="value"
                      stroke="none"
                    >
                      {displayData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'rgba(10,10,10,0.9)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '12px',
                      }}
                      itemStyle={{ color: '#fff', fontSize: '12px', fontWeight: 'bold' }}
                      formatter={(value: any) => [`$${Number(value).toLocaleString()}`, 'Volume']}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
              {/* Center Text */}
              {!statsLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <p className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Total</p>
                  <p className="text-xl font-display font-bold text-white tracking-tight">
                    ${totalBreakdown.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-4">
              {subMetrics.map((item) => {
                const val = (metrics as any)[`total${item.label}`] || 0;
                const percentage = totalBreakdown > 0 ? (val / totalBreakdown) * 100 : 0;
                
                return (
                  <div key={item.label} className="group p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: item.color.startsWith('#') ? item.color : '' }}
                        />
                        <span className="text-sm font-bold text-white/60 group-hover:text-white transition-colors">
                          {item.label}
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-white">
                          ${val.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </p>
                        <p className="text-[10px] font-medium text-white/20 uppercase tracking-widest">
                          {percentage.toFixed(1)}% share
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Loader2({ className }: { className?: string }) {
  return (
    <svg
      className={cn('animate-spin', className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      ></circle>
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      ></path>
    </svg>
  );
}
