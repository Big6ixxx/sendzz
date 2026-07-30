"use client";

import { motion } from "framer-motion";
import { ShieldCheck, TrendingUp } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PeriodMeter {
  label: string;
  used: number;
  limit: number | null;
  percentage: number;
}

interface LimitsMeterProps {
  totals: { daily: number; weekly: number; monthly: number };
  limits: { daily: number | null; weekly: number | null; monthly: number | null };
  percentages: { daily: number; weekly: number; monthly: number };
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
 * Visual progress bars showing how much of each transaction limit
 * (daily / weekly / monthly) the user has consumed.
 */
export function LimitsMeter({
  totals,
  limits,
  percentages,
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

  const periods: PeriodMeter[] = [
    { label: "Daily", used: totals.daily, limit: limits.daily, percentage: percentages.daily },
    { label: "Weekly", used: totals.weekly, limit: limits.weekly, percentage: percentages.weekly },
    { label: "Monthly", used: totals.monthly, limit: limits.monthly, percentage: percentages.monthly },
  ];

  if (compact) {
    const worst = periods.reduce((a, b) => (a.percentage > b.percentage ? a : b));
    return (
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <span className="text-xs shrink-0" style={{ color: "rgba(248,248,246,0.4)" }}>
          {worst.label} limit
        </span>
        <div className="flex-1">
          <ProgressBar percentage={worst.percentage} isVerified={isVerified} />
        </div>
        <span className="text-xs tabular-nums shrink-0" style={{ color: "rgba(248,248,246,0.4)" }}>
          ${worst.used.toFixed(0)}
          {worst.limit !== null ? ` / $${worst.limit}` : ""}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 mb-1">
        <TrendingUp className="w-4 h-4" style={{ color: "rgba(248,248,246,0.4)" }} />
        <span
          className="text-xs font-semibold uppercase tracking-widest"
          style={{ color: "rgba(248,248,246,0.4)" }}
        >
          Transaction Usage
        </span>
      </div>

      {periods.map(({ label, used, limit, percentage }) => (
        <div key={label} className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium" style={{ color: "rgba(248,248,246,0.6)" }}>
              {label}
            </span>
            <span className="text-xs tabular-nums" style={{ color: "rgba(248,248,246,0.4)" }}>
              <span style={{ color: "rgba(248,248,246,0.8)" }}>${used.toFixed(2)}</span>
              {limit !== null && (
                <span style={{ color: "rgba(248,248,246,0.3)" }}> / ${limit}</span>
              )}
            </span>
          </div>
          <ProgressBar percentage={percentage} isVerified={isVerified} />
          {percentage >= 100 && (
            <p className="text-[10px]" style={{ color: "#ef4444" }}>
              Limit reached — verify your identity to continue
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
