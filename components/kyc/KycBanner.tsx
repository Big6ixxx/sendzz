"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldAlert, X, ArrowRight, Clock } from "lucide-react";
import { KycModal } from "./KycModal";

interface KycData {
  kyc: { status: string; updatedAt: string };
  totals: { daily: number; weekly: number; monthly: number };
  unverifiedLimits: { daily: number; weekly: number; monthly: number };
  percentages: { daily: number; weekly: number; monthly: number };
}

interface KycBannerProps {
  userEmail: string;
}

/**
 * KycBanner — top-of-dashboard alert for users approaching or hitting limits.
 *
 * - Hidden for users who are KYC-approved.
 * - Shows a soft warning when >70% of any limit is used.
 * - Shows an urgent alert when a limit is reached or the user is blocked.
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

  const { kyc, percentages, unverifiedLimits } = data;

  // Nothing to show for approved users or those not yet near limits
  if (kyc.status === "approved") return null;

  const maxPct = Math.max(percentages.daily, percentages.weekly, percentages.monthly);
  const isAtLimit = maxPct >= 100;
  const isPending = kyc.status === "pending";
  const isInReview = kyc.status === "in_review";

  if (maxPct < 50 && !isPending && !isInReview) return null;
  if (dismissed) return null;

  // Which period is the most used
  const bindingPeriodLabel =
    percentages.daily >= 100
      ? `daily ($${unverifiedLimits.daily})`
      : percentages.weekly >= 100
      ? `weekly ($${unverifiedLimits.weekly})`
      : percentages.monthly >= 100
      ? `monthly ($${unverifiedLimits.monthly})`
      : percentages.daily >= percentages.weekly && percentages.daily >= percentages.monthly
      ? `daily ($${unverifiedLimits.daily})`
      : percentages.weekly >= percentages.monthly
      ? `weekly ($${unverifiedLimits.weekly})`
      : `monthly ($${unverifiedLimits.monthly})`;

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
                      ? "Transaction limit reached"
                      : "Approaching transaction limit"}
                  </p>
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: "rgba(248,248,246,0.5)" }}>
                    {isInReview
                      ? "We're reviewing your submitted documents. You'll be notified when complete."
                      : isPending
                      ? "You've initiated identity verification. Complete your verification below."
                      : isAtLimit
                      ? `You've reached your ${bindingPeriodLabel} limit. Verify your identity to continue transacting.`
                      : `You've used ${maxPct.toFixed(0)}% of your ${bindingPeriodLabel} limit. Verify your identity to avoid disruption.`}
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
