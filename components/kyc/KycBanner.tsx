"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { X, ArrowRight } from "lucide-react";
import { KycModal } from "./KycModal";

import type { Allowance } from "./LimitsMeter";

interface KycData {
  kyc: { status: string; updatedAt: string };
  allowance: Allowance | null;
}

interface KycBannerProps {
  userEmail: string;
}

/**
 * KycBanner — top-of-dashboard alert for users approaching or hitting their allowance.
 *
 * - Hidden for users who are KYC-approved.
 * - Shows a soft warning once half the withdrawal allowance is spent.
 * - Shows an urgent alert once it is gone.
 *
 * Reads the allowance rather than the old rolling percentages. Those are permanently zero now
 * that windows no longer bind an unverified account, so this banner had stopped appearing at
 * all — the first a user heard of the limit was a refused withdrawal.
 */
export function KycBanner({ userEmail }: KycBannerProps) {
  const [data, setData] = useState<KycData | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [kycModalOpen, setKycModalOpen] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!userEmail) return;
    try {
      const res = await fetch(`/api/kyc/status?email=${encodeURIComponent(userEmail)}`);
      if (!res.ok) return;
      const json = await res.json();
      setData(json);
    } catch {
      // silent — banner is non-critical
    }
  }, [userEmail]);

  useEffect(() => {
    if (!userEmail) return;
    let isMounted = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/kyc/status?email=${encodeURIComponent(userEmail)}`);
        if (!res.ok || !isMounted) return;
        const json = await res.json();
        if (isMounted) setData(json);
      } catch {
        // silent
      }
    };
    void load();
    const interval = setInterval(load, 60_000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [userEmail]);

  if (!data) return null;

  const { kyc, allowance } = data;

  // Nothing to show for approved users, who have no allowance to run down.
  if (kyc.status === "approved" || !allowance) return null;

  const usedPct = allowance.percentage;
  const isAtLimit = allowance.remaining <= 0;
  const isPending = kyc.status === "pending";
  const isInReview = kyc.status === "in_review";

  if (usedPct < 50 && !isPending && !isInReview) return null;
  if (dismissed) return null;

  const title = isInReview
    ? "Identity verification under review"
    : isPending
      ? "Identity verification in progress"
      : isAtLimit
        ? "Withdrawal allowance used"
        : "Approaching your withdrawal allowance";
  const body = isInReview
    ? "We're reviewing your submitted documents. You'll be notified when complete."
    : isPending
      ? "You've initiated identity verification. Complete your verification below."
      : isAtLimit
        ? `You've withdrawn your full $${allowance.total} allowance. Verify your identity to withdraw again. It does not reset.`
        : `You have $${allowance.remaining.toFixed(2)} of your $${allowance.total} withdrawal allowance left. Verify your identity to remove the limit.`;
  const modal = (
    <KycModal
      isOpen={kycModalOpen}
      onClose={() => {
        setKycModalOpen(false);
        // Re-fetch status after modal closes in case user completed KYC
        setTimeout(fetchStatus, 1000);
      }}
      userEmail={userEmail}
    />
  );

  const accent = isAtLimit
    ? "#a1462c"
    : isPending || isInReview
      ? "#0e7a45"
      : "#8a5a00";
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="lp-card relative mx-4 mt-4 rounded-[24px] p-4 sm:p-5 md:mx-6 lg:mx-8"
        role="alert"
        aria-live="polite"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3.5">
            <span className="mt-[7px] size-2 shrink-0 rounded-full" style={{ background: accent }} aria-hidden />
            <div className="min-w-0 pr-8 sm:pr-0">
              <p className="text-[15px] font-semibold text-[var(--lp-ink)]">{title}</p>
              <p className="mt-0.5 text-[14px] leading-[1.5] text-[var(--lp-body)]">{body}</p>
            </div>
          </div>
          {!isInReview && (
            <button
              id="kyc-banner-verify-btn"
              onClick={() => setKycModalOpen(true)}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-[var(--lp-ink)] px-5 text-[14px] font-semibold text-[var(--lp-cream)] transition-[scale] duration-150 active:scale-[0.97] sm:mr-10"
            >
              {isPending ? "Continue verification" : "Verify identity"}
              <ArrowRight className="size-4" />
            </button>
          )}
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="absolute right-3.5 top-3.5 grid size-8 place-items-center rounded-full bg-[var(--lp-cream)] text-[var(--lp-muted)] transition-colors hover:text-[var(--lp-ink)] sm:top-1/2 sm:-translate-y-1/2"
          aria-label="Dismiss KYC banner"
        >
          <X className="size-4" />
        </button>
      </motion.div>
      {modal}
    </>
  );
}
