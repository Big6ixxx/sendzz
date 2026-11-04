'use client';

import { PageHeader } from '@/components/dashboard/PageHeader';
import { FilterPills, SearchField, listPill } from '@/components/dashboard/ListControls';
import { groupByDay } from '@/components/dashboard/activity-look';
import { format } from 'date-fns';
import { ArrowUpRight, CheckCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  type: 'transfer' | 'bridge' | 'deposit' | 'withdrawal' | 'security';
  read: boolean;
  data?: Record<string, unknown> | null;
  created_at: string;
}

type FilterCategory = 'all' | 'withdrawal' | 'transfer' | 'bridge' | 'security';

export default function DedicatedNotificationsPage() {
  const router = useRouter();
  const { user } = usePrivy();
  const userEmail = user?.email?.address || '';

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterCategory>('all');

  const fetchNotifications = useCallback(async () => {
    if (!userEmail) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/notifications?email=${encodeURIComponent(userEmail)}`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    } finally {
      setLoading(false);
    }
  }, [userEmail]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAllRead = async () => {
    if (!userEmail) return;
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        toast.success('All notifications marked as read');
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to mark all as read');
    }
  };

  const handleMarkItemRead = async (id: string) => {
    if (!userEmail) return;
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read: true } : n))
        );
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleNotificationClick = (notif: NotificationItem) => {
    handleMarkItemRead(notif.id);

    // Route to specific transaction detail
    const txId = (notif.data?.transactionId || notif.data?.id || notif.data?.txId) as string | undefined;
    if (txId) {
      router.push(`/dashboard/activity/${txId}`);
    } else if (typeof notif.data?.url === 'string' && notif.data.url.startsWith('/dashboard/activity/')) {
      router.push(notif.data.url);
    } else if (typeof notif.data?.url === 'string' && notif.data.url !== '/dashboard/history' && notif.data.url !== '/dashboard') {
      router.push(notif.data.url);
    } else {
      // Fallback for older notifications to open transaction details directly
      router.push(`/dashboard/activity/${notif.data?.id || notif.id}`);
    }
  };

  // Filter logic
  const filteredNotifications = useMemo(() => {
    return notifications.filter((item) => {
      if (!matchesKind(item, activeTab)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return item.title.toLowerCase().includes(q) || item.body.toLowerCase().includes(q);
      }
      return true;
    });
  }, [notifications, activeTab, searchQuery]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [activeTab, searchQuery]);

  const visible = filteredNotifications.slice(0, visibleCount);
  const groups = groupByDay(visible, (n) => n.created_at);
  const filtering = activeTab !== 'all' || searchQuery.trim() !== '';

  return (
    <div className="mx-auto max-w-[880px] space-y-6 pb-24 md:space-y-8">
      <PageHeader
        eyebrow="Notifications"
        // Nothing is claimed until the list has loaded: "All caught up" over a spinner is a guess.
        title={loading ? 'Your' : unreadCount > 0 ? `${unreadCount} new,` : 'All'}
        italic={loading ? 'notifications.' : unreadCount > 0 ? 'since you last looked.' : 'caught up.'}
        actions={
          unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="inline-flex h-12 items-center gap-2 rounded-full bg-[var(--lp-surface)] px-5 text-[15px] font-semibold shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.12)] transition-shadow hover:shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.4)]"
            >
              <CheckCheck className="size-4" /> Mark all read
            </button>
          )
        }
      />

      <div className="space-y-3">
        <SearchField value={searchQuery} onChange={setSearchQuery} placeholder="Search notifications" label="Search notifications" />
        <FilterPills
          label="Kind"
          value={activeTab}
          onChange={setActiveTab}
          options={KINDS.map((k) => ({
            ...k,
            count: notifications.filter((n) => !n.read && matchesKind(n, k.value)).length,
          }))}
        />
      </div>

      <section className="lp-card rounded-[28px] p-2">
        {loading ? (
          <ul className="flex flex-col gap-1 p-1" aria-label="Loading notifications">
            {Array.from({ length: 5 }, (_, i) => (
              <li key={i} className="space-y-2 rounded-[20px] px-4 py-4">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-3/4" />
              </li>
            ))}
          </ul>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 pb-10 pt-8 text-center">
            <p className="lp-display text-[22px] font-semibold tracking-[-0.02em]">
              {filtering ? (
                <>
                  Nothing <span className="lp-serif">matches.</span>
                </>
              ) : (
                <>
                  Nothing here <span className="lp-serif">yet.</span>
                </>
              )}
            </p>
            <p className="max-w-[320px] text-[14px] leading-[1.5] text-[var(--lp-muted)]">
              {filtering
                ? 'Try another search, or look at every kind.'
                : 'Receipts, arrivals and security alerts will show up here the moment they happen.'}
            </p>
            {filtering && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setActiveTab('all');
                }}
                className={`${listPill} mt-1 bg-[var(--lp-ink)] text-[var(--lp-cream)]`}
              >
                Show everything
              </button>
            )}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.label}>
              <h3 className="lp-mono px-4 pb-1 pt-4 text-[11.5px] uppercase text-[var(--lp-muted)] first:pt-3">{g.label}</h3>
              <ul className="flex flex-col gap-0.5 p-1">
                {g.items.map((notif) => (
                  <li key={notif.id}>
                    <button
                      type="button"
                      onClick={() => handleNotificationClick(notif)}
                      className={`group flex w-full items-start gap-3 rounded-[20px] px-3 py-3.5 text-left transition-colors hover:bg-[var(--lp-cream)] ${
                        notif.read ? '' : 'bg-[var(--lp-good-soft)]'
                      }`}
                    >
                      {/* Unread is a dot in the gutter, so read and unread rows still line up. */}
                      <span className="flex w-3 shrink-0 justify-center pt-[7px]" aria-hidden>
                        {!notif.read && <span className="size-2 rounded-full bg-[#04c96a]" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className={`truncate text-[15px] ${notif.read ? 'font-medium text-[var(--lp-body)]' : 'font-semibold'}`}>
                            {notif.title}
                          </span>
                          <span className="shrink-0 text-[13px] tabular-nums text-[var(--lp-muted)]">
                            {format(new Date(notif.created_at), 'HH:mm')}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[14px] leading-[1.5] text-[var(--lp-muted)] [overflow-wrap:anywhere]">
                          {notif.body}
                        </span>
                        <span className="lp-mono mt-2 inline-block text-[11px] uppercase text-[var(--lp-muted)]">
                          {KIND_LABEL[notif.type] ?? notif.type}
                          {!notif.read && <span className="sr-only"> · unread</span>}
                        </span>
                      </span>
                      <ArrowUpRight className="mt-1 size-4 shrink-0 text-[var(--lp-muted)] opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {!loading && filteredNotifications.length > visibleCount && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
            className={`${listPill} h-12 bg-[var(--lp-surface)] px-7 shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.12)] hover:shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.4)]`}
          >
            Show more
          </button>
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 15;

const KINDS: { value: FilterCategory; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'transfer', label: 'Transfers' },
  { value: 'withdrawal', label: 'Bank & deposits' },
  { value: 'bridge', label: 'Moves' },
  { value: 'security', label: 'Security' },
];

const KIND_LABEL: Record<NotificationItem['type'], string> = {
  transfer: 'Transfer',
  deposit: 'Deposit',
  withdrawal: 'To bank',
  bridge: 'Move between networks',
  security: 'Security',
};

/** Deposits and withdrawals share a tab: both are money crossing the bank boundary. */
function matchesKind(item: NotificationItem, kind: FilterCategory): boolean {
  if (kind === 'all') return true;
  if (kind === 'withdrawal') return item.type === 'deposit' || item.type === 'withdrawal';
  return item.type === kind;
}
