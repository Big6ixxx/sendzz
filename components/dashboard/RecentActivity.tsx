"use client";

import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { ArrowDownLeft, ArrowUpRight, Landmark, Repeat, Shield, Wallet } from "lucide-react";
import Link from "next/link";
import type { Activity, ActivityType } from "@/components/HistoryModule";
import { useBalanceVisibility } from "@/components/providers/BalanceVisibilityProvider";
import { EASE } from "@/components/landing/motion";
import { useActivities } from "@/hooks/useActivities";

const LOOK: Record<ActivityType, { label: string; icon: typeof ArrowUpRight; badge: string; sign: string }> = {
  sent: { label: "Sent", icon: ArrowUpRight, badge: "bg-[var(--lp-ink)] text-[var(--lp-cream)]", sign: "−" },
  received: { label: "Received", icon: ArrowDownLeft, badge: "bg-[var(--lp-green)] text-[var(--lp-ink)]", sign: "+" },
  deposit: { label: "Deposit", icon: Wallet, badge: "bg-[#cdf5de] text-[#0e7a45]", sign: "+" },
  withdrawal: { label: "To bank", icon: Landmark, badge: "bg-[var(--lp-forest)] text-[var(--lp-green)]", sign: "−" },
  bridge: { label: "Moved between networks", icon: Repeat, badge: "bg-[var(--lp-sand)] text-[var(--lp-ink)]", sign: "" },
  security: { label: "Security", icon: Shield, badge: "bg-[#fbedcc] text-[#8a5a00]", sign: "" },
};

const STATUS: Record<string, { text: string; tone: string }> = {
  pending: { text: "Pending", tone: "bg-[#fbedcc] text-[#8a5a00]" },
  processing: { text: "Processing", tone: "bg-[#fbedcc] text-[#8a5a00]" },
  pending_claim: { text: "Awaiting claim", tone: "bg-[#fbedcc] text-[#8a5a00]" },
  failed: { text: "Failed", tone: "bg-[#fbe7df] text-[#a1462c]" },
  expired: { text: "Expired", tone: "bg-[var(--lp-cream)] text-[var(--lp-muted)]" },
  reversed: { text: "Refunded", tone: "bg-[var(--lp-cream)] text-[var(--lp-muted)]" },
};

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
    <section className="rounded-[28px] bg-white p-2 shadow-[0_0_0_1px_rgb(17_26_19/0.06)]">
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
              <span className="size-10 animate-pulse rounded-full bg-[var(--lp-cream)]" />
              <span className="flex-1 space-y-2">
                <span className="block h-3.5 w-2/5 animate-pulse rounded-full bg-[var(--lp-cream)]" />
                <span className="block h-3 w-1/4 animate-pulse rounded-full bg-[var(--lp-cream)]" />
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
          {items.map((a, i) => {
            const look = LOOK[a.type] ?? LOOK.security;
            const status = STATUS[a.status.toLowerCase()];
            const Icon = look.icon;
            const out = look.sign === "−";
            return (
              <motion.li
                key={`${a.type}-${a.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: EASE, delay: i * 0.05 }}
              >
                <button
                  type="button"
                  onClick={() => onOpen(a)}
                  className="flex w-full items-center gap-3 rounded-[20px] px-3 py-3 text-left transition-colors hover:bg-[var(--lp-cream)]"
                >
                  <span className={`grid size-10 shrink-0 place-items-center rounded-full ${look.badge}`}>
                    <Icon className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{look.label}</span>
                    <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-[var(--lp-muted)]">
                      {status && (
                        <span className={`shrink-0 rounded-full px-2 py-px text-[11px] font-semibold ${status.tone}`}>
                          {status.text}
                        </span>
                      )}
                      <span className="truncate">
                        {a.details.replace(/^(To|From): /, "")} · {formatDistanceToNow(new Date(a.timestamp), { addSuffix: true })}
                      </span>
                    </span>
                  </span>
                  <span
                    className={`lp-display shrink-0 text-[17px] font-semibold tabular-nums tracking-[-0.02em] ${out ? "" : look.sign ? "text-[#0e7a45]" : ""}`}
                  >
                    {hideBalance ? "••••" : `${look.sign}$${money(a.amount)}`}
                  </span>
                </button>
              </motion.li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
