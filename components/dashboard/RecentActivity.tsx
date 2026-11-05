"use client";

import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import Link from "next/link";
import type { Activity } from "@/components/HistoryModule";
import { useBalanceVisibility } from "@/components/providers/BalanceVisibilityProvider";
import { EASE } from "@/components/landing/motion";
import { useActivities } from "@/hooks/useActivities";
import { ActivityRow } from "./ActivityRow";
import { Skeleton } from "@/components/ui/skeleton";


/** The last few things that happened to this account, in the cream brand style. */
export function RecentActivity({
  userId,
  userEmail,
  limit = 5,
  onOpen,
}: {
  userId: string;
  userEmail: string;
  limit?: number;
  onOpen: (activity: Activity) => void;
}) {
  const { data, isLoading } = useActivities(userEmail, userId);
  const { hideBalance } = useBalanceVisibility();
  const items = (data ?? []).slice(0, limit);

  return (
    <section className="lp-card rounded-[28px] p-2">
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <h2 className="lp-display text-[22px] font-semibold tracking-[-0.02em]">Recent activity</h2>
        <Link
          href="/dashboard/history"
          className="rounded-full px-3 py-1.5 text-[14px] font-semibold text-[var(--lp-ink)] transition-colors hover:bg-[var(--lp-cream)]"
        >
          View all
        </Link>
      </div>

      {isLoading ? (
        <ul className="flex flex-col gap-1 p-1" aria-label="Loading activity">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="flex items-center gap-3 rounded-[20px] px-3 py-3">
              <Skeleton className="size-11" />
              <span className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
              </span>
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 pb-8 pt-6 text-center">
          <p className="lp-display text-[20px] font-semibold tracking-[-0.02em]">
            Nothing here <span className="lp-serif">yet.</span>
          </p>
          <p className="max-w-[300px] text-[14px] leading-[1.5] text-[var(--lp-muted)]">
            Your transfers, deposits and withdrawals will show up here the moment they happen.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-0.5 p-1">
          {items.map((a, i) => (
            <motion.li
              key={`${a.type}-${a.id}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE, delay: i * 0.05 }}
            >
              <ActivityRow
                activity={a}
                when={formatDistanceToNow(new Date(a.timestamp), { addSuffix: true })}
                mask={(v) => (hideBalance ? "••••" : v)}
                onOpen={onOpen}
                className="transition-colors hover:bg-[var(--lp-cream)]"
              />
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}
