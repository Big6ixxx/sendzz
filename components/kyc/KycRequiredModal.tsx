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

import { FlowButton, FlowDialog } from "@/components/flow/ui";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/format-usdc";

export interface KycBlock {
  /** The guard's own wording, already written for the user. */
  message: string;
  allowanceUsed?: number;
  allowanceRemaining?: number;
  allowanceTotal?: number;
}

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
    // No X: "Not now" / "Change amount" says the same thing in words. Escape and clicking outside
    // still close it, so nobody is trapped.
    <FlowDialog
      open={!!block}
      onClose={onClose}
      showClose={false}
      eyebrow="Withdrawal limit"
      title={isSpent ? "Verify to" : "That's more than"}
      italic={isSpent ? "keep withdrawing." : "you have left."}
    >
      <div className="space-y-5">
        {hasFigures && (
          <div className="space-y-3">
            {/* The one number that matters, set as the headline rather than a caption. */}
            <p className="flex items-baseline gap-2">
              <span className={`lp-display text-[48px] leading-none tracking-[-0.045em] tabular-nums ${isSpent ? "text-[#a1462c]" : ""}`}>
                ${formatMoney(remaining)}
              </span>
              <span className="text-[15px] text-[var(--lp-muted)]">of ${total} left</span>
            </p>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-[#efe9dd]"
              role="progressbar"
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Withdrawal allowance used"
            >
              <div
                className={`h-full rounded-full transition-[width] duration-500 ease-out ${isSpent ? "bg-[#a1462c]" : "bg-[#e0a526]"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        <p className="text-[15px] leading-[1.55] text-[var(--lp-body)]">{block?.message}</p>
        <p className="text-[14px] leading-[1.55] text-[var(--lp-muted)]">
          {isSpent
            ? "The allowance is one-off, so it will not reset. Verifying is a single check that usually takes a few minutes, and it removes the limit for good."
            : "You can withdraw a smaller amount now, or verify once and the limit stops applying at all."}
        </p>

        {/* Verifying is the point of this dialog; dismissing is the way out. Same shape, different weight. */}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row">
          <FlowButton tone="quiet" onClick={onClose} className="sm:flex-1">
            {isSpent ? "Not now" : "Change amount"}
          </FlowButton>
          <FlowButton onClick={startVerification} className="sm:flex-[1.4]">
            Verify identity
          </FlowButton>
        </div>
      </div>
    </FlowDialog>
  );
}
