"use client";

/**
 * The Install Sendzz control, wherever someone might look for it.
 *
 * Always visible while the app is not installed, including on iOS where there is no install API
 * at all. A control that quietly disappears when the browser has not offered a prompt is worse
 * than one that shows the manual steps: the user came looking for it, and "nothing here"
 * answers nothing.
 *
 * Anyone who taps this has already decided, so the fallback gives them the taps and stops.
 */

import { usePwaInstall } from "@/hooks/usePwaInstall";
import { Check, Download, Share } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { FlowButton, FlowDialog, FlowLabel } from "@/components/flow/ui";

export function InstallAppButton({ compact = false }: { compact?: boolean }) {
  const { isInstalled, canPrompt, needsManualSteps, install } = usePwaInstall();
  const [stepsOpen, setStepsOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (isInstalled) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--lp-good-soft)] px-3 py-1.5 text-[13px] font-semibold text-[var(--lp-good)]">
        <Check className="size-3.5" />
        Installed
      </span>
    );
  }

  const onClick = async () => {
    // iOS, or a browser that never offered a prompt: explain the manual route rather than
    // doing nothing. Chrome withholds the event when its own criteria are unmet, so "no
    // prompt" is a normal state, not an error.
    if (!canPrompt) {
      setStepsOpen(true);
      return;
    }
    setBusy(true);
    try {
      const accepted = await install();
      if (accepted) toast.success("Sendzz is on your home screen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={onClick}
        disabled={busy}
        className={
          compact
            ? "inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--lp-ink)] px-4 text-[14px] font-semibold text-[var(--lp-cream)] disabled:opacity-60"
            : "inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[var(--lp-ink)] px-6 text-[15px] font-semibold text-[var(--lp-cream)] disabled:opacity-60"
        }
      >
        <Download className="size-4" />
        {busy ? "Opening…" : "Install"}
      </button>

      <FlowDialog open={stepsOpen} onClose={() => setStepsOpen(false)} eyebrow="Install Sendzz" title="Keep Sendzz" italic="one tap away.">
          <div className="space-y-5">
            {/* Why first. Someone who opened this already knows what installing means; what
                they do not know is what it gets them, and that is what decides it. */}
            <ul className="divide-y divide-[var(--lp-line)] border-y border-[var(--lp-line)]">
              {[
                "Open straight from your home screen, no typing the address",
                "Full screen, with no browser bar in the way",
                "Get told the moment a withdrawal reaches your bank",
              ].map((benefit) => (
                <li key={benefit} className="py-3 text-[15px] leading-snug">
                  {benefit}
                </li>
              ))}
            </ul>

            <div className="space-y-3">
              <FlowLabel>
                {needsManualSteps ? "Three taps in Safari" : "From your browser menu"}
              </FlowLabel>

              {needsManualSteps ? (
                <ol className="space-y-3">
                  {[
                    { icon: <Share className="w-4 h-4" />, text: "Tap Share in Safari's toolbar." },
                    { icon: <span className="text-sm font-bold">+</span>, text: "Choose Add to Home Screen." },
                    { icon: <Check className="w-4 h-4" />, text: "Tap Add." },
                  ].map((step, i) => (
                    <li key={i} className="flex items-center gap-3">
                      <span className="lp-card grid size-9 shrink-0 place-items-center rounded-full text-[var(--lp-ink)]">
                        {step.icon}
                      </span>
                      <span className="text-[15px] leading-snug">
                        {step.text}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-[15px] leading-relaxed text-[var(--lp-body)]">
                  Choose <span className="font-semibold text-[var(--lp-ink)]">Install app</span> or{" "}
                  <span className="font-semibold text-[var(--lp-ink)]">Add to Home screen</span>.
                </p>
              )}
            </div>
          </div>

          <div className="mt-6">
            <FlowButton onClick={() => setStepsOpen(false)}>Got it</FlowButton>
          </div>
      </FlowDialog>
    </>
  );
}
