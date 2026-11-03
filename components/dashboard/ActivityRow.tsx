import type { Activity } from "@/components/HistoryModule";
import { formatMoney } from "@/lib/format-usdc";
import { cn } from "@/lib/utils";
import { ACTIVITY_LOOK, activityRoute, activityStatus, isUncounted, shortenDetail } from "./activity-look";

/**
 * One activity as a tappable row: its kind as a badge and a title, who or where under it with
 * the time, and the amount with its status. Shared by Recent activity and History so the two
 * lists can never disagree on how a payment reads.
 */
export function ActivityRow({
  activity: a,
  when,
  mask,
  onOpen,
  status,
  className,
}: {
  activity: Activity;
  /** The time as this list wants it: "14:03", "2 hours ago", "3 Oct, 14:03". */
  when: string;
  /** Hides the amount when balances are hidden. */
  mask: (s: string) => string;
  onOpen: (a: Activity) => void;
  /** A badge the list knows better than the status does ("Unclaimed"). */
  status?: { text: string; tone: string } | null;
  className?: string;
}) {
  const look = ACTIVITY_LOOK[a.type] ?? ACTIVITY_LOOK.security;
  const badge = status === undefined ? activityStatus(a.status) : status;
  const route = activityRoute(a);
  const detail = route ?? shortenDetail(a.details.replace(/^(To|From): /, ""));
  const uncounted = isUncounted(a.status);
  const Icon = look.icon;

  return (
    <button type="button" onClick={() => onOpen(a)} className={cn("flex w-full items-center gap-3 rounded-[20px] px-3 py-3 text-left", className)}>
      <span className={`grid size-11 shrink-0 place-items-center rounded-full ${look.badge}`}>
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{look.label}</span>
        <span className="block truncate text-[13px] text-[var(--lp-muted)]" title={route ?? a.details}>
          {detail} · {when}
        </span>
      </span>
      {/* The status sits under the amount it qualifies, leaving the title the row's full width. */}
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span
          className={cn(
            "lp-display text-[17px] font-semibold tabular-nums tracking-[-0.02em]",
            uncounted ? "text-[var(--lp-muted)] line-through decoration-1" : look.sign === "+" && "text-[#0e7a45]",
          )}
        >
          {mask(`${look.sign}$${formatMoney(a.amount)}`)}
        </span>
        {badge && <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${badge.tone}`}>{badge.text}</span>}
      </span>
    </button>
  );
}
