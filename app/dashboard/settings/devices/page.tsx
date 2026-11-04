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

import { DocBody, DocHeader, DocReadNext, DocSection } from '@/components/dashboard/DocLayout';
import { DocRows, RowAction, SettingsBack, SettingsRow } from '@/components/dashboard/SettingsKit';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';

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
  const current = (sessions ?? []).find((s) => s.current);

  const nav = [
    { id: "this-device", label: "This device" },
    { id: "other-devices", label: "Other devices" },
    { id: "how-it-works", label: "How signing out works" },
  ];

  return (
    <div className="mx-auto max-w-[1100px] space-y-8 pb-24">
      <SettingsBack />
      <DocHeader
        eyebrow="Devices"
        title="Where you're"
        italic="signed in."
        lead="Every phone and computer that can open your Sendzz right now. Lost one? Sign it out here and it loses access straight away."
        meta={sessions?.length ? `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"} open` : undefined}
      />

      <div className="pt-4 lg:pt-12">
        <DocBody items={nav}>
          <DocSection id="this-device" number={1} title="This device" description="The one you are using now.">
            {sessions === null ? (
              <Skeleton tone="page" className="h-24 rounded-[24px]" />
            ) : current ? (
              <div className="lp-on-forest rounded-[24px] p-6 text-[var(--lp-cream)]">
                <p className="lp-display text-[clamp(24px,4vw,32px)] leading-[1.05] tracking-[-0.03em]">{describe(current.userAgent)}</p>
                <p className="mt-3 flex items-center gap-2 text-[15px] text-[#cfe0d6]">
                  <span className="size-2 rounded-full bg-[var(--lp-green)]" aria-hidden /> Active now
                </p>
              </div>
            ) : (
              <p className="text-[17px] text-[var(--lp-body)]">We could not match this browser to a session.</p>
            )}
          </DocSection>

          <DocSection
            id="other-devices"
            number={2}
            title="Other devices"
            description={
              sessions === null
                ? undefined
                : others.length
                  ? `${others.length} other ${others.length === 1 ? "device is" : "devices are"} signed in.`
                  : "Only this device is signed in. Nothing else to worry about."
            }
          >
            {sessions === null ? (
              <DocRows>
                {[0, 1].map((i) => (
                  <div key={i} className="space-y-2 py-4">
                    <Skeleton tone="page" className="h-4 w-1/2" />
                    <Skeleton tone="page" className="h-3 w-1/3" />
                  </div>
                ))}
              </DocRows>
            ) : (
              others.length > 0 && (
                <div className="space-y-5">
                  <DocRows>
                    {others.map((s) => (
                      <SettingsRow
                        key={s.id}
                        title={describe(s.userAgent)}
                        description={`${isMobile(s.userAgent) ? "Phone or tablet" : "Computer"} · active ${timeAgo(s.lastActiveAt)}`}
                        control={
                          <RowAction tone="danger" onClick={() => void revoke({ sessionRowId: s.id }, s.id)}>
                            {busy === s.id ? "Signing out…" : "Sign out"}
                          </RowAction>
                        }
                      />
                    ))}
                  </DocRows>
                  {others.length > 1 && (
                    <button
                      type="button"
                      onClick={() => void revoke({ all: true }, "all")}
                      disabled={busy !== null}
                      className="inline-flex h-[46px] items-center rounded-full border border-[var(--lp-danger)]/35 px-[22px] text-[15px] font-semibold text-[var(--lp-danger)] transition-colors hover:bg-[var(--lp-danger-soft)] disabled:opacity-50"
                    >
                      {busy === "all" ? "Signing out…" : `Sign out all ${others.length} other devices`}
                    </button>
                  )}
                </div>
              )
            )}
          </DocSection>

          <DocSection id="how-it-works" number={3} title="How signing out works">
            <div className="space-y-4 text-[17px] leading-[1.65] text-[var(--lp-body)]">
              <p>A device you sign out loses access on its very next step. It does not wait for anything to expire.</p>
              <p>Sessions also end by themselves after a week without any sign of that device, so an old laptop in a drawer does not stay signed in forever.</p>
              <p>Signing out never touches your money. Your balance stays in your account, under your keys.</p>
            </div>
          </DocSection>

          <DocReadNext title="Fees and questions" body="What everything costs, and plain answers to what people ask most." href="/dashboard/settings/fees" />
        </DocBody>
      </div>
    </div>
  );
}
