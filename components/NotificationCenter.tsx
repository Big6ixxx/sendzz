'use client';

import { Bell, Check, Mail, Repeat, ShieldAlert, ArrowDownCircle, ArrowUpCircle, ChevronRight } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
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

// Helper to convert VAPID public key for subscription
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function NotificationCenter({ userEmail }: { userEmail: string }) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const fetchNotifications = async () => {
    if (!userEmail) return;
    try {
      const res = await fetch(`/api/notifications?email=${encodeURIComponent(userEmail)}`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  };

  // 1. Poll/Fetch notifications on load and setup push subscriptions
  useEffect(() => {
    fetchNotifications();

    // Poll every 15 seconds as fallback
    const interval = setInterval(fetchNotifications, 15000);
    return () => clearInterval(interval);
  }, [userEmail]);

  // 2. Setup Web Push Notifications
  useEffect(() => {
    async function configurePush() {
      if (!userEmail || typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

      try {
        const registration = await navigator.serviceWorker.ready;
        if (!registration.pushManager) {
          console.warn('[PWA Push] Push manager not supported in this browser.');
          return;
        }

        // Check existing permission status
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          console.log('[PWA Push] Notification permission not granted.');
          return;
        }

        // Check if already subscribed
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
          const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
          if (!vapidPublicKey) {
            console.error('[PWA Push] NEXT_PUBLIC_VAPID_PUBLIC_KEY is not configured.');
            return;
          }

          const convertedKey = urlBase64ToUint8Array(vapidPublicKey);
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: convertedKey,
          });
        }

        // Send subscription payload to backend
        await fetch('/api/notifications/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: userEmail,
            subscription,
          }),
        });

        console.log('[PWA Push] Web Push configured and subscribed successfully!');
      } catch (err) {
        console.error('[PWA Push] Failed to configure push notifications:', err);
      }
    }

    configurePush();
  }, [userEmail]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
        toast.success('Marked all as read');
      }
    } catch (err) {
      console.error(err);
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
    setIsOpen(false);

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
        return <Mail className="w-4 h-4 text-green-400" />;
      case 'bridge':
        return <Repeat className="w-4 h-4 text-blue-400" />;
      case 'deposit':
        return <ArrowDownCircle className="w-4 h-4 text-emerald-400" />;
      case 'withdrawal':
        return <ArrowUpCircle className="w-4 h-4 text-orange-400" />;
      case 'security':
        return <ShieldAlert className="w-4 h-4 text-red-400" />;
      default:
        return <Bell className="w-4 h-4 text-white/50" />;
    }
  };

  const formatTime = (dateStr: string) => {
    const elapsed = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  // Display at most 5 items in the pop-up
  const popupNotifications = notifications.slice(0, 5);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2.5 rounded-xl border border-white/5 bg-white/3 hover:bg-white/8 hover:border-white/10 transition-all text-white/60 hover:text-white"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-accent text-[#07070a] font-bold text-[10px] rounded-full flex items-center justify-center animate-pulse border border-[#07070a]">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Card */}
      {isOpen && (
        <div className="absolute right-0 mt-3 w-80 max-h-96 z-50 flex flex-col p-4 space-y-3 rounded-2xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.6)] bg-[#07070a]/95 backdrop-blur-2xl">
          <div className="flex items-center justify-between border-b border-white/5 pb-2 shrink-0">
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-[10px] text-accent hover:text-accent/80 font-bold flex items-center gap-1 transition-colors"
              >
                <Check className="w-3 h-3" /> Mark all read
              </button>
            )}
          </div>

          {/* Notifications List (Max 5 items) */}
          <div className="flex-1 overflow-y-auto space-y-2 max-h-64 pr-1">
            {popupNotifications.length === 0 ? (
              <div className="py-8 text-center text-white/20 text-xs flex flex-col items-center gap-2">
                <Bell className="w-6 h-6 stroke-1" />
                No notifications yet
              </div>
            ) : (
              popupNotifications.map((notif) => (
                <div
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className={`p-3 rounded-xl border text-left cursor-pointer transition-all flex gap-3 ${
                    notif.read
                      ? 'bg-transparent border-white/3 text-white/50 hover:bg-white/2'
                      : 'bg-white/5 border-white/10 text-white hover:border-white/20 hover:bg-white/8'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                      notif.read ? 'bg-white/3' : 'bg-white/8'
                    }`}>
                      {getIcon(notif.type)}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate leading-tight">
                      {notif.title}
                    </p>
                    <p className="text-[10px] text-white/40 leading-snug mt-0.5 line-clamp-2">
                      {notif.body}
                    </p>
                    <span className="text-[9px] text-white/20 mt-1 block">
                      {formatTime(notif.created_at)}
                    </span>
                  </div>
                  {!notif.read && (
                    <div className="w-1.5 h-1.5 rounded-full bg-accent mt-2 shrink-0" />
                  )}
                </div>
              ))
            )}
          </div>

          {/* Footer View All Notifications Link (Only shown when notifications exist) */}
          {popupNotifications.length > 0 && (
            <div className="border-t border-white/5 pt-2 text-center shrink-0">
              <button
                onClick={() => {
                  setIsOpen(false);
                  router.push('/dashboard/notifications');
                }}
                className="text-xs font-bold text-accent hover:text-accent/80 flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg hover:bg-white/5 transition-all"
              >
                View All Notifications <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
