"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/** The unverified user's one-off withdrawal allowance, as /api/kyc/status reports it. */
export interface Allowance {
  total: number;
  used: number;
  remaining: number;
  percentage: number;
}

interface LimitsMeterProps {
  allowance: Allowance | null;
  isVerified?: boolean;
  compact?: boolean;
}

/** One bar, one hue; it turns amber near the end and terracotta when spent. */
function ProgressBar({ percentage, isVerified }: { percentage: number; isVerified: boolean }) {
  const fill = isVerified || percentage < 70 ? "bg-[#04c96a]" : percentage >= 100 ? "bg-[#a1462c]" : "bg-[#e0a526]";
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-[var(--lp-soft)]"
      role="progressbar"
      aria-valuenow={Math.round(percentage)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(percentage, 100)}%` }}
        transition={{ type: "spring", stiffness: 120, damping: 20, delay: 0.1 }}
        className={cn("h-full rounded-full", fill)}
      />
    </div>
  );
}

/**
 * How much an unverified account can still withdraw. Once verified there is no allowance, and
 * the meter says that in one line instead of drawing an empty bar.
 */
export function LimitsMeter({ allowance, isVerified = false, compact = false }: LimitsMeterProps) {
  if (isVerified) {
    return (
      <p className="rounded-[18px] bg-[var(--lp-good-soft)] px-4 py-3.5 text-[14px] leading-[1.5] text-[var(--lp-good)]">
        <span className="font-semibold">No withdrawal limit.</span> Your identity is verified, so you can cash out any amount.
      </p>
    );
  }

  if (!allowance) return null;
  const spent = allowance.used >= allowance.total;

  if (compact) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="shrink-0 text-[13px] text-[var(--lp-muted)]">Withdrawal allowance</span>
        <div className="flex-1">
          <ProgressBar percentage={allowance.percentage} isVerified={isVerified} />
        </div>
        <span className="shrink-0 text-[13px] tabular-nums text-[var(--lp-muted)]">
          ${allowance.used.toFixed(0)} / ${allowance.total}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-semibold">
          {spent ? "Allowance used up" : `$${allowance.remaining.toFixed(2)} left to withdraw`}
        </span>
        <span className="text-[13px] tabular-nums text-[var(--lp-muted)]">
          ${allowance.used.toFixed(2)} of ${allowance.total}
        </span>
      </div>
      <ProgressBar percentage={allowance.percentage} isVerified={isVerified} />
      <p className={cn("text-[13px] leading-[1.5]", spent ? "font-medium text-[var(--lp-danger)]" : "text-[var(--lp-muted)]")}>
        {spent
          ? "Verify your identity to withdraw again."
          : "A one-off allowance, in one withdrawal or several. It does not reset."}
      </p>
    </div>
  );
}
