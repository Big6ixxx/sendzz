"use client";

import { motion } from "framer-motion";
import { ShieldCheck, TrendingUp } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

/** The unverified user's one-off withdrawal allowance, as /api/kyc/status reports it. */
export interface Allowance {
  total: number;
  used: number;
  remaining: number;
  percentage: number;
}

interface LimitsMeterProps {
  totals: { daily: number; weekly: number; monthly: number };
  allowance: Allowance | null;
  isVerified?: boolean;
  compact?: boolean;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressBar({
  percentage,
  isVerified,
}: {
  percentage: number;
  isVerified: boolean;
}) {
  return (
    <div
      className="h-1.5 rounded-full overflow-hidden w-full"
      style={{ background: "rgba(255,255,255,0.06)" }}
      role="progressbar"
      aria-valuenow={Math.round(percentage)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(percentage, 100)}%` }}
        transition={{ type: "spring", stiffness: 120, damping: 20, delay: 0.1 }}
        className="h-full rounded-full"
        style={{
          background: isVerified
            ? "linear-gradient(90deg, #00e87a, #00c468)"
            : percentage >= 100
            ? "linear-gradient(90deg, #ef4444, #dc2626)"
            : percentage >= 70
            ? "linear-gradient(90deg, #f59e0b, #d97706)"
            : "linear-gradient(90deg, #00e87a, #00c468)",
        }}
      />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * LimitsMeter
 *
 * For an unverified user: how much of their one-off withdrawal allowance is spent.
 * For a verified user: their volume, with no limit attached to it.
 *
 * This used to render daily/weekly/monthly bars for everyone. Those windows no longer bind an
 * unverified account — the allowance replaced them — so the bars sat at zero and told the user
 * they had no limits at all, right up until a withdrawal was refused.
 */
export function LimitsMeter({
  totals,
  allowance,
  isVerified = false,
  compact = false,
}: LimitsMeterProps) {
  if (isVerified) {
    return (
      <div className="space-y-4 pt-2">
        <div
          className="p-4 md:p-5 rounded-2xl flex items-center gap-3.5"
          style={{
            background: "linear-gradient(135deg, rgba(0, 232, 122, 0.08) 0%, rgba(0, 196, 104, 0.03) 100%)",
            border: "1px solid rgba(0, 232, 122, 0.18)",
          }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: "rgba(0, 232, 122, 0.15)",
              color: "#00e87a",
            }}
          >
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-white flex items-center gap-2">
              Unlimited Account Access
            </p>
            <p className="text-xs mt-0.5" style={{ color: "rgba(248,248,246,0.6)" }}>
              Your identity is verified. You have no daily, weekly, or monthly restrictions on transactions.
            </p>
          </div>
        </div>

        {/* Volume Summary */}
        <div
          className="grid grid-cols-3 gap-3 p-3.5 rounded-xl"
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Daily Volume
            </p>
            <p className="text-xs font-bold text-foreground mt-0.5">
              ${totals.daily.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Weekly Volume
            </p>
            <p className="text-xs font-bold text-foreground mt-0.5">
              ${totals.weekly.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Monthly Volume
            </p>
            <p className="text-xs font-bold text-foreground mt-0.5">
              ${totals.monthly.toFixed(2)}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Nothing to meter without an allowance, which only happens if the status call failed.
  if (!allowance) return null;

  const spent = allowance.used >= allowance.total;

  if (compact) {
    return (
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <span className="text-xs shrink-0" style={{ color: "rgba(248,248,246,0.4)" }}>
          Withdrawal allowance
        </span>
        <div className="flex-1">
          <ProgressBar percentage={allowance.percentage} isVerified={isVerified} />
        </div>
        <span className="text-xs tabular-nums shrink-0" style={{ color: "rgba(248,248,246,0.4)" }}>
          ${allowance.used.toFixed(0)} / ${allowance.total}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4" style={{ color: "rgba(248,248,246,0.4)" }} />
        <span
          className="text-xs font-semibold uppercase tracking-widest"
          style={{ color: "rgba(248,248,246,0.4)" }}
        >
          Withdrawal Allowance
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium" style={{ color: "rgba(248,248,246,0.6)" }}>
            {spent ? "Fully used" : `$${allowance.remaining.toFixed(2)} left`}
          </span>
          <span className="text-xs tabular-nums" style={{ color: "rgba(248,248,246,0.4)" }}>
            <span style={{ color: "rgba(248,248,246,0.8)" }}>
              ${allowance.used.toFixed(2)}
            </span>
            <span style={{ color: "rgba(248,248,246,0.3)" }}> / ${allowance.total}</span>
          </span>
        </div>
        <ProgressBar percentage={allowance.percentage} isVerified={isVerified} />
        <p
          className="text-[10px] mt-0.5"
          style={{ color: spent ? "#ef4444" : "rgba(248,248,246,0.35)" }}
        >
          {spent
            ? "Allowance used — verify your identity to withdraw again"
            : "A one-off allowance, in one withdrawal or several. It does not reset."}
        </p>
      </div>
    </div>
  );
}
