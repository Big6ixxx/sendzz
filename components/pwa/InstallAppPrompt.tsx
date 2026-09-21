"use client";

/**
 * The unasked-for offer to install Sendzz, on the landing page.
 *
 * Distinct from InstallAppButton, which sits in Settings and answers someone who went looking.
 * Nobody goes looking on their first visit, so this one interrupts — and an interruption has to
 * earn itself. Three rules keep it honest:
 *
 *   It waits.       DELAY_MS of reading before it appears. A prompt on arrival is asking
 *                   someone to install an app they have not seen yet, which is how the
 *                   browser's own banner behaves and why it gets dismissed unread.
 *   It installs.    The button fires the real install dialog. Pointing at a browser menu is
 *                   not an offer, it is homework — except on iOS, where no API exists and the
 *                   Share-sheet steps are the honest version of the same thing.
 *   It goes away.   Dismissing hides it for a while — see install-dismissal.ts. Settings
 *                   still has the button, so nothing is lost by taking "not now" at face value.
 *
 * It renders nothing at all when there is nothing to offer — already installed, or a browser
 * that never fired `beforeinstallprompt` and is not iOS.
 */

import { usePwaInstall } from "@/hooks/usePwaInstall";
import { dismissedRecently, rememberDismissal } from "@/components/pwa/install-dismissal";
import { Check, Download, Share, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/** How long to let someone read before asking for anything. */
const DELAY_MS = 30_000;

export function InstallAppPrompt() {
  const { isInstalled, canPrompt, needsManualSteps, install } = usePwaInstall();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  // Nothing to offer, so never start the clock.
  const offerable = !isInstalled && (canPrompt || needsManualSteps);

  useEffect(() => {
    if (!offerable || dismissedRecently()) return;
    const timer = setTimeout(() => setVisible(true), DELAY_MS);
    return () => clearTimeout(timer);
  }, [offerable]);

  // Installing from the browser's own menu while this is open should take it away.
  useEffect(() => {
    if (isInstalled) setVisible(false);
  }, [isInstalled]);

  if (!visible || !offerable) return null;

  const dismiss = () => {
    rememberDismissal();
    setVisible(false);
  };

  const onInstall = async () => {
    setBusy(true);
    try {
      const accepted = await install();
      if (accepted) {
        toast.success("Sendzz is on your home screen.");
        setVisible(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Install Sendzz"
      className="fixed z-50 bottom-4 left-4 right-4 md:left-auto md:right-6 md:bottom-6 md:w-[22rem] animate-slide-up"
      style={{
        background: "rgba(14, 14, 18, 0.92)",
        backdropFilter: "blur(20px) saturate(180%)",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: "1.25rem",
        boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
      }}
    >
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute top-3 right-3 w-7 h-7 grid place-items-center rounded-full text-[rgba(248,248,246,0.35)] hover:text-[#f8f8f6] hover:bg-white/[0.06] transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>

      <div className="p-5 pr-10">
        <p className="text-sm font-bold text-brand-secondary">Add Sendzz to your phone</p>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: "rgba(248,248,246,0.55)" }}>
          {needsManualSteps
            ? "Three taps in Safari puts it on your home screen."
            : "Opens from your home screen, full screen, and tells you the moment a withdrawal lands."}
        </p>

        {needsManualSteps ? (
          // iOS has no install API — Safari only offers the Share sheet. Showing the taps is
          // the most this can honestly do; a button here would promise something it cannot do.
          <ol className="mt-4 space-y-2">
            {[
              { icon: <Share className="w-3.5 h-3.5" />, text: "Tap Share in the toolbar" },
              { icon: <span className="text-xs font-bold">+</span>, text: "Choose Add to Home Screen" },
              { icon: <Check className="w-3.5 h-3.5" />, text: "Tap Add" },
            ].map((step, i) => (
              <li key={i} className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-full bg-white/[0.06] border border-white/10 grid place-items-center shrink-0" style={{ color: "rgba(248,248,246,0.6)" }}>
                  {step.icon}
                </span>
                <span className="text-xs" style={{ color: "rgba(248,248,246,0.65)" }}>{step.text}</span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={onInstall}
              disabled={busy}
              className="btn-accent h-10 px-5 rounded-full text-xs font-bold inline-flex items-center gap-2 disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5" />
              {busy ? "Opening…" : "Install"}
            </button>
            <button
              onClick={dismiss}
              className="h-10 px-4 rounded-full text-xs font-semibold transition-colors text-[rgba(248,248,246,0.45)] hover:text-[#f8f8f6]"
            >
              Not now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
