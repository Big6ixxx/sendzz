'use client';

/**
 * Signed-in devices.
 *
 * The point of this screen is a phone someone no longer has. Seeing the list is half of it;
 * being able to end a session from a device you still hold is the other half, and that half is
 * what actually protects the money.
 *
 * Revocation takes effect on the revoked device's very next request — `getSessionUser` checks
 * `revoked_at` every time — so it does not wait for a token to expire.
 */

import { DashboardPageHeader } from '@/components/layout/DashboardPageHeader';
import { ArrowLeft, Laptop, Loader2, Smartphone, ShieldOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

interface DeviceSession {
  id: string;
  current: boolean;
  lastActiveAt: string;
  userAgent: string | null;
}

/**
 * The actual model, where the platform is willing to say.
 *
 * Android puts it in the user-agent (`SM-S918B`, `Pixel 8 Pro`), so two Android phones are
 * genuinely distinguishable. Apple does not: iOS reports only "iPhone", and the name a person
 * gave their phone is native-app-only — no web API returns it. iOS version is the only thing
 * that separates one iPhone from another here, so it stands in.
 */
function model(ua: string): string | null {
  // Third field of the Android UA parens, minus a vendor prefix and any Build/ suffix.
  const android = ua.match(/Android[\d. ]*;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?\)/i);
  if (android) {
    const name = android[1].replace(/^(SAMSUNG|HUAWEI|Xiaomi|OnePlus)\s+/i, '').trim();
    // "K" is Chrome's placeholder once it reduces the UA — no better than saying nothing.
    if (name && name !== 'K' && !/^wv$/i.test(name)) return name;
  }

  const ios = ua.match(/OS (\d+)[_.](\d+)/);
  if (ios && /iPhone|iPad|iPod/i.test(ua)) return `iOS ${ios[1]}.${ios[2]}`;

  return null;
}

/**
 * A recognisable name for a device.
 *
 * This is the whole identity of a row on this screen, so it has to mean something to someone who
 * has never heard of a user-agent string. "Pixel 8 Pro · Chrome" answers "is that me?"; an IP
 * address does not — most people have never seen their own, it changes on its own, and every
 * device on one wifi shares it.
 *
 * Deliberately coarse, and never proof: the string is self-reported and trivially spoofed. It
 * exists to help a human recognise their own device, nothing more.
 */
function describe(ua: string | null): string {
  if (!ua) return 'Unknown device';

  const kind =
    /iPhone/i.test(ua) ? 'iPhone'
    : /iPad/i.test(ua) ? 'iPad'
    : /iPod/i.test(ua) ? 'iPod'
    : /Android/i.test(ua) ? (/Mobile/i.test(ua) ? 'Android phone' : 'Android tablet')
    : /Macintosh|Mac OS/i.test(ua) ? 'Mac'
    : /CrOS/i.test(ua) ? 'Chromebook'
    : /Windows/i.test(ua) ? 'Windows PC'
    : /Linux/i.test(ua) ? 'Linux PC'
    : 'Unknown device';

  // A real model replaces the generic word outright — "Pixel 8 Pro" is more use than
  // "Android phone". An iOS version only qualifies it, since every iPhone claims to be "iPhone".
  const detail = model(ua);
  const device =
    !detail ? kind
    : detail.startsWith('iOS') ? `${kind} · ${detail}`
    : detail;

  // Order matters: Edge, Opera and Samsung Internet all also claim "Chrome", and every iOS
  // browser also claims "Safari" — so the specific ones have to be tested first or everything
  // on an iPhone reports as Safari.
  const browser =
    /Edg[A-Z]?\//i.test(ua) ? 'Edge'
    : /OPR\/|Opera/i.test(ua) ? 'Opera'
    : /SamsungBrowser\//i.test(ua) ? 'Samsung Internet'
    : /FxiOS\//i.test(ua) ? 'Firefox'
    : /CriOS\//i.test(ua) ? 'Chrome'
    : /Firefox\//i.test(ua) ? 'Firefox'
    : /Chrome\//i.test(ua) ? 'Chrome'
    : /Safari\//i.test(ua) ? 'Safari'
    : null;

  return browser ? `${device} · ${browser}` : device;
}

function isMobile(ua: string | null): boolean {
  return !!ua && /iPhone|iPad|iPod|Android/i.test(ua);
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function DevicesSettingsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/session/devices');
      if (!res.ok) throw new Error('failed');
      const data = (await res.json()) as { sessions: DeviceSession[] };
      setSessions(data.sessions);
    } catch {
      setSessions([]);
      toast.error('Could not load your devices');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (body: { sessionRowId?: string; all?: boolean }, key: string) => {
    setBusy(key);
    try {
      const res = await fetch('/api/session/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('failed');
      const { revoked } = (await res.json()) as { revoked: number };
      toast.success(revoked === 1 ? 'Device signed out' : `${revoked} devices signed out`);
      await load();
    } catch {
      toast.error('Could not sign that device out');
    } finally {
      setBusy(null);
    }
  };

  const others = (sessions ?? []).filter((s) => !s.current);

  return (
    <div className="space-y-6">
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
          title="Devices"
          subtitle="Everywhere you are signed in."
        />
      </div>

      <div className="card-glass p-4 border-white/5 flex gap-3">
        <div className="p-2 h-fit rounded-lg bg-white/5">
          <ShieldOff className="w-4 h-4 text-brand-secondary/60" />
        </div>
        <p className="text-[11px] text-white/40 leading-relaxed font-medium">
          Lost a phone? Sign it out here and it loses access immediately. Sessions also end on
          their own after a week without any sign of that device.
        </p>
      </div>

      {sessions === null ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-brand-secondary/40" />
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => {
            const Icon = isMobile(s.userAgent) ? Smartphone : Laptop;
            return (
              <div
                key={s.id}
                className="card-glass p-4 border-white/5 flex items-center gap-3"
              >
                <div className="p-2 h-fit rounded-lg bg-white/5">
                  <Icon className="w-4 h-4 text-brand-secondary/60" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-brand-secondary truncate">
                      {describe(s.userAgent)}
                    </p>
                    {s.current && (
                      <span className="text-[9px] font-bold uppercase tracking-widest text-accent shrink-0">
                        This device
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-white/35 mt-0.5">
                    Active {timeAgo(s.lastActiveAt)}
                  </p>
                </div>
                {!s.current && (
                  <button
                    onClick={() => void revoke({ sessionRowId: s.id }, s.id)}
                    disabled={busy !== null}
                    className="text-[10px] font-bold uppercase tracking-widest text-red-400 hover:text-red-300 disabled:opacity-40 shrink-0"
                  >
                    {busy === s.id ? 'Signing out…' : 'Sign out'}
                  </button>
                )}
              </div>
            );
          })}

          {others.length > 0 && (
            <button
              onClick={() => void revoke({ all: true }, 'all')}
              disabled={busy !== null}
              className="btn-secondary w-full mt-2 disabled:opacity-40"
            >
              {busy === 'all' ? 'Signing out…' : `Sign out all other devices (${others.length})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
