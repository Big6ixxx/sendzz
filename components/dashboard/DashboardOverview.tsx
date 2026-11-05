"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, ChevronDown, Eye, EyeOff, Landmark, RefreshCw, Send, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ChainLogo } from "@/components/deposit-withdraw/ChainLogo";
import type { Activity } from "@/components/HistoryModule";
import { EASE, Magnetic, Reveal } from "@/components/landing/motion";
import { useBalanceVisibility } from "@/components/providers/BalanceVisibilityProvider";
import { AnimatedBalance } from "@/components/ui/AnimatedBalance";
import { CHAIN_NAMES } from "@/lib/circle/gateway";
import { RecentActivity } from "./RecentActivity";
import { FlowLabel } from "@/components/flow/ui";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "Good morning" / "Good afternoon" / "Good evening", by the visitor's own clock. */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** The first word of an email's local part, capitalised: "yunus.a@x.com" → "Yunus". */
function nameFromEmail(email?: string) {
  const word = email?.split("@")[0]?.split(/[^\p{L}]+/u).find(Boolean);
  return word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : null;
}

const chainLabel = (chain: string) =>
  CHAIN_NAMES[chain as keyof typeof CHAIN_NAMES] ??
  (chain === "solana" ? "Solana" : chain === "stellar" ? "Stellar" : chain);

export interface DashboardOverviewProps {
  email: string;
  userId: string;
  total: string;
  loading: boolean;
  refreshing: boolean;
  canRefresh: boolean;
  onRefresh: () => void;
  chains: { chain: string; balance: string }[];
  onDeposit: () => void;
  onWithdraw: () => void;
  onBatch: () => void;
  onSendTo: (email: string) => void;
  onOpenActivity: (activity: Activity) => void;
  /** Unclaimed bridges, shown above everything when there are any. */
  pending?: React.ReactNode;
  /** Incoming payments waiting to be accepted. */
  incoming?: React.ReactNode;
}

/** The overview screen, in the cream brand style. Data and dialogs live in the route. */
export function DashboardOverview({
  email,
  userId,
  total,
  loading,
  refreshing,
  canRefresh,
  onRefresh,
  chains,
  onDeposit,
  onWithdraw,
  onBatch,
  onSendTo,
  onOpenActivity,
  pending,
  incoming,
}: DashboardOverviewProps) {
  const { hideBalance, toggleBalanceVisibility } = useBalanceVisibility();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const name = nameFromEmail(email);
  const networks =
    chains.length > 1 ? `Across ${chains.length} networks` : chains[0] ? `On ${chainLabel(chains[0].chain)}` : "No funds yet";

  return (
    <div className="mx-auto max-w-[1240px] space-y-6 pb-24 md:space-y-8">
      {pending}

      <motion.header
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: EASE }}
        className="pt-2"
      >
        <FlowLabel>Overview</FlowLabel>
        <h1 className="lp-display mt-2 text-[clamp(36px,5.4vw,64px)] leading-[0.95] tracking-[-0.045em]">
          {greeting()}
          {name ? (
            <>
              , <span className="lp-serif tracking-[-0.02em]">{name}.</span>
            </>
          ) : (
            "."
          )}
        </h1>
      </motion.header>

      {/* ── Balance ─────────────────────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: EASE, delay: 0.08 }}
        className="lp-on-forest relative overflow-hidden rounded-[32px] p-6 text-[var(--lp-cream)] sm:p-8 md:rounded-[36px] md:p-10"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="lp-mono text-[12px] uppercase text-[var(--lp-green)]">Total balance</span>
          <button
            type="button"
            onClick={() => setShowBreakdown((v) => !v)}
            aria-expanded={showBreakdown}
            className="ml-1 inline-flex items-center gap-1 rounded-full bg-[rgba(245,244,238,0.08)] px-3 py-1 text-[13px] font-semibold text-[#cfe0d6] transition-colors hover:bg-[rgba(245,244,238,0.14)]"
          >
            {networks}
            <ChevronDown className={`size-3.5 transition-transform duration-200 ${showBreakdown ? "rotate-180" : ""}`} />
          </button>
          <span className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={toggleBalanceVisibility}
              aria-label={hideBalance ? "Show balance" : "Hide balance"}
              className="grid size-9 place-items-center rounded-full text-[#cfe0d6] transition-colors hover:bg-[rgba(245,244,238,0.08)]"
            >
              {hideBalance ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading || !canRefresh}
              aria-label="Refresh balance"
              className="grid size-9 place-items-center rounded-full text-[#cfe0d6] transition-colors hover:bg-[rgba(245,244,238,0.08)] disabled:opacity-40"
            >
              <RefreshCw className={`size-4 ${loading || refreshing ? "animate-spin" : ""}`} />
            </button>
          </span>
        </div>

        <p className="lp-display mt-5 flex flex-wrap items-baseline gap-x-3 text-[clamp(40px,10.5vw,112px)] leading-[0.9] tracking-[-0.05em] tabular-nums">
          <span>
            $<AnimatedBalance balance={total} isLoading={loading} />
          </span>
          <span className="lp-serif text-[clamp(22px,2.6vw,34px)] tracking-[-0.01em] text-[#cfe0d6]">USDC</span>
        </p>

        <AnimatePresence initial={false}>
          {showBreakdown && (
            <motion.ul
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="mt-5 flex max-w-xl flex-wrap gap-2 overflow-hidden"
            >
              {chains.length === 0 ? (
                <li className="text-[14px] text-[#cfe0d6]">Nothing here yet. Deposit to get started.</li>
              ) : (
                chains.map((c) => (
                  <li
                    key={c.chain}
                    className="flex items-center gap-2 rounded-full bg-[rgba(245,244,238,0.08)] py-1.5 pl-1.5 pr-3.5"
                  >
                    <ChainLogo chain={c.chain} size={22} />
                    <span className="text-[14px] text-[#cfe0d6]">{chainLabel(c.chain)}</span>
                    <span className="lp-mono text-[13px] text-[var(--lp-cream)]">
                      {hideBalance ? "••••" : `$${parseFloat(c.balance).toFixed(2)}`}
                    </span>
                  </li>
                ))
              )}
            </motion.ul>
          )}
        </AnimatePresence>

        <div className="mt-8 flex flex-wrap items-center gap-2.5 md:mt-10">
          <Magnetic>
            <button
              type="button"
              onClick={onDeposit}
              className="lp-on-green inline-flex h-[54px] items-center gap-2 rounded-full px-6 text-[16px] font-semibold text-[var(--lp-ink)] transition-[scale] duration-150 active:scale-[0.97]"
            >
              <ArrowDownLeft className="size-[18px]" /> Deposit
            </button>
          </Magnetic>
          <Magnetic>
            <button
              type="button"
              onClick={onWithdraw}
              className="inline-flex h-[54px] items-center gap-2 rounded-full bg-[var(--lp-cream)] px-6 text-[16px] font-semibold text-[var(--lp-ink)] transition-[scale] duration-150 active:scale-[0.97]"
            >
              <Landmark className="size-[18px]" /> To bank
            </button>
          </Magnetic>
          <Link
            href="/dashboard/transfer"
            className="inline-flex h-[54px] items-center gap-2 rounded-full border border-[rgba(246,242,233,0.3)] px-6 text-[16px] font-semibold transition-[scale,border-color] duration-150 hover:border-[rgba(246,242,233,0.6)] active:scale-[0.97]"
          >
            <ArrowUpRight className="size-[18px]" /> Send
          </Link>
          <span className="lp-mono flex w-full items-center gap-1.5 pt-3 text-[11.5px] uppercase text-[#a9c2b5] sm:ml-auto sm:w-auto sm:pt-0">
            <ShieldCheck className="size-3.5" /> Self-custodial · only you hold the keys
          </span>
        </div>
      </motion.section>

      {/* Payments waiting for this user to accept; renders nothing when there are none. */}
      {incoming}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-8">
        <div className="space-y-6">
          <QuickSend onSend={onSendTo} />

          <Reveal delay={0.08}>
            <section className="lp-on-green relative overflow-hidden rounded-[28px] p-6 sm:p-8">
              <p className="lp-mono text-[12px] uppercase">Batch payroll</p>
              <h2 className="lp-display mt-3 max-w-[420px] text-[clamp(26px,3vw,34px)] font-bold leading-none tracking-[-0.03em]">
                Pay everyone <span className="lp-serif font-normal tracking-[-0.01em]">at once.</span>
              </h2>
              <p className="mt-3 max-w-[440px] text-[16px] leading-[1.5]">
                Contractors, family, a whole team. Add the emails and amounts, approve once, and
                every payment goes out together.
              </p>
              <button
                type="button"
                onClick={onBatch}
                className="mt-6 inline-flex h-12 items-center gap-2 rounded-full bg-[var(--lp-ink)] px-5 text-[15px] font-semibold text-[var(--lp-cream)] transition-[scale] duration-150 active:scale-[0.97]"
              >
                <Users className="size-[18px]" /> Start a batch
              </button>
            </section>
          </Reveal>
        </div>

        <Reveal delay={0.12}>
          <RecentActivity userId={userId} userEmail={email} onOpen={onOpenActivity} />
        </Reveal>
      </div>
    </div>
  );
}

