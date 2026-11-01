'use client';

import { getAdminLogs } from '@/lib/supabase/admin';
import { cn } from '@/lib/utils';
import { AdminLog, AuditLog, WebhookLog } from '@/types/admin';
import { usePrivy } from '@privy-io/react-auth';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { ChevronRight, Terminal, Webhook } from 'lucide-react';
import { useState } from 'react';
import { EASE } from '@/components/landing/motion';
import { EmptyState, ForestStat, PageHeader, Panel, Pills, RefreshButton, RowsShimmer, SearchField, statusTone } from '../components/ui';

import { LogDetailModal, summariseCause } from './LogDetailModal';

/** A webhook event's outcome, from its type ("payment_order.settled" → "settled") or, failing that, whether it was processed. */
function webhookOutcome(wl: WebhookLog): { label: string; tone: string } {
  const rawType = wl.event_type || '';
  const s = rawType.includes('.') ? rawType.split('.').pop() ?? '' : rawType;
  if (['settled', 'completed', 'failed', 'refunded', 'expired', 'refunding', 'validated', 'deposited'].includes(s)) {
    return { label: s === 'completed' ? 'Settled' : s.charAt(0).toUpperCase() + s.slice(1), tone: statusTone(s) };
  }
  return wl.processed ? { label: 'Processed', tone: statusTone('processed') } : { label: 'Pending', tone: statusTone('pending') };
}

