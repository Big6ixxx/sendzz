'use client';

import { DashboardPageHeader } from '@/components/layout/DashboardPageHeader';
import {
  Bell,
  Check,
  Search,
  Mail,
  Repeat,
  ShieldAlert,
  ArrowDownCircle,
  ArrowUpCircle,
  ArrowLeft,
  ChevronRight,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';

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

  const fetchNotifications = async () => {
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
  };

  useEffect(() => {
    fetchNotifications();
  }, [userEmail]);

  const handleMarkAllRead = async () => {
    if (!userEmail) return;
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail }),
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
        body: JSON.stringify({ email: userEmail, ids: [id] }),
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

  const getIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'transfer':
        return <Mail className="w-5 h-5 text-emerald-400" />;
      case 'bridge':
        return <Repeat className="w-5 h-5 text-blue-400" />;
      case 'deposit':
        return <ArrowDownCircle className="w-5 h-5 text-green-400" />;
      case 'withdrawal':
        return <ArrowUpCircle className="w-5 h-5 text-orange-400" />;
      case 'security':
        return <ShieldAlert className="w-5 h-5 text-amber-400" />;
      default:
        return <Bell className="w-5 h-5 text-white/50" />;
    }
  };

  const formatTime = (dateStr: string) => {
    const elapsed = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Filter logic
  const filteredNotifications = useMemo(() => {
    return notifications.filter((item) => {
      // Category filter
      if (activeTab === 'withdrawal' && item.type !== 'deposit' && item.type !== 'withdrawal') return false;
      if (activeTab === 'transfer' && item.type !== 'transfer') return false;
      if (activeTab === 'bridge' && item.type !== 'bridge') return false;
      if (activeTab === 'security' && item.type !== 'security') return false;

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return item.title.toLowerCase().includes(q) || item.body.toLowerCase().includes(q);
      }
      return true;
    });
  }, [notifications, activeTab, searchQuery]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      {/* Header */}
      <div>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to Dashboard
        </button>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <DashboardPageHeader
            title="Notifications Center"
            subtitle="View all activity alerts, transfer receipts, and security updates."
          />
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="self-start sm:self-auto flex items-center gap-2 text-xs font-bold text-accent bg-accent/10 border border-accent/20 hover:bg-accent/20 px-4 py-2.5 rounded-xl transition-all"
            >
              <Check className="w-4 h-4" />
              Mark All Read ({unreadCount})
            </button>
          )}
        </div>
      </div>

      {/* Control Bar: Search & Category Tabs */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Category Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto p-1.5 rounded-2xl bg-white/3 border border-white/5 no-scrollbar">
          {[
            { id: 'all', label: 'All' },
            { id: 'withdrawal', label: 'Withdrawal' },
            { id: 'transfer', label: 'Transfers' },
            { id: 'bridge', label: 'Bridge' },
            { id: 'security', label: 'Security' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as FilterCategory)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-white/10 text-white shadow-sm border border-white/10'
                  : 'text-white/40 hover:text-white/70 hover:bg-white/5'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search Box */}
        <div className="relative md:w-64 shrink-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            type="text"
            placeholder="Search notifications..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-accent/50 transition-colors"
          />
        </div>
      </div>

      {/* Notifications List Card */}
      <div className="rounded-2xl border border-white/10 bg-[#07070a]/90 backdrop-blur-xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
        {loading ? (
          <div className="py-20 text-center text-white/30 text-xs flex flex-col items-center gap-3">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            Loading your notifications...
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="py-20 text-center text-white/30 text-xs flex flex-col items-center gap-3">
            <Bell className="w-8 h-8 stroke-1 text-white/20" />
            <p className="font-semibold text-white/50 text-sm">No notifications found</p>
            <p className="text-xs text-white/30 max-w-xs">
              {searchQuery
                ? `No notifications matching "${searchQuery}"`
                : 'You are all caught up! New alerts and transaction receipts will appear here.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filteredNotifications.map((notif) => (
              <div
                key={notif.id}
                onClick={() => handleNotificationClick(notif)}
                className={`p-5 flex items-start justify-between gap-4 cursor-pointer transition-all ${
                  notif.read
                    ? 'bg-transparent text-white/60 hover:bg-white/2'
                    : 'bg-white/4 text-white hover:bg-white/8'
                }`}
              >
                <div className="flex items-start gap-4 min-w-0">
                  {/* Category Icon */}
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                      notif.read
                        ? 'bg-white/3 border-white/5'
                        : 'bg-white/8 border-white/15 shadow-sm'
                    }`}
                  >
                    {getIcon(notif.type)}
                  </div>

                  {/* Body Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-white truncate leading-tight">
                        {notif.title}
                      </h4>
                      {!notif.read && (
                        <span className="w-2 h-2 rounded-full bg-accent shrink-0 animate-pulse" />
                      )}
                    </div>
                    <p className="text-xs text-white/50 leading-relaxed mt-1">
                      {notif.body}
                    </p>
                    <span className="text-[10px] text-white/25 mt-2 block font-mono">
                      {formatTime(notif.created_at)}
                    </span>
                  </div>
                </div>

                {/* Arrow indicator */}
                <div className="shrink-0 pt-2 text-white/20 group-hover:text-white/60 transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
