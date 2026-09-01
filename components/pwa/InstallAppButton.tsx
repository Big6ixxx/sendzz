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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, Download, Share } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function InstallAppButton({ compact = false }: { compact?: boolean }) {
  const { isInstalled, canPrompt, needsManualSteps, install } = usePwaInstall();
  const [stepsOpen, setStepsOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (isInstalled) {
    return (
      <span className="inline-flex items-center gap-2 text-xs font-semibold text-accent">
        <Check className="w-3.5 h-3.5" />
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
            ? "inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-accent hover:text-accent/80 transition-colors"
            : "btn-primary w-full gap-2"
        }
      >
        <Download className="w-4 h-4" />
        {busy ? "Opening…" : "Install app"}
      </button>

      <Dialog open={stepsOpen} onOpenChange={setStepsOpen}>
        <DialogContent className="max-w-[26rem]">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-brand-secondary">
              Keep Sendzz one tap away
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {/* Why first. Someone who opened this already knows what installing means; what
                they do not know is what it gets them, and that is what decides it. */}
            <ul className="space-y-2.5">
              {[
                "Open straight from your home screen, no typing the address",
                "Full screen, with no browser bar in the way",
                "Get told the moment a withdrawal reaches your bank",
              ].map((benefit) => (
                <li key={benefit} className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <span className="text-sm text-brand-secondary/70 leading-snug">{benefit}</span>
                </li>
              ))}
            </ul>

            <div className="pt-1 space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30">
                {needsManualSteps ? "Three taps in Safari" : "From your browser menu"}
              </p>

              {needsManualSteps ? (
                <ol className="space-y-3">
                  {[
                    { icon: <Share className="w-4 h-4" />, text: "Tap Share in Safari's toolbar." },
                    { icon: <span className="text-sm font-bold">+</span>, text: "Choose Add to Home Screen." },
                    { icon: <Check className="w-4 h-4" />, text: "Tap Add." },
                  ].map((step, i) => (
                    <li key={i} className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-full bg-white/[0.06] border border-white/10 grid place-items-center text-brand-secondary/60 shrink-0">
                        {step.icon}
                      </span>
                      <span className="text-sm text-brand-secondary/70 leading-snug">
                        {step.text}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-brand-secondary/60 leading-relaxed">
                  Choose <span className="text-brand-secondary">Install app</span> or{" "}
                  <span className="text-brand-secondary">Add to Home screen</span>.
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button onClick={() => setStepsOpen(false)} className="btn-primary px-6">
              Got it
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