/** Type an email, land on a transfer to it with the recipient filled in. */
function QuickSend({ onSend }: { onSend: (email: string) => void }) {
  const [to, setTo] = useState("");
  const valid = EMAIL_RE.test(to.trim());
  const name = valid ? nameFromEmail(to.trim()) : null;

  return (
    <Reveal>
      <section className="lp-card rounded-[28px] p-6 sm:p-8">
        <FlowLabel>Send by email</FlowLabel>
        <h2 className="lp-display mt-3 text-[clamp(26px,3vw,34px)] font-bold leading-none tracking-[-0.03em]">
          Who are you paying <span className="lp-serif font-normal tracking-[-0.01em]">today?</span>
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onSend(to.trim());
          }}
          className="mt-6 flex flex-col gap-2 rounded-[28px] bg-[var(--lp-cream)] p-2 outline-2 outline-offset-2 outline-transparent transition-[outline-color] duration-150 focus-within:outline-[var(--lp-ink)] sm:flex-row sm:rounded-full"
        >
          <label htmlFor="dash-send-to" className="sr-only">
            Their email
          </label>
          <input
            id="dash-send-to"
            type="email"
            value={to}
            autoComplete="off"
            onChange={(e) => setTo(e.target.value)}
            placeholder="mum@gmail.com"
            className="min-w-0 flex-1 bg-transparent px-4 py-3 text-[16px] outline-none placeholder:text-[var(--lp-placeholder)]"
          />
          <button
            type="submit"
            disabled={!valid}
            className="inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[var(--lp-ink)] px-5 text-[15px] font-semibold text-[var(--lp-cream)] transition-[scale,opacity] duration-150 active:scale-[0.97] disabled:opacity-40"
          >
            <Send className="size-4" />
            {name ? `Send to ${name}` : "Continue"}
          </button>
        </form>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[14px] text-[var(--lp-muted)]">
          <span>Free between Sendzz accounts. They get a claim link if they are new.</span>
          <Link
            href="/dashboard/transfer"
            className="inline-flex items-center gap-1 font-semibold text-[var(--lp-ink)] transition-colors hover:text-[var(--lp-link)]"
          >
            Send to a wallet address <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>
    </Reveal>
  );
}
