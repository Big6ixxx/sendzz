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
 *
 * Styled for the landing page, the only place it appears: it reads the page's `--lp-*` colours
 * and fonts, and sits bottom-left on desktop and above the support button on phones so the two
 * never overlap.
 */

import { usePwaInstall } from "@/hooks/usePwaInstall";
import { dismissedRecently, rememberDismissal } from "@/components/pwa/install-dismissal";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Download, Share, X } from "lucide-react";
import Image from "next/image";
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
    <AnimatePresence>
      {visible && offerable && (
        <motion.div
          role="dialog"
          aria-label="Install Sendzz"
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, transition: { duration: 0.18 } }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="fixed bottom-[104px] left-4 right-4 z-50 rounded-[24px] bg-white text-[var(--lp-ink)] shadow-[0_24px_48px_-20px_rgb(17_26_19/0.35),0_0_0_1px_rgb(17_26_19/0.06)] md:bottom-6 md:left-6 md:right-auto md:w-[23rem]"
        >
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            className="absolute right-3.5 top-3.5 grid size-8 place-items-center rounded-full bg-[var(--lp-cream)] text-[var(--lp-muted)] transition-[scale,color] duration-150 hover:text-[var(--lp-ink)] active:scale-[0.94]"
          >
            <X className="size-4" />
          </button>

          <div className="p-5 pr-12">
            <div className="flex items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-[var(--lp-cream)]">
                <Image src="/Sendz-192.png" alt="" width={28} height={28} className="rounded-md" />
              </span>
              <p className="lp-display text-[20px] font-semibold leading-tight tracking-[-0.02em]">Add Sendzz to your phone</p>
            </div>
            <p className="mt-2.5 text-[14px] leading-[1.5] text-[var(--lp-body)]">
              {needsManualSteps
                ? "Three taps in Safari puts it on your home screen."
                : "Opens from your home screen, full screen, and tells you the moment a withdrawal lands."}
            </p>

            {needsManualSteps ? (
              // iOS has no install API — Safari only offers the Share sheet. Showing the taps is
              // the most this can honestly do; a button here would promise something it cannot do.
              <ol className="mt-4 space-y-2">
                {[
                  { icon: <Share className="size-3.5" />, text: "Tap Share in the toolbar" },
                  { icon: <span className="text-[13px] font-bold">+</span>, text: "Choose Add to Home Screen" },
                  { icon: <Check className="size-3.5" />, text: "Tap Add" },
                ].map((step, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--lp-ink)] text-[var(--lp-green)]">
                      {step.icon}
                    </span>
                    <span className="text-[14px] text-[var(--lp-body)]">{step.text}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="mt-4 flex items-center gap-1">
                <button
                  onClick={onInstall}
                  disabled={busy}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--lp-ink)] px-5 text-[15px] font-semibold text-[var(--lp-cream)] transition-[scale] duration-150 active:scale-[0.97] disabled:opacity-60"
                >
                  <Download className="size-4" />
                  {busy ? "Opening…" : "Install"}
                </button>
                <button
                  onClick={dismiss}
                  className="h-11 rounded-full px-4 text-[15px] font-semibold text-[var(--lp-muted)] transition-colors hover:text-[var(--lp-ink)]"
                >
                  Not now
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
