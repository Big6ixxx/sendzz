'use client';

import { DashboardPageHeader } from '@/components/layout/DashboardPageHeader';
import { ArrowLeft, Mail, Smartphone, Wallet, Repeat, ShieldAlert, Sparkles, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export interface EmailNotifPrefs {
  email_notif_transfer: boolean;
  email_notif_deposit: boolean;
  email_notif_withdrawal: boolean;
  email_notif_bridge: boolean;
  email_notif_security: boolean;
  email_notif_system: boolean;
  push_notif_transfer: boolean;
  push_notif_wallet: boolean;
  push_notif_bridge: boolean;
  push_notif_security: boolean;
  push_notif_system: boolean;
}

export const DEFAULT_PREFS: EmailNotifPrefs = {
  email_notif_transfer: true,
  email_notif_deposit: true,
  email_notif_withdrawal: true,
  email_notif_bridge: true,
  email_notif_security: true,
  email_notif_system: true,
  push_notif_transfer: true,
  push_notif_wallet: true,
  push_notif_bridge: true,
  push_notif_security: true,
  push_notif_system: true,
};

interface ToggleProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}

function MatrixToggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange();
      }}
      disabled={disabled}
      className={`relative inline-flex h-[24px] w-[44px] shrink-0 cursor-pointer rounded-full border transition-all duration-300 ease-in-out focus:outline-none ${
        checked
          ? 'bg-accent border-accent shadow-[0_0_14px_rgba(0,232,122,0.4)]'
          : 'bg-white/10 border-white/10 hover:border-white/20'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <span
        className={`pointer-events-none absolute top-[2px] left-[2px] block h-4 w-4 rounded-full transition-all duration-300 ease-in-out ${
          checked
            ? 'bg-[#07070a] translate-x-[20px] shadow-md'
            : 'bg-white/40 translate-x-0'
        }`}
      />
    </button>
  );
}

interface CategoryConfig {
  id: string;
  name: string;
  desc: string;
  icon: React.ReactNode;
  pushKey: keyof EmailNotifPrefs;
  emailKey: keyof EmailNotifPrefs;
}

const CATEGORIES: CategoryConfig[] = [
  {
    id: 'wallet',
    name: 'Wallet Activity',
    desc: 'Deposits, withdrawals, and payouts',
    icon: <Wallet className="w-5 h-5 text-blue-400" />,
    pushKey: 'push_notif_wallet',
    emailKey: 'email_notif_withdrawal',
  },
  {
    id: 'transfers',
    name: 'Transfers & Claims',
    desc: 'Direct transfers, claim links, and funds received',
    icon: <Send className="w-5 h-5 text-emerald-400" />,
    pushKey: 'push_notif_transfer',
    emailKey: 'email_notif_transfer',
  },
  {
    id: 'bridge',
    name: 'Cross-Chain Bridge',
    desc: 'Bridge status, execution, and completions',
    icon: <Repeat className="w-5 h-5 text-purple-400" />,
    pushKey: 'push_notif_bridge',
    emailKey: 'email_notif_bridge',
  },
  {
    id: 'security',
    name: 'Security Alerts',
    desc: '2FA updates, passkeys, and account security',
    icon: <ShieldAlert className="w-5 h-5 text-amber-400" />,
    pushKey: 'push_notif_security',
    emailKey: 'email_notif_security',
  },
];

export default function NotificationsSettingsPage() {
  const router = useRouter();
  const { user } = usePrivy();
  const userEmail = user?.email?.address || '';

  const [mounted, setMounted] = useState(false);
  const [prefs, setPrefs] = useState<EmailNotifPrefs>({ ...DEFAULT_PREFS });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch notification prefs defensively
  useEffect(() => {
    if (!userEmail) return;
    let active = true;
    fetch(`/api/notifications/email-prefs?email=${encodeURIComponent(userEmail)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        if (data && data.prefs && typeof data.prefs === 'object') {
          setPrefs((prev) => ({ ...prev, ...data.prefs }));
        }
      })
      .catch((err) => {
        console.error('Failed to load notification preferences:', err);
      });
    return () => {
      active = false;
    };
  }, [userEmail]);

  const handleToggle = async (key: keyof EmailNotifPrefs) => {
    if (isSaving || !prefs) return;
    const currentVal = Boolean(prefs[key] ?? DEFAULT_PREFS[key]);
    const nextVal = !currentVal;
    const nextPrefs = { ...prefs, [key]: nextVal };
    
    setPrefs(nextPrefs);
    setIsSaving(true);

    try {
      const res = await fetch('/api/notifications/email-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, prefs: { [key]: nextVal } }),
      });
      if (res.ok) {
        toast.success('Preference updated');
      } else {
        toast.error('Failed to save preference');
      }
    } catch {
      toast.error('Failed to save preference.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!mounted) {
    return (
      <div className="max-w-5xl mx-auto py-12 text-center text-white/30 text-xs">
        Loading preferences...
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header with back button */}
      <div>
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to Settings
        </button>
        <DashboardPageHeader
          title="Notification Preferences"
          subtitle="Manage your notification channels per category."
        />
      </div>

      {/* Preferences Matrix Card */}
      <div className="relative rounded-2xl border border-white/10 bg-[#07070a]/90 backdrop-blur-xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
        {/* Table Header */}
        <div className="grid grid-cols-12 items-center px-6 py-4 border-b border-white/10 bg-white/2 text-[11px] font-bold uppercase tracking-widest text-white/50">
          <div className="col-span-6 sm:col-span-8">Category</div>
          <div className="col-span-3 sm:col-span-2 flex items-center justify-center gap-1.5 text-center">
            <Smartphone className="w-3.5 h-3.5" />
            <span>Push / In-App</span>
          </div>
          <div className="col-span-3 sm:col-span-2 flex items-center justify-center gap-1.5 text-center">
            <Mail className="w-3.5 h-3.5" />
            <span>Email</span>
          </div>
        </div>

        {/* Matrix Category Rows */}
        <div className="divide-y divide-white/5">
          {CATEGORIES.map((cat) => {
            const pushVal = Boolean(prefs?.[cat.pushKey] ?? DEFAULT_PREFS[cat.pushKey]);
            const emailVal = Boolean(prefs?.[cat.emailKey] ?? DEFAULT_PREFS[cat.emailKey]);

            return (
              <div
                key={cat.id}
                className="grid grid-cols-12 items-center px-6 py-5 hover:bg-white/2 transition-colors gap-4"
              >
                {/* Category Info */}
                <div className="col-span-6 sm:col-span-8 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                    {cat.icon}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white leading-tight">
                      {cat.name}
                    </h4>
                    <p className="text-xs text-white/40 mt-0.5">
                      {cat.desc}
                    </p>
                  </div>
                </div>

                {/* Push Toggle */}
                <div className="col-span-3 sm:col-span-2 flex items-center justify-center">
                  <MatrixToggle
                    checked={pushVal}
                    onChange={() => handleToggle(cat.pushKey)}
                    disabled={isSaving}
                  />
                </div>

                {/* Email Toggle */}
                <div className="col-span-3 sm:col-span-2 flex items-center justify-center">
                  <MatrixToggle
                    checked={emailVal}
                    onChange={() => handleToggle(cat.emailKey)}
                    disabled={isSaving}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
