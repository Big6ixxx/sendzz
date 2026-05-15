'use client';

import { getAdminLogs } from '@/lib/supabase/admin';
import { cn } from '@/lib/utils';
import { AdminLog, AuditLog, WebhookLog } from '@/types/admin';
import { usePrivy } from '@privy-io/react-auth';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import {
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
