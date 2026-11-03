import { format, isThisYear, isToday, isYesterday } from "date-fns";
import { ArrowDownLeft, ArrowUpRight, Landmark, Repeat, Shield, Wallet } from "lucide-react";
import type { Activity, ActivityType } from "@/components/HistoryModule";
import { CHAIN_META } from "@/components/deposit-withdraw/deposit-shared";

const chainName = (chain: string) => CHAIN_META[chain.toLowerCase()]?.name ?? chain;

/** Where a move between networks went, e.g. "Arbitrum → Base". Only moves name a route. */
export function activityRoute(a: Activity): string | null {
  return a.type === "bridge" && a.sourceChain ? `${chainName(a.sourceChain)} → ${chainName(a.destChain ?? "base")}` : null;
}

/** How each kind of activity is named and marked, wherever an activity is shown in the cream style. */
export const ACTIVITY_LOOK: Record<ActivityType, { label: string; icon: typeof ArrowUpRight; badge: string; sign: string }> = {
  sent: { label: "Sent", icon: ArrowUpRight, badge: "bg-[var(--lp-ink)] text-[var(--lp-cream)]", sign: "−" },
  received: { label: "Received", icon: ArrowDownLeft, badge: "bg-[var(--lp-green)] text-[var(--lp-ink)]", sign: "+" },
  deposit: { label: "Deposit", icon: Wallet, badge: "bg-[#cdf5de] text-[#0e7a45]", sign: "+" },
  withdrawal: { label: "To bank", icon: Landmark, badge: "bg-[var(--lp-forest)] text-[var(--lp-green)]", sign: "−" },
  bridge: { label: "Moved between networks", icon: Repeat, badge: "bg-[var(--lp-sand)] text-[var(--lp-ink)]", sign: "" },
  security: { label: "Security", icon: Shield, badge: "bg-[#fbedcc] text-[#8a5a00]", sign: "" },
};

const WAITING = "bg-[#fbedcc] text-[#8a5a00]";
const PROBLEM = "bg-[#fbe7df] text-[#a1462c]";
const QUIET = "bg-[var(--lp-cream)] text-[var(--lp-muted)]";

/** Statuses worth calling out, by what they mean for the money. Settled ones show no badge. */
export const ACTIVITY_STATUS: Record<string, { text: string; tone: string }> = {
  pending: { text: "Pending", tone: WAITING },
  processing: { text: "Processing", tone: WAITING },
  initiated: { text: "Waiting", tone: WAITING },
  validated: { text: "Processing", tone: WAITING },
  settling: { text: "Processing", tone: WAITING },
  crypto_deposited: { text: "Processing", tone: WAITING },
  awaiting_verification: { text: "Processing", tone: WAITING },
  confirming: { text: "Confirming", tone: WAITING },
  pending_claim: { text: "Awaiting claim", tone: WAITING },
  refunding: { text: "Refunding", tone: WAITING },
  failed: { text: "Failed", tone: PROBLEM },
  rejected: { text: "Rejected", tone: PROBLEM },
  expired: { text: "Expired", tone: QUIET },
  cancelled: { text: "Cancelled", tone: QUIET },
  reversed: { text: "Refunded", tone: QUIET },
  refunded: { text: "Refunded", tone: QUIET },
};

/** The tone for a settled payment, where a list chooses to mark it (the public explorer). */
export const SETTLED_TONE = "bg-[#cdf5de] text-[#0e7a45]";

/** Statuses that mean the money arrived. Only these may read as done. */
const SETTLED = new Set(["completed", "complete", "confirmed", "settled", "success", "claimed", "paid"]);

/**
 * The badge for a status, or null once it has settled. A status nobody has mapped yet shows
 * itself in plain words: never as "Completed", which would tell someone a refunded or stuck
 * payment went through.
 */
export function activityStatus(status: string): { text: string; tone: string } | null {
  const key = status.toLowerCase();
  if (SETTLED.has(key)) return null;
  const known = ACTIVITY_STATUS[key];
  if (known) return known;
  const words = key.replace(/_/g, " ");
  return { text: words.charAt(0).toUpperCase() + words.slice(1), tone: QUIET };
}

/** Money that never moved, or came back: left out of totals and struck through in lists. */
const UNCOUNTED = new Set(["failed", "rejected", "expired", "cancelled", "reversed", "refunding", "refunded"]);

export function isUncounted(status: string): boolean {
  return UNCOUNTED.has(status.toLowerCase());
}

const EMAIL = /^([^\s@]+)@([^\s@]+\.[^\s@]+)$/;
/** Word joiners around the cut, so a wrapping line breaks between words, never inside one. */
const CUT = "\u2060…\u2060";
/** A wallet address or transaction hash: one long run of letters and digits. */
const LONG_TOKEN = /^(0x)?[A-Za-z0-9]{20,}$/;

/**
 * A detail line made to fit one row: long emails, addresses and hashes are cut in the middle,
 * keeping what people actually check. An email keeps its domain (`yunus…@gmail.com`), an address
 * or hash its start and end (`0x9f3c…a2b4`). Ordinary words are left alone.
 */
export function shortenDetail(text: string): string {
  return text
    .split(/(\s+)/)
    .map((token) => {
      const email = EMAIL.exec(token);
      if (email) {
        const [, local, domain] = email;
        return local.length > 8 ? `${local.slice(0, 5)}${CUT}@${domain}` : token;
      }
      if (LONG_TOKEN.test(token)) {
        const head = token.startsWith("0x") ? 6 : 4;
        return `${token.slice(0, head)}${CUT}${token.slice(-4)}`;
      }
      return token;
    })
    .join("");
}

/** Whether a detail line holds something worth copying whole: an email, an address or a hash. */
export function detailHasIdentifier(text: string): boolean {
  return text.split(/\s+/).some((t) => EMAIL.test(t) || LONG_TOKEN.test(t));
}

/** A day heading: "Today", "Yesterday", "Saturday 31 October", or with the year when it isn't this one. */
export function dayLabel(d: Date): string {
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, isThisYear(d) ? "EEEE d MMMM" : "d MMMM yyyy");
}

/** Items under a heading per day, in the order they arrive (newest first). */
export function groupByDay<T>(items: T[], dateOf: (item: T) => string): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const label = dayLabel(new Date(dateOf(item)));
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}
