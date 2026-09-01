"use client";

/**
 * KycRequiredModal
 *
 * Shown when a withdrawal is refused because the unverified allowance is spent, or because this
 * withdrawal would spend more than is left.
 *
 * A toast was the wrong shape for this. It says what went wrong, gives no way to fix it, and
 * disappears before the user has read the number — so the only thing they can do is try again
 * and be refused again. This is a dead end with a door in it.
 *
 * The figure is the design. What a user needs here is one number — what is left — so it is set
 * as the headline rather than buried as a caption beside a progress bar. Everything else is
 * quiet around it: a hairline for the proportion, one line of prose, and a single emphasised
 * action. Dismissible on purpose, since someone who simply typed too large a number should be
 * able to close this and type a smaller one.
 */

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRouter } from "next/navigation";

export interface KycBlock {
  /** The guard's own wording, already written for the user. */
  message: string;
  allowanceUsed?: number;
  allowanceRemaining?: number;
  allowanceTotal?: number;
}

const money = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function KycRequiredModal({
  block,
  onClose,
  onVerify,
}: {
  block: KycBlock | null;
  onClose: () => void;
  /** Opens the verification flow in place. Falls back to Settings when not provided. */
  onVerify?: () => void;
}) {
  const router = useRouter();

  const total = block?.allowanceTotal;
  const used = block?.allowanceUsed;
  const remaining = block?.allowanceRemaining;
  const hasFigures =
    total !== undefined && used !== undefined && remaining !== undefined;

  // Nothing left is a different situation from "this one is too big", and they need different
  // words: one is a wall, the other is a nudge to type a smaller number.
  const isSpent = !hasFigures || remaining <= 0;
  const pct = hasFigures && total > 0 ? Math.min(100, (used / total) * 100) : 100;

  const startVerification = () => {
    onClose();
    if (onVerify) {
      onVerify();
      return;
    }
    // No in-place flow available: Settings is where verification lives, and the anchor puts
    // them in front of the button rather than at the top of a long page.
    router.push("/dashboard/settings#identity");
  };

  return (
    <Dialog open={!!block} onOpenChange={(v) => !v && onClose()}>
      {/*
        No X. "Not now" / "Change amount" is the same action stated in words, and two ways to
        dismiss one dialog is one more than it needs — the icon only repeats what the button
        already says, less clearly. Escape and clicking outside still close it, so nobody is
        trapped by the button being the only visible exit.
      */}
      <DialogContent className="max-w-[26rem]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-brand-secondary">
            {isSpent ? "Verify to keep withdrawing" : "That is more than you have left"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {hasFigures && (
            <div className="space-y-3">
              {/* The one number that matters, set as the headline rather than a caption. */}
              <div className="flex items-baseline gap-2">
                <span
                  className="font-display text-[2.75rem] leading-none font-bold tracking-tighter tabular-nums text-brand-secondary"
                  style={{ color: isSpent ? "#ef4444" : undefined }}
                >
                  ${money(remaining)}
                </span>
                <span className="text-sm text-brand-secondary/40">
                  of ${total} left
                </span>
              </div>

              {/* A hairline, not a bar in a box: it states a proportion without becoming furniture. */}
              <div
                className="h-px w-full bg-white/10 overflow-hidden"
                role="progressbar"
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Withdrawal allowance used"
              >
                <div
                  className="h-full transition-[width] duration-500 ease-out"
                  style={{
                    width: `${pct}%`,
                    background: isSpent ? "#ef4444" : "#f59e0b",
                  }}
                />
              </div>
            </div>
          )}

          <p className="text-sm text-brand-secondary/60 leading-relaxed">
            {block?.message}
          </p>

          <p className="text-[13px] text-brand-secondary/40 leading-relaxed">
            {isSpent
              ? "The allowance is one-off, so it will not reset. Verifying is a single check that usually takes a few minutes, and it removes the limit for good."
              : "You can withdraw a smaller amount now, or verify once and the limit stops applying at all."}
          </p>
        </div>

        {/*
          Not two matching buttons: verifying is the point of this dialog, dismissing is the way
          out. Same height and pill shape as the primary so they read as a pair, but unfilled —
          the weight difference is what states the priority. It was a bare text link, which is
          the other failure: with no hit area and no hover surface it read as stray copy rather
          than something to press.
        */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={onClose}
            className="h-14 flex-1 rounded-full font-semibold text-brand-secondary/50 transition-all hover:text-brand-secondary hover:bg-white/[0.06] active:scale-[0.98]"
          >
            {isSpent ? "Not now" : "Change amount"}
          </button>
          <button onClick={startVerification} className="btn-primary flex-[1.4]">
            Verify identity
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
