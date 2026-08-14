'use client';

import { Bell, Check, Mail, Repeat, ShieldAlert, ArrowDownCircle, ArrowUpCircle, ChevronRight } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
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

// Top-level pure helper for formatting notification timestamp
function formatNotificationTime(dateStr: string, nowTimestamp: number): string {
  if (!nowTimestamp) {
    return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  const elapsed = nowTimestamp - new Date(dateStr).getTime();
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function NotificationCenter({ userEmail }: { userEmail: string }) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [nowTimestamp, setNowTimestamp] = useState<number>(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // 1. Poll/Fetch notifications on load and setup push subscriptions
  useEffect(() => {
    if (!userEmail) return;
    let isMounted = true;

    const loadNotifications = async () => {
      try {
        const res = await fetch(`/api/notifications?email=${encodeURIComponent(userEmail)}`);
        if (res.ok && isMounted) {
          const data = await res.json();
          if (isMounted) {
            setNotifications(data.notifications || []);
            setNowTimestamp(Date.now());
          }
        }
      } catch (err) {
        console.error('Failed to fetch notifications:', err);
      }
    };

    void loadNotifications();

    const interval = setInterval(loadNotifications, 15000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
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
      const target = event.target as Node;
      const inTrigger = dropdownRef.current?.contains(target);
      const inPanel = panelRef.current?.contains(target);
      if (!inTrigger && !inPanel) setIsOpen(false);
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
        body: JSON.stringify({}),
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
  const popupNotifications = notifications.slice(0, 5);

  /**
   * Position the panel in viewport coordinates.
   *
   * It's rendered through a portal rather than as a child of the bell, because one of
   * the two mount points is inside the sidebar's `overflow-y-auto`: an absolutely
   * positioned panel there gets clipped and lengthens the sidebar's scroll area instead
   * of floating above it. A portal escapes that, but then the panel no longer inherits
   * the trigger's position, so it has to be measured.
   *
   * Recomputed on scroll (capture, so ancestor scrolling counts) and on resize, since
   * fixed coordinates go stale the moment the trigger moves.
   */
  useEffect(() => {
    if (!isOpen) return;

    const PANEL_WIDTH = 320; // w-80
    const GAP = 12;

    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const width = Math.min(PANEL_WIDTH, window.innerWidth - GAP * 2);

      // Prefer growing rightwards from the trigger; flip to right-aligned if that would
      // run past the right edge. Clamp either way so it always lands on screen.
      let left = rect.left;
      if (left + width + GAP > window.innerWidth) left = rect.right - width;
      left = Math.min(Math.max(GAP, left), window.innerWidth - width - GAP);

      const top = rect.bottom + GAP;
      setPanelPos({
        top,
        left,
        width,
        maxHeight: Math.max(200, window.innerHeight - top - GAP),
      });
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Trigger */}
      <button
        ref={triggerRef}
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

      {/* Dropdown Card — portalled to <body> so the sidebar's overflow can't clip it */}
      {isOpen && panelPos && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: panelPos.top,
            left: panelPos.left,
            width: panelPos.width,
            maxHeight: Math.min(384, panelPos.maxHeight), // 384px = the old max-h-96
          }}
          className="z-50 flex flex-col p-4 space-y-3 rounded-2xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.6)] bg-[#07070a]/95 backdrop-blur-2xl"
        >
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
                      {formatNotificationTime(notif.created_at, nowTimestamp)}
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
        </div>,
        document.body,
      )}
    </div>
  );
}
