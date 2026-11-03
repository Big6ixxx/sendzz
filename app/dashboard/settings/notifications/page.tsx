'use client';

import { DocBody, DocHeader, DocReadNext, DocSection } from '@/components/dashboard/DocLayout';
import { DocRows, SettingsBack, Switch } from '@/components/dashboard/SettingsKit';
import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export interface EmailNotifPrefs {
  email_notif_transfer: boolean;
  email_notif_deposit: boolean;
  email_notif_withdrawal: boolean;
  email_notif_bridge: boolean;
  email_notif_security: boolean;
  push_notif_transfer: boolean;
  push_notif_deposit: boolean;
  push_notif_withdrawal: boolean;
  push_notif_bridge: boolean;
  push_notif_security: boolean;
}

export const DEFAULT_PREFS: EmailNotifPrefs = {
  email_notif_transfer: true,
  email_notif_deposit: true,
  email_notif_withdrawal: true,
  email_notif_bridge: true,
  email_notif_security: true,
  push_notif_transfer: true,
  push_notif_deposit: true,
  push_notif_withdrawal: true,
  push_notif_bridge: true,
  push_notif_security: true,
};

interface CategoryConfig {
  id: string;
  name: string;
  desc: string;
  pushKey: keyof EmailNotifPrefs;
  emailKey: keyof EmailNotifPrefs;
}

const CATEGORIES: CategoryConfig[] = [
  { id: 'deposits', name: 'Money in', desc: 'A deposit arrives in your balance.', pushKey: 'push_notif_deposit', emailKey: 'email_notif_deposit' },
  { id: 'withdrawals', name: 'Cash outs', desc: 'A payout reaches your bank or mobile money.', pushKey: 'push_notif_withdrawal', emailKey: 'email_notif_withdrawal' },
  { id: 'transfers', name: 'Transfers', desc: 'Someone on Sendzz sends you money.', pushKey: 'push_notif_transfer', emailKey: 'email_notif_transfer' },
  { id: 'bridge', name: 'Moves between networks', desc: 'A move starts, lands, or needs you.', pushKey: 'push_notif_bridge', emailKey: 'email_notif_bridge' },
  { id: 'security', name: 'Security', desc: 'Changes to your PIN, 2FA and passkeys. Never your codes.', pushKey: 'push_notif_security', emailKey: 'email_notif_security' },
];

export default function NotificationsSettingsPage() {
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
    if (!prefs) return;
    const nextVal = !prefs[key];
    const previous = prefs;

    setPrefs({ ...prefs, [key]: nextVal });
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
        // Put the switch back. Leaving it flipped after a failed save is how someone ends up
        // believing notifications are off while they are still on.
        setPrefs(previous);
        toast.error('Failed to save preference');
      }
    } catch {
      setPrefs(previous);
      toast.error('Failed to save preference.');
    } finally {
      setIsSaving(false);
    }
  };

  const groups: { id: string; title: string; description: string; ids: string[] }[] = [
    { id: 'money', title: 'Money in and out', description: 'When money arrives, leaves, or reaches a bank.', ids: ['deposits', 'withdrawals', 'transfers'] },
    { id: 'moves', title: 'Moves between networks', description: 'Progress on money you move from one network to another.', ids: ['bridge'] },
    { id: 'security', title: 'Security', description: 'Changes to how your account is protected.', ids: ['security'] },
  ];
  const nav = [...groups.map((g) => ({ id: g.id, label: g.title })), { id: 'good-to-know', label: 'Good to know' }];

  const channel = (cat: CategoryConfig, label: 'Phone' | 'Email', key: keyof EmailNotifPrefs) => (
    <label className="flex items-center gap-2.5">
      <span className="text-[14px] font-medium text-[var(--lp-muted)]">{label}</span>
      <Switch
        label={`${cat.name} by ${label.toLowerCase()}`}
        checked={Boolean(prefs?.[key] ?? DEFAULT_PREFS[key])}
        onChange={() => handleToggle(key)}
        disabled={isSaving || !mounted}
      />
    </label>
  );

  return (
    <div className="mx-auto max-w-[1100px] space-y-8 pb-24">
      <SettingsBack />
      <DocHeader
        eyebrow="Notifications"
        title="What reaches"
        italic="you."
        lead="For each kind of activity, choose whether it pings your phone, lands in your inbox, or both. Changes save as you flip them."
      />

      <div className="pt-4 lg:pt-12">
        <DocBody items={nav}>
          {groups.map((g, i) => (
            <DocSection key={g.id} id={g.id} number={i + 1} title={g.title} description={g.description}>
              <DocRows>
                {CATEGORIES.filter((c) => g.ids.includes(c.id)).map((cat) => (
                  <div key={cat.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                    <span className="min-w-0">
                      <span className="block text-[17px] font-semibold leading-snug">{cat.name}</span>
                      <span className="mt-1 block text-[15px] leading-[1.55] text-[var(--lp-body)]">{cat.desc}</span>
                    </span>
                    <span className="flex shrink-0 gap-6">
                      {channel(cat, 'Phone', cat.pushKey)}
                      {channel(cat, 'Email', cat.emailKey)}
                    </span>
                  </div>
                ))}
              </DocRows>
            </DocSection>
          ))}

          <DocSection id="good-to-know" number={groups.length + 1} title="Good to know">
            <div className="space-y-4 text-[17px] leading-[1.65] text-[var(--lp-body)]">
              <p>Phone notifications need Sendzz installed, or notifications allowed for it in your browser.</p>
              <p>Codes for signing in and approving payments are always sent, whatever you choose here.</p>
            </div>
          </DocSection>

          <DocReadNext title="Devices" body="See everywhere you are signed in, and sign out a phone you no longer have." href="/dashboard/settings/devices" />
        </DocBody>
      </div>
    </div>
  );
}
