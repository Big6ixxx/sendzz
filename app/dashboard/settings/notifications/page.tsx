'use client';

import { DashboardPageHeader } from '@/components/layout/DashboardPageHeader';
import { ArrowLeft, Bell, Mail, Smartphone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface EmailPrefs {
  email_notif_transfer: boolean;
  email_notif_deposit: boolean;
  email_notif_withdrawal: boolean;
  email_notif_bridge: boolean;
  email_notif_security: boolean;
}

const DEFAULT_PREFS: EmailPrefs = {
  email_notif_transfer: true,
  email_notif_deposit: true,
  email_notif_withdrawal: true,
  email_notif_bridge: true,
  email_notif_security: true,
};

const EMAIL_PREFS_META: { key: keyof EmailPrefs; label: string; desc: string }[] = [
  { key: 'email_notif_transfer',   label: 'Transfers Received',    desc: 'Email when someone sends you USDC' },
  { key: 'email_notif_deposit',    label: 'Deposits Confirmed',     desc: 'Email when your bank deposit is credited' },
  { key: 'email_notif_withdrawal', label: 'Withdrawals Completed',  desc: 'Email when a bank withdrawal is processed' },
  { key: 'email_notif_bridge',     label: 'Bridge Completed',       desc: 'Email when a cross-chain bridge finishes' },
  { key: 'email_notif_security',   label: 'Security Alerts',        desc: 'Email on 2FA and passkey changes' },
];

interface ToggleProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  activeColor: string;
  activeBg: string;
}

