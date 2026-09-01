"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldAlert, X, ArrowRight, Clock } from "lucide-react";
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

  return (
    <>
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="relative mx-4 md:mx-6 lg:mx-8 mt-4 rounded-2xl overflow-hidden"
          style={{
            background: isAtLimit
              ? "linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(220,38,38,0.06) 100%)"
              : (isPending || isInReview)
              ? "linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(37,99,235,0.06) 100%)"
              : "linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(217,119,6,0.06) 100%)",
            border: `1px solid ${
              isAtLimit
                ? "rgba(239,68,68,0.2)"
                : (isPending || isInReview)
                ? "rgba(59,130,246,0.2)"
                : "rgba(245,158,11,0.2)"
            }`,
          }}
          role="alert"
          aria-live="polite"
        >
          <div className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                {/* Icon */}
                <div
                  className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center mt-0.5"
                  style={{
                    background: isAtLimit
                      ? "rgba(239,68,68,0.15)"
                      : (isPending || isInReview)
                      ? "rgba(59,130,246,0.15)"
                      : "rgba(245,158,11,0.15)",
                  }}
                >
                  {(isPending || isInReview) ? (
                    <Clock
                      className="w-4 h-4"
                      style={{ color: "#3b82f6" }}
                      aria-hidden
                    />
                  ) : isAtLimit ? (
                    <ShieldAlert
                      className="w-4 h-4"
                      style={{ color: "#ef4444" }}
                      aria-hidden
                    />
                  ) : (
                    <ShieldAlert
                      className="w-4 h-4"
                      style={{ color: "#f59e0b" }}
                      aria-hidden
                    />
                  )}
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-semibold"
                    style={{
                      color: isAtLimit
                        ? "#ef4444"
                        : (isPending || isInReview)
                        ? "#60a5fa"
                        : "#f59e0b",
                    }}
                  >
                    {isInReview
                      ? "Identity verification under review"
                      : isPending
                      ? "Identity verification in progress"
                      : isAtLimit
                      ? "Withdrawal allowance used"
                      : "Approaching your withdrawal allowance"}
                  </p>
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: "rgba(248,248,246,0.5)" }}>
                    {isInReview
                      ? "We're reviewing your submitted documents. You'll be notified when complete."
                      : isPending
                      ? "You've initiated identity verification. Complete your verification below."
                      : isAtLimit
                      ? `You've withdrawn your full $${allowance.total} allowance. Verify your identity to withdraw again — it does not reset.`
                      : `You have $${allowance.remaining.toFixed(2)} of your $${allowance.total} withdrawal allowance left. Verify your identity to remove the limit.`}
                  </p>
                </div>
              </div>

              {/* Dismiss */}
              <button
                onClick={() => setDismissed(true)}
                className="shrink-0 p-1.5 rounded-lg transition-colors hover:bg-white/5 -mr-1 -mt-1"
                style={{ color: "rgba(248,248,246,0.3)" }}
                aria-label="Dismiss KYC banner"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* CTA */}
            {!isInReview && (
              <div className="mt-3.5 sm:mt-3 flex justify-end">
                <button
                  id="kyc-banner-verify-btn"
                  onClick={() => setKycModalOpen(true)}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 sm:py-2 rounded-xl text-xs font-bold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: isAtLimit
                      ? "rgba(239,68,68,0.2)"
                      : isPending
                      ? "rgba(59,130,246,0.2)"
                      : "rgba(245,158,11,0.2)",
                    color: isAtLimit ? "#ef4444" : isPending ? "#60a5fa" : "#f59e0b",
                    border: `1px solid ${
                      isAtLimit
                        ? "rgba(239,68,68,0.3)"
                        : isPending
                        ? "rgba(59,130,246,0.3)"
                        : "rgba(245,158,11,0.3)"
                    }`,
                  }}
                >
                  {isPending ? "Continue Verification" : "Verify Identity"}
                  <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      <KycModal
        isOpen={kycModalOpen}
        onClose={() => {
          setKycModalOpen(false);
          // Re-fetch status after modal closes in case user completed KYC
          setTimeout(fetchStatus, 1000);
        }}
        userEmail={userEmail}
      />
    </>
  );
}
