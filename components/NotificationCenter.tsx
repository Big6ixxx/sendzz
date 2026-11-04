'use client';

import { Bell, Check, Mail, Repeat, ShieldAlert, ArrowDownCircle, ArrowUpCircle, ChevronRight } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { brandFontVars } from '@/components/landing/fonts';

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

export function NotificationCenter({
  userEmail,
}: {
  userEmail: string;
}) {
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
    const Icon = { transfer: Mail, bridge: Repeat, deposit: ArrowDownCircle, withdrawal: ArrowUpCircle, security: ShieldAlert }[type] ?? Bell;
    return <Icon className={`size-4 ${type === 'security' ? 'text-[var(--lp-danger)]' : 'text-[var(--lp-muted)]'}`} aria-hidden />;
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
        aria-label="Notifications"
        className="relative grid size-10 place-items-center rounded-full bg-[var(--lp-surface)] text-[var(--lp-ink)] shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)] transition-[scale] duration-150 hover:bg-[var(--lp-cream)] active:scale-[0.94]"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="lp-fixed absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full border-2 border-[var(--lp-cream)] bg-[#00e87a] px-1 text-[10px] font-bold text-[var(--lp-ink)]">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Card, portalled to <body> so the sidebar's overflow can't clip it */}
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
          className={`lp-root ${brandFontVars} z-50 flex flex-col space-y-3 rounded-[24px] !bg-[var(--lp-surface)] p-4 text-[var(--lp-ink)] shadow-[0_24px_48px_-20px_rgb(17_26_19/0.35),0_0_0_1px_rgb(var(--lp-hair)/0.06)]`}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--lp-rule)] pb-2">
            <span className="text-[15px] font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="flex items-center gap-1 text-[12px] font-semibold text-[var(--lp-link)] transition-colors hover:text-[var(--lp-good)]"
              >
                <Check className="w-3 h-3" /> Mark all read
              </button>
            )}
          </div>

          {/* Notifications List (Max 5 items) */}
          <div className="flex-1 space-y-1 overflow-y-auto max-h-64 pr-1">
            {popupNotifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-[13px] text-[var(--lp-muted)]">
                <Bell className="w-6 h-6 stroke-1" />
                No notifications yet
              </div>
            ) : (
              popupNotifications.map((notif) => (
                <div
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className={`flex cursor-pointer gap-3 rounded-[16px] p-3 text-left transition-colors ${
                    notif.read ? 'text-[var(--lp-muted)] hover:bg-[var(--lp-cream)]' : 'bg-[var(--lp-cream)] text-[var(--lp-ink)] hover:bg-[var(--lp-soft)]'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">{getIcon(notif.type)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold leading-tight">{notif.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-[var(--lp-body)]">{notif.body}</p>
                    <span className="mt-1 block text-[11px] text-[var(--lp-muted)]">
                      {formatNotificationTime(notif.created_at, nowTimestamp)}
                    </span>
                  </div>
                  {!notif.read && <div className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--lp-link)]" aria-label="Unread" />}
                </div>
              ))
            )}
          </div>

          {/* Footer View All Notifications Link (Only shown when notifications exist) */}
          {popupNotifications.length > 0 && (
            <div className="shrink-0 border-t border-[var(--lp-rule)] pt-2 text-center">
              <button
                onClick={() => {
                  setIsOpen(false);
                  router.push('/dashboard/notifications');
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-full py-2 text-[13px] font-semibold text-[var(--lp-link)] transition-colors hover:bg-[var(--lp-cream)]"
              >
                View all notifications <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