const formatTimeAgo = (date: Date | null) => {
  if (!date) return 'Never';
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export default function AdminLogs() {
  const { user, getAccessToken } = usePrivy();
  const [logType, setLogType] = useState<'webhooks' | 'audit'>('webhooks');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AdminLog | null>(null);

  const { data, isPending, refetch, isRefetching } = useQuery({
    queryKey: ['admin-logs', logType, user?.email?.address],
    queryFn: async () => {
      if (!user?.email?.address) return [];
      return getAdminLogs(logType, (await getAccessToken()) ?? undefined);
    },
    enabled: !!user?.email?.address,
  });

  const logs = data || [];
  const filteredLogs = logs.filter((log) => !search || JSON.stringify(log).toLowerCase().includes(search.toLowerCase()));

  // Webhook health
  const webhookLogs = logType === 'webhooks' ? (logs as WebhookLog[]) : [];
  const lastEventTime = webhookLogs[0] ? new Date(webhookLogs[0].created_at) : null;
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const eventsLast24h = webhookLogs.filter((log) => new Date(log.created_at) >= oneDayAgo).length;
  const health: { label: string; word: string; dot: string } = !lastEventTime
    ? { label: 'No activity', word: 'Offline', dot: 'bg-[#a9c2b5]' }
    : (now.getTime() - lastEventTime.getTime()) / 3_600_000 < 24
      ? { label: 'Active and healthy', word: 'Online', dot: 'bg-[var(--lp-green)] lp-pulse' }
      : { label: 'Idle for over 24h', word: 'Warning', dot: 'bg-[#f5c451]' };

  return (
    <div className="space-y-5 md:space-y-8">
      <PageHeader
        eyebrow="Logs"
        title="System"
        italic="logs."
        aside="Webhooks from our providers and the audit trail of admin and account actions."
        actions={<RefreshButton onClick={() => refetch()} spinning={isPending || isRefetching} disabled={isPending || isRefetching} />}
      />

      <Pills
        label="Log type"
        options={[
          { label: 'Webhooks', value: 'webhooks' as const },
          { label: 'Audit logs', value: 'audit' as const },
        ]}
        value={logType}
        onChange={(t) => {
          setLogType(t);
          setSelected(null);
        }}
      />

      {logType === 'webhooks' && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
          className="grid grid-cols-1 gap-2 rounded-[28px] bg-[var(--lp-forest)] p-3 text-[var(--lp-cream)] sm:grid-cols-3 sm:p-4 md:rounded-[32px]"
        >
          {[
            {
              label: 'Webhook status',
              value: (
                <span className="flex items-center gap-2.5">
                  <span className={cn('size-2.5 shrink-0 rounded-full', health.dot)} />
                  {health.word}
                </span>
              ),
              hint: health.label,
            },
            { label: 'Last event', value: formatTimeAgo(lastEventTime), hint: lastEventTime ? format(lastEventTime, 'd MMM, HH:mm') : 'Nothing received yet' },
            {
              label: 'Events',
              value: (
                <>
                  {eventsLast24h} <span className="lp-serif text-[0.6em] text-[#cfe0d6]">today</span>
                </>
              ),
              hint: `${webhookLogs.length} loaded in total`,
            },
          ].map((s) => (
            <ForestStat key={s.label} className="rounded-[20px] px-4 py-4 sm:px-5" label={s.label} value={s.value} hint={s.hint} loading={isPending} />
          ))}
        </motion.section>
      )}

      <SearchField value={search} onChange={setSearch} placeholder="Filter by anything in the payload" />

      <Panel className="overflow-hidden">
        {isPending ? (
          <RowsShimmer rows={8} />
        ) : filteredLogs.length === 0 ? (
          <EmptyState title="No entries" italic={search ? 'match that.' : 'yet.'} body={search ? 'Try a shorter or different search.' : undefined} />
        ) : (
          <ul className="divide-y divide-[#ece6da]">
            {filteredLogs.map((log: AdminLog) => {
              const isWebhook = logType === 'webhooks';
              const outcome = isWebhook ? webhookOutcome(log as WebhookLog) : null;
              const payload = isWebhook ? (log as WebhookLog).payload_json : (log as AuditLog).metadata_json;
              // Surface the reason itself rather than the first characters of raw JSON — for a
              // failed or expired payout that one line is the whole reason an admin opened this.
              const cause = summariseCause(payload);
              return (
                <li key={log.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(log)}
                    className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-[#fbf9f4] focus:bg-[#fbf9f4] focus:outline-none sm:items-center sm:gap-4 sm:px-6"
                  >
                    <span className={cn('grid size-10 shrink-0 place-items-center rounded-full', outcome ? outcome.tone : 'bg-[#2a78d6]/10 text-[#1d5fb4]')}>
                      {isWebhook ? <Webhook className="size-[18px]" /> : <Terminal className="size-[18px]" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-semibold">{isWebhook ? (log as WebhookLog).provider : (log as AuditLog).action}</span>
                        {outcome && <span className={cn('rounded-full px-2.5 py-0.5 text-[12px] font-semibold', outcome.tone)}>{outcome.label}</span>}
                      </span>
                      <span className="lp-mono mt-0.5 block truncate text-[12px] text-[var(--lp-muted)]">
                        {isWebhook && (log as WebhookLog).event_type ? `${(log as WebhookLog).event_type} · ` : ''}
                        {format(new Date(log.created_at), 'd MMM, HH:mm:ss')}
                      </span>
                      {cause && <span className="mt-1.5 block text-[13px] text-[#8a5a00] lg:hidden">{cause}</span>}
                    </span>
                    <span className="hidden max-w-[320px] min-w-0 text-right lg:block">
                      <span className="lp-mono block text-[11px] uppercase text-[var(--lp-muted)]">{cause ? 'Reported cause' : 'Payload'}</span>
                      <span className={cn('block truncate text-[13px]', cause ? 'font-medium text-[#8a5a00]' : 'text-[var(--lp-muted)]')}>
                        {cause ?? `${JSON.stringify(payload).slice(0, 80)}…`}
                      </span>
                    </span>
                    <ChevronRight className="mt-2.5 size-4 shrink-0 text-[var(--lp-muted)] sm:mt-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <LogDetailModal log={selected} logType={logType} onClose={() => setSelected(null)} />
    </div>
  );
}
