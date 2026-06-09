'use client';

import { getAdminLogs } from '@/lib/supabase/admin';
import { cn } from '@/lib/utils';
import { AdminLog, AuditLog, WebhookLog } from '@/types/admin';
import { usePrivy } from '@privy-io/react-auth';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import {
  Activity,
  Clock,
  Code2,
  RefreshCw,
  Search,
  Terminal,
  UserCheck,
  Webhook,
} from 'lucide-react';
import { useState } from 'react';

export default function AdminLogs() {
  const { user } = usePrivy();
  const [logType, setLogType] = useState<'webhooks' | 'audit'>('webhooks');
  const [search, setSearch] = useState('');

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['admin-logs', logType, user?.email?.address],
    queryFn: async () => {
      if (!user?.email?.address) return [];
      return getAdminLogs(user.email.address, logType);
    },
    enabled: !!user?.email?.address,
  });

  const logs = data || [];

  const filteredLogs = logs.filter((log) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    const content = JSON.stringify(log).toLowerCase();
    return content.includes(searchLower);
  });

  // Calculate Webhook Health Stats
  const webhookLogs = logType === 'webhooks' ? (logs as WebhookLog[]) : [];
  const totalEvents = webhookLogs.length;
  const lastEvent = webhookLogs[0];
  const lastEventTime = lastEvent ? new Date(lastEvent.created_at) : null;

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const eventsLast24h = webhookLogs.filter(
    (log) => new Date(log.created_at) >= oneDayAgo,
  ).length;

  let healthStatus: 'healthy' | 'idle' | 'inactive' = 'inactive';
  let healthLabel = 'No Activity';
  let healthColor = 'text-white/40 border-white/10 bg-white/5';

  if (lastEventTime) {
    const hoursSinceLastEvent = (now.getTime() - lastEventTime.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastEvent < 24) {
      healthStatus = 'healthy';
      healthLabel = 'Active & Healthy';
      healthColor = 'text-accent border-accent/20 bg-accent/10';
    } else {
      healthStatus = 'idle';
      healthLabel = 'Idle (> 24h)';
      healthColor = 'text-amber-400 border-amber-500/20 bg-amber-500/10';
    }
  }

  const formatTimeAgo = (date: Date | null) => {
    if (!date) return 'Never';
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-display font-bold text-white tracking-tight">
            System Logs
          </h1>
          <p className="text-white/40 mt-1 font-medium">
            Monitoring internal operations and external webhooks.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => refetch()}
            disabled={isLoading || isRefetching}
            className="p-3 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white transition-colors"
          >
            <RefreshCw
              className={cn(
                'w-4 h-4',
                (isLoading || isRefetching) && 'animate-spin',
              )}
            />
          </button>
        </div>
      </div>

      {/* Webhook Health Cards */}
      {logType === 'webhooks' && !isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="card-glass p-6 flex items-center justify-between border border-white/5">
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">
                Webhook Status
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={cn(
                    'w-2.5 h-2.5 rounded-full animate-pulse',
                    healthStatus === 'healthy'
                      ? 'bg-accent shadow-[0_0_8px_var(--color-accent)]'
                      : healthStatus === 'idle'
                        ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]'
                        : 'bg-white/25',
                  )}
                />
                <span className="text-sm font-bold text-white tracking-tight">
                  {healthLabel}
                </span>
              </div>
            </div>
            <div
              className={cn(
                'px-3 py-1.5 rounded-lg border text-[10px] font-black uppercase tracking-wider',
                healthColor,
              )}
            >
              {healthStatus === 'healthy'
                ? 'Online'
                : healthStatus === 'idle'
                  ? 'Warning'
                  : 'Offline'}
            </div>
          </div>

          <div className="card-glass p-6 flex items-center justify-between border border-white/5">
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">
                Last Event Received
              </p>
              <p className="text-sm font-bold text-white tracking-tight mt-1">
                {formatTimeAgo(lastEventTime)}
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40">
              <Clock className="w-5 h-5" />
            </div>
          </div>

          <div className="card-glass p-6 flex items-center justify-between border border-white/5">
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">
                Events (Last 24h / Total)
              </p>
              <p className="text-sm font-bold text-white tracking-tight mt-1">
                {eventsLast24h}{' '}
                <span className="text-white/40 font-normal">/ {totalEvents}</span>
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40">
              <Activity className="w-5 h-5" />
            </div>
          </div>
        </div>
      )}

      {/* Type Switch & Search */}
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex p-1 bg-white/5 border border-white/10 rounded-2xl w-fit">
          <button
            onClick={() => setLogType('webhooks')}
            className={cn(
              'flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all',
              logType === 'webhooks'
                ? 'bg-white/10 text-white shadow-xl'
                : 'text-white/30 hover:text-white/60',
            )}
          >
            <Webhook className="w-4 h-4" />
            Webhooks
          </button>
          <button
            onClick={() => setLogType('audit')}
            className={cn(
              'flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all',
              logType === 'audit'
                ? 'bg-white/10 text-white shadow-xl'
                : 'text-white/30 hover:text-white/60',
            )}
          >
            <UserCheck className="w-4 h-4" />
            Audit Logs
          </button>
        </div>

        <div className="relative flex-1 group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20 group-focus-within:text-accent transition-colors" />
          <input
            type="text"
            placeholder="Filter log payload or content..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl pl-12 pr-4 text-sm text-white focus:outline-none focus:border-accent/50 transition-all"
          />
        </div>
      </div>

      {/* Logs Feed */}
      <div className="space-y-4">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-20 bg-white/5 rounded-2xl animate-pulse"
            />
          ))
        ) : filteredLogs.length === 0 ? (
          <div className="py-20 text-center card-glass">
            <p className="text-white/20 font-medium">No log entries found.</p>
          </div>
        ) : (
          filteredLogs.map((log: AdminLog, i: number) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="card-glass p-5 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:bg-white/6 transition-all group"
            >
              <div className="flex items-center gap-5">
                <div
                  className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center border',
                    logType === 'webhooks'
                      ? (log as WebhookLog).processed
                        ? 'bg-accent/10 border-accent/20 text-accent'
                        : 'bg-amber-400/10 border-amber-400/20 text-amber-400'
                      : 'bg-blue-400/10 border-blue-400/20 text-blue-400',
                  )}
                >
                  {logType === 'webhooks' ? (
                    <Webhook className="w-5 h-5" />
                  ) : (
                    <Terminal className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h4 className="text-sm font-bold text-white tracking-tight">
                      {logType === 'webhooks'
                        ? (log as WebhookLog).provider
                        : (log as AuditLog).action}
                    </h4>
                    {logType === 'webhooks' && (
                      <span
                        className={cn(
                          'text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full',
                          (log as WebhookLog).processed
                            ? 'bg-accent/10 text-accent'
                            : 'bg-amber-400/10 text-amber-400',
                        )}
                      >
                        {(log as WebhookLog).processed
                          ? 'Processed'
                          : 'Pending'}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] font-mono text-white/20 mt-1 uppercase tracking-widest">
                    ID: {log.id.slice(0, 16)}... •{' '}
                    {format(new Date(log.created_at), 'HH:mm:ss.SSS')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="hidden lg:block">
                  <p className="text-[10px] font-bold text-white/20 uppercase tracking-[0.2em] mb-1">
                    Payload Insight
                  </p>
                  <p className="text-[10px] text-white/40 truncate max-w-[200px] italic">
                    {JSON.stringify(
                      logType === 'webhooks'
                        ? (log as WebhookLog).payload_json
                        : (log as AuditLog).metadata_json,
                    ).slice(0, 100)}
                    ...
                  </p>
                </div>
                <button className="p-3 rounded-xl bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10 transition-all">
                  <Code2 className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>

      <div className="flex items-center justify-center py-10">
        <p className="text-[10px] font-bold text-white/10 uppercase tracking-[0.5em]">
          End of Log Stream
        </p>
      </div>
    </div>
  );
}