function PremiumToggle({ checked, onChange, disabled, activeColor, activeBg }: ToggleProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange();
      }}
      disabled={disabled}
      className={`relative inline-flex h-[26px] w-[46px] shrink-0 cursor-pointer rounded-full border transition-all duration-300 ease-in-out focus:outline-none ${
        checked 
          ? `${activeBg} shadow-inner` 
          : 'bg-white/5 border-white/10 hover:border-white/20'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <span
        className={`pointer-events-none absolute top-[2px] left-[2px] block h-5 w-5 rounded-full transition-all duration-300 ease-in-out ${
          checked 
            ? `${activeColor} translate-x-[20px] shadow-[0_0_8px_rgba(255,255,255,0.2)]` 
            : 'bg-white/30 translate-x-0'
        }`}
      />
    </button>
  );
}

export default function NotificationsSettingsPage() {
  const router = useRouter();
  const { user } = usePrivy();
  const userEmail = user?.email?.address || '';

  // Push notification state
  const [pushEnabled, setPushEnabled] = useState(false);
  const [isTogglingPush, setIsTogglingPush] = useState(false);

  // Email preference state
  const [emailPrefs, setEmailPrefs] = useState<EmailPrefs>({ ...DEFAULT_PREFS });
  const [isSavingEmailPrefs, setIsSavingEmailPrefs] = useState(false);

  // Detect current push subscription state on mount
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => setPushEnabled(!!sub));
    });
  }, []);

  // Fetch email prefs
  useEffect(() => {
    if (!userEmail) return;
    fetch(`/api/notifications/email-prefs?email=${encodeURIComponent(userEmail)}`)
      .then((r) => r.json())
      .then((data) => { if (data.prefs) setEmailPrefs(data.prefs); })
      .catch(() => {});
  }, [userEmail]);

  const handleTogglePush = async () => {
    if (isTogglingPush) return;
    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
      toast.error('Push notifications are not supported in this browser.');
      return;
    }
    setIsTogglingPush(true);
    try {
      if (!pushEnabled) {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          toast.error('Notification permission was denied.');
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapidKey) return;
        const padding = '='.repeat((4 - vapidKey.length % 4) % 4);
        const base64 = (vapidKey + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const key = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; i++) key[i] = rawData.charCodeAt(i);
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
        await fetch('/api/notifications/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: userEmail, subscription }),
        });
        setPushEnabled(true);
        toast.success('Push notifications enabled!');
      } else {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) await subscription.unsubscribe();
        setPushEnabled(false);
        toast.success('Push notifications disabled.');
      }
    } catch {
      toast.error('Failed to update notification settings.');
    } finally {
      setIsTogglingPush(false);
    }
  };

  const handleEmailPrefToggle = async (key: keyof EmailPrefs) => {
    if (isSavingEmailPrefs) return;
    const next = { ...emailPrefs, [key]: !emailPrefs[key] };
    setEmailPrefs(next);
    setIsSavingEmailPrefs(true);
    try {
      await fetch('/api/notifications/email-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, prefs: { [key]: next[key] } }),
      });
    } catch {
      setEmailPrefs(emailPrefs); // revert on failure
      toast.error('Failed to save preference.');
    } finally {
      setIsSavingEmailPrefs(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-10">
      {/* Header with back button */}
      <div>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to Settings
        </button>
        <DashboardPageHeader
          title="Notifications"
          subtitle="Control how and when Sendzz contacts you. In-app notifications are always on."
        />
      </div>

      <div className="space-y-8">
        {/* Push Notifications */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1 flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-accent" />
            Push Notifications
          </h3>
          <div className="card-glass p-0 overflow-hidden relative">
            <div className="absolute right-0 top-0 w-40 h-40 bg-accent/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <div className="p-6 flex items-center justify-between gap-6">
              <div>
                <p className="font-bold text-foreground">Screen Alerts (Push)</p>
                <p className="text-[11px] text-muted-foreground mt-1 max-w-[340px]">
                  Receive instant alerts directly on this screen when someone sends you money, when transfers complete, or if security details change.
                </p>
                <p className="text-[11px] text-white/25 mt-2 flex items-center gap-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${pushEnabled ? 'bg-green-400' : 'bg-white/20'}`}
                  />
                  {pushEnabled ? 'Active on this device' : 'Not active on this device'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs font-black tracking-wider ${pushEnabled ? 'text-accent' : 'text-white/35'}`}>
                  {pushEnabled ? 'ON' : 'OFF'}
                </span>
                <PremiumToggle
                  checked={pushEnabled}
                  onChange={handleTogglePush}
                  disabled={isTogglingPush}
                  activeColor="bg-[#00e87a]"
                  activeBg="bg-[#00e87a]/15 border-[#00e87a]/40"
                />
              </div>
            </div>
          </div>
        </div>

        {/* In-App Notifications */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1 flex items-center gap-2">
            <Bell className="w-4 h-4 text-blue-400" />
            In-App Notifications
          </h3>
          <div className="card-glass p-6 relative overflow-hidden group hover:border-blue-400/30 transition-colors">
            <div className="absolute right-0 top-0 w-32 h-32 bg-blue-400/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 group-hover:bg-blue-400/10 transition-colors" />
            <div className="flex items-start justify-between">
              <div>
                <p className="font-bold text-foreground">Always On</p>
                <p className="text-[11px] text-muted-foreground mt-1 max-w-[360px]">
                  The notification bell in your dashboard always shows real-time activity transfers,
                  bridge completions, and security events. This cannot be disabled.
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-blue-400 bg-blue-400/10 px-2.5 py-1.5 rounded-lg shrink-0">
                <Bell className="w-3.5 h-3.5" />
                <span className="text-[10px] font-black uppercase tracking-widest">Always Active</span>
              </div>
            </div>
          </div>
        </div>

        {/* Email Notifications */}
        <div className="space-y-4">
          <div className="px-1">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Mail className="w-4 h-4 text-accent" />
              Email Notifications
            </h3>
            <p className="text-[11px] text-white/30 mt-1">
              Choose which events send an email to your inbox. All are enabled by default — toggle off
              any you don&apos;t want.
            </p>
          </div>
          <div className="card-glass p-0 overflow-hidden divide-y divide-white/4">
            {EMAIL_PREFS_META.map(({ key, label, desc }) => (
              <div key={key} className="p-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-white/80">{label}</p>
                  <p className="text-[11px] text-white/30 mt-0.5">{desc}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-black tracking-wider ${emailPrefs[key] ? 'text-accent' : 'text-white/35'}`}>
                    {emailPrefs[key] ? 'ON' : 'OFF'}
                  </span>
                  <PremiumToggle
                    checked={emailPrefs[key]}
                    onChange={() => handleEmailPrefToggle(key)}
                    disabled={isSavingEmailPrefs}
                    activeColor="bg-[#00e87a]"
                    activeBg="bg-[#00e87a]/15 border-[#00e87a]/40"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
