import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { Activity, AlertCircle, Clock, TrendingUp, Users } from 'lucide-react';

interface AdminStatCardsProps {
  metrics: {
    totalVolume: number;
    totalUsers: number;
    activeUsers24h: number;
    pendingActions: number;
  };
  isLoading: boolean;
}

export function AdminStatCards({ metrics, isLoading }: AdminStatCardsProps) {
  const cards = [
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {cards.map((stat, i) => (
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
              {isLoading ? (
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
  );
}
