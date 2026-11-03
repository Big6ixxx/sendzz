"use client";

import { format, formatDistanceToNow, isThisYear, subDays } from "date-fns";
import { CheckCircle2, Loader2, Undo2 } from "lucide-react";
import { useMemo } from "react";
import type { Activity } from "@/components/HistoryModule";
import { useBalanceVisibility } from "@/components/providers/BalanceVisibilityProvider";
import { useHistoryList, type HistoryFilter } from "@/hooks/useHistoryList";
import { cn } from "@/lib/utils";
import { FilterPills, SearchField, listPill } from "./ListControls";
import { ActivityRow } from "./ActivityRow";
import { groupByDay, isUncounted } from "./activity-look";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format-usdc";


const FILTERS: { value: HistoryFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "sent", label: "Sent" },
  { value: "received", label: "Received" },
  { value: "deposit", label: "Deposits" },
  { value: "withdrawal", label: "To bank" },
  { value: "bridge", label: "Moves" },
];

/** The full activity list, in the cream brand style: search, kind, order, and a day per heading. */
export function HistoryList({
  userId,
  userEmail,
  onOpen,
}: {
  userId: string;
  userEmail: string;
  onOpen: (activity: Activity) => void;
}) {
  const list = useHistoryList({ userId, userEmail, pageSize: 20 });
  const { hideBalance } = useBalanceVisibility();
  const hidden = (s: string) => (hideBalance ? "••••" : s);

  // The last thirty days at a glance, whatever is filtered below.
  const month = useMemo(() => {
    const since = subDays(new Date(), 30).getTime();
    let moneyIn = 0;
    let moneyOut = 0;
    for (const a of list.all ?? []) {
      if (new Date(a.timestamp).getTime() < since || isUncounted(a.status)) continue;
      if (a.type === "received" && a.status.toLowerCase() === "pending_claim") continue;
      if (a.type === "received" || a.type === "deposit") moneyIn += a.amount;
      else if (a.type === "sent" || a.type === "withdrawal") moneyOut += a.amount;
    }
    return { moneyIn, moneyOut };
  }, [list.all]);

  const filtering = list.filter !== "all" || list.search.trim() !== "";
  const groups = list.sort === "date" ? groupByDay(list.visible, (a) => a.timestamp) : [{ label: "Largest first", items: list.visible }];

  return (
    <div className="space-y-5">
      {!list.isLoading && (list.all?.length ?? 0) > 0 && (
        <section
          aria-label="Last 30 days"
          className="grid grid-cols-2 overflow-hidden rounded-[28px] bg-[var(--lp-forest)] text-[var(--lp-cream)]"
        >
          {[
            { label: "In · last 30 days", value: `+$${formatMoney(month.moneyIn)}`, accent: true },
            { label: "Out · last 30 days", value: `−$${formatMoney(month.moneyOut)}`, accent: false },
          ].map((s, i) => (
            <div key={s.label} className={cn("min-w-0 p-5 sm:p-7", i > 0 && "border-l border-[rgba(246,242,233,0.12)]")}>
              <p className="lp-mono text-[11px] uppercase text-[#a9c2b5] sm:text-[12px]">{s.label}</p>
              <p
                className={cn(
                  "lp-display mt-2 truncate text-[clamp(24px,5vw,40px)] leading-none tracking-[-0.04em] tabular-nums",
                  s.accent && "text-[var(--lp-green)]",
                )}
              >
                {hidden(s.value)}
              </p>
            </div>
          ))}
        </section>
      )}

      {/* Controls: search on its own line on a phone, beside the order toggle on wider screens. */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchField
            value={list.search}
            onChange={list.setSearch}
            placeholder="Search by email, amount or note"
            label="Search activity"
          />
          <div role="radiogroup" aria-label="Order" className="flex shrink-0 self-start rounded-full bg-white p-1 sm:self-auto shadow-[0_0_0_1px_rgb(17_26_19/0.08)]">
            {(
              [
                { value: "date", label: "Latest" },
                { value: "amount", label: "Largest" },
              ] as const
            ).map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={list.sort === o.value}
                onClick={() => list.setSort(o.value)}
                className={cn(
                  "h-10 rounded-full px-5 text-[14px] font-semibold transition-colors duration-150",
                  list.sort === o.value ? "bg-[var(--lp-ink)] text-[var(--lp-cream)]" : "text-[var(--lp-muted)] hover:text-[var(--lp-ink)]",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <FilterPills label="Kind" options={FILTERS} value={list.filter} onChange={list.setFilter} />
      </div>

      <section className="lp-card rounded-[28px] p-2">
        {list.isLoading ? (
          <ul className="flex flex-col gap-1 p-1" aria-label="Loading activity">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 rounded-[20px] px-3 py-3.5">
                <Skeleton className="size-11" />
                <span className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-1/4" />
                </span>
                <Skeleton className="h-4 w-16" />
              </li>
            ))}
          </ul>
        ) : list.visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 pb-10 pt-8 text-center">
            <p className="lp-display text-[22px] font-semibold tracking-[-0.02em]">
              {filtering ? (
                <>
                  Nothing <span className="lp-serif">matches.</span>
                </>
              ) : (
                <>
                  Nothing here <span className="lp-serif">yet.</span>
                </>
              )}
            </p>
            <p className="max-w-[320px] text-[14px] leading-[1.5] text-[var(--lp-muted)]">
              {filtering
                ? "Try another search, or look at every kind of activity."
                : "Your transfers, deposits and withdrawals will show up here the moment they happen."}
            </p>
            {filtering && (
              <button
                type="button"
                onClick={() => {
                  list.setSearch("");
                  list.setFilter("all");
                }}
                className={cn(listPill, "mt-1 bg-[var(--lp-ink)] text-[var(--lp-cream)]")}
              >
                Show everything
              </button>
            )}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.label}>
              <h3 className="lp-mono px-4 pb-1 pt-4 text-[11.5px] uppercase text-[var(--lp-muted)] first:pt-3">{g.label}</h3>
              <ul className="flex flex-col gap-0.5 p-1">
                {g.items.map((a) => (
                  <HistoryRow
                    key={`${a.type}-${a.id}`}
                    activity={a}
                    // Under day headings the day is already said; ordered by size, each row needs its date.
                    when={format(new Date(a.timestamp), list.sort === "date" ? "HH:mm" : isThisYear(new Date(a.timestamp)) ? "d MMM, HH:mm" : "d MMM yyyy")}
                    amount={hidden}
                    onOpen={onOpen}
                    accepting={list.acceptingId === a.id}
                    reclaiming={list.reclaimingId === a.id}
                    onAccept={list.accept}
                    onReclaim={list.reclaim}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {list.hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={list.showMore}
            className={cn(listPill, "h-12 bg-white px-7 shadow-[0_0_0_1px_rgb(17_26_19/0.12)] hover:shadow-[0_0_0_1px_rgb(17_26_19/0.4)]")}
          >
            Show more
          </button>
        </div>
      )}
    </div>
  );
}

function HistoryRow({
  activity: a,
  when,
  amount,
  onOpen,
  accepting,
  reclaiming,
  onAccept,
  onReclaim,
}: {
  activity: Activity;
  when: string;
  amount: (s: string) => string;
  onOpen: (a: Activity) => void;
  accepting: boolean;
  reclaiming: boolean;
  onAccept: (id: string) => void;
  onReclaim: (id: string) => void;
}) {
  const pendingClaim = a.status.toLowerCase() === "pending_claim";
  const canReclaim = a.type === "sent" && pendingClaim && !!a.expiresAt && new Date(a.expiresAt) < new Date();
  const canAccept = a.type === "received" && pendingClaim;

  // A note on what the person can do about this row, when there is something to do.
  const prompt = canReclaim
    ? "Not claimed in time. You can take it back."
    : canAccept
      ? "Waiting for you to accept it."
      : pendingClaim && a.expiresAt
        ? `Claim link expires ${formatDistanceToNow(new Date(a.expiresAt), { addSuffix: true })}.`
        : null;

  return (
    <li className="rounded-[20px] transition-colors hover:bg-[var(--lp-cream)]">
      <ActivityRow
        activity={a}
        when={when}
        mask={amount}
        onOpen={onOpen}
        status={canReclaim ? { text: "Unclaimed", tone: "bg-[#fbedcc] text-[#8a5a00]" } : undefined}
      />

      {prompt && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3 pl-[68px]">
          <p className={cn("text-[13px]", canReclaim || canAccept ? "font-medium text-[var(--lp-ink)]" : "text-[var(--lp-muted)]")}>
            {prompt}
          </p>
          {(canReclaim || canAccept) && (
            <button
              type="button"
              onClick={() => (canReclaim ? onReclaim(a.id) : onAccept(a.id))}
              disabled={reclaiming || accepting}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-opacity disabled:opacity-60",
                canAccept ? "bg-[var(--lp-green)] text-[var(--lp-ink)]" : "bg-[var(--lp-ink)] text-[var(--lp-cream)]",
              )}
            >
              {reclaiming || accepting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : canAccept ? (
                <CheckCircle2 className="size-3.5" />
              ) : (
                <Undo2 className="size-3.5" />
              )}
              {canAccept ? (accepting ? "Accepting…" : "Accept") : reclaiming ? "Taking back…" : "Take it back"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
