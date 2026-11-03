"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { FlowButton, FlowDialog, FlowSuccess, Notice } from "@/components/flow/ui";

import { usePrivy } from "@privy-io/react-auth";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";

// ─── Types ───────────────────────────────────────────────────────────────────

type ModalStep =
  | "idle"
  | "creating"
  | "ready"
  | "polling"
  | "approved"
  | "in_review"
  | "declined"
  | "error";

interface KycModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail?: string;
  /** Opened from a deposit: the currency, so an approved user whose ID falls short for that
   * corridor can verify again (see /api/kyc/session). */
  depositCurrency?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * KycModal
 *
 * Guides the user through identity verification (the provider is never named in the UI):
 * 1. Creates a verification session (POST /api/kyc/session)
 * 2. Shows a link to the hosted flow (opens in new tab)
 * 3. Polls GET /api/kyc/status every 5 seconds to detect completion
 * 4. Shows success or failure state
 */
export function KycModal({ isOpen, onClose, userEmail: propEmail, depositCurrency }: KycModalProps) {
  const { user } = usePrivy();
  const effectiveEmail = propEmail || user?.email?.address || "";
  
  const [step, setStep] = useState<ModalStep>("idle");
  const [sessionUrl, setSessionUrl] = useState<string | null>(null);
  // Set when an already-approved user is verifying again: their record reads approved
  // throughout, so only this new session turning approved counts as done.
  const [reverifySessionId, setReverifySessionId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // ── Start polling when the user has opened the Didit flow ─────────────────
  const startPolling = useCallback((sessionOverride?: string) => {
    setStep("polling");
    // Passed in when polling starts in the same tick the session id was set, before state has it.
    const reverifyId = sessionOverride ?? reverifySessionId;

    // A verification is finished in minutes; one still undecided after ten is waiting on
    // something the user cannot wait out here. They are emailed the result either way.
    let ticks = 0;
    pollRef.current = setInterval(async () => {
      if (++ticks > 120) {
        clearInterval(pollRef.current!);
        setErrorMsg("This is taking longer than usual. We'll email you the result as soon as it's decided.");
        setStep("error");
        return;
      }
      try {
        const res = await fetch(
          `/api/kyc/status?email=${encodeURIComponent(effectiveEmail)}` +
            (reverifyId ? `&session=${encodeURIComponent(reverifyId)}` : ""),
        );
        const json = await res.json();
        // Verifying again: the record reads approved throughout, so the new session says how
        // it ended. Done only once the record carries it (closing earlier would re-check the
        // deposit against the old ID), and refused if Didit approved it but it could not replace
        // the old one. Every ending stops the poll; only a session still being filled in, or an
        // approval a moment from being applied, keeps it going.
        const s = json?.session;
        let status: string | undefined;
        if (!reverifyId) {
          status = json?.kyc?.status;
        } else if (s?.applied) {
          status = "approved";
        } else if (s?.message || s?.status === "Declined") {
          status = "declined";
          setErrorMsg(s.message ?? null);
        } else if (s?.status === "Abandoned" || s?.status === "Expired") {
          status = "declined";
          setErrorMsg("That verification wasn't finished. Your earlier verification still stands, so you can start again any time.");
        } else if (s?.status === "In Review") {
          status = "in_review";
        }

        if (status === "approved" || status === "declined" || status === "in_review") {
          clearInterval(pollRef.current!);
          setStep(status);
        }
      } catch {
        // ignore transient errors during polling
      }
    }, 5000);
  }, [effectiveEmail, reverifySessionId]);

  // ── Start the KYC session ─────────────────────────────────────────────────
  const createSession = useCallback(async () => {
    setStep("creating");
    setErrorMsg(null);

    try {
      const res = await fetch("/api/kyc/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: effectiveEmail, depositCurrency }),
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || "Failed to create verification session");
      }
      if (json.alreadyVerified) {
        setStep("approved");
        return;
      }
      if (json.inReview) {
        // Already submitted and waiting on a reviewer: nothing to open, just wait for it.
        if (json.reverify) setReverifySessionId(json.sessionId);
        startPolling(json.reverify ? json.sessionId : undefined);
        return;
      }

      setSessionUrl(json.sessionUrl);
      setReverifySessionId(json.reverify ? json.sessionId : null);
      setStep("ready");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected error";
      setErrorMsg(msg);
      setStep("error");
    }
  }, [effectiveEmail, depositCurrency, startPolling]);

  // ── Cleanup on unmount / close ────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      clearInterval(pollRef.current!);
      // Reset state after a delay so animation doesn't flash
      const t = setTimeout(() => {
        setStep("idle");
        setSessionUrl(null);
        setReverifySessionId(null);
        setErrorMsg(null);
      }, 300);
      return () => clearTimeout(t);
    }

    // Auto-start session creation when modal opens
    if (isOpen && step === "idle") {
      createSession();
    }
  }, [isOpen, step, createSession]);

  // ── Open Didit URL in new tab + start polling ─────────────────────────────
  const handleOpenDidit = () => {
    if (sessionUrl) {
      fetch("/api/kyc/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: effectiveEmail }),
      }).catch(console.error);

      window.open(sessionUrl, "_blank", "noopener,noreferrer");
      startPolling();
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  const titles: Record<ModalStep, [string, string]> = {
    idle: ["Verify", "your identity."],
    creating: ["Verify", "your identity."],
    ready: ["Verify", "your identity."],
    polling: ["Checking", "your ID."],
    in_review: ["Being", "reviewed."],
    approved: ["You're", "verified."],
    declined: ["Not", "approved yet."],
    error: ["Something", "went wrong."],
  };
  const actions = (primary: React.ReactNode, secondary?: React.ReactNode) => (
    <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row">
      {secondary}
      {primary}
    </div>
  );

  return (
    <FlowDialog open={isOpen} onClose={onClose} eyebrow="Identity check" title={titles[step][0]} italic={titles[step][1]}>
      {(step === "idle" || step === "creating") && (
        <SkeletonGroup label="Starting a secure check" className="space-y-5">
          <div className="lp-card space-y-4 rounded-[22px] p-5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3.5 w-3/5" />
          </div>
          <Skeleton tone="page" className="h-14 w-full" />
        </SkeletonGroup>
      )}

      {(step === "ready" || step === "polling") && (
        <div className="space-y-5">
          <div>
            <p className="text-[15px] font-semibold">What you&apos;ll need</p>
            <ul className="mt-2 divide-y divide-[var(--lp-line)] border-y border-[var(--lp-line)] text-[15px] leading-[1.5] text-[var(--lp-body)]">
              <li className="py-3">A government photo ID that shows your date of birth. In Nigeria, also your NIN or BVN.</li>
              <li className="py-3">The original ID in front of you, not a printout or a photo of a screen.</li>
              <li className="py-3">A quick selfie, to show it&apos;s really you.</li>
              <li className="py-3">About two minutes.</li>
            </ul>
          </div>
          <p className="text-[13px] leading-[1.5] text-[var(--lp-muted)]">
            The check opens in a new tab. Your documents are encrypted and Sendzz never stores them.
          </p>

          {step === "polling" ? (
            <div className="lp-card rounded-[20px] p-4 text-center">
              <p className="flex items-center justify-center gap-2 text-[15px] font-semibold">
                <Loader2 className="size-4 animate-spin" /> Waiting for your result
              </p>
              <p className="mt-1 text-[14px] text-[var(--lp-muted)]">Finished in the other tab? This updates by itself.</p>
            </div>
          ) : (
            <FlowButton id="kyc-modal-open-didit-btn" tone="accent" onClick={handleOpenDidit}>
              Start verification <ExternalLink className="size-4" />
            </FlowButton>
          )}
        </div>
      )}

      {step === "in_review" && (
        <div className="space-y-5">
          <p className="text-[15px] leading-[1.55] text-[var(--lp-body)]">
            {reverifySessionId
              ? "Your new ID is with our team for a quick check. We'll email you the result, and your current verification stays in place until then."
              : "Your ID is with our team for a quick check. We'll email you as soon as it's decided."}
          </p>
          <FlowButton tone="quiet" onClick={onClose}>
            Close
          </FlowButton>
        </div>
      )}

      {step === "approved" && (
        <FlowSuccess title="You're" italic="verified." body="Your identity is confirmed. You can cash out any amount.">
          <FlowButton id="kyc-modal-done-btn" onClick={onClose}>
            Done
          </FlowButton>
        </FlowSuccess>
      )}

      {step === "declined" && (
        <div className="space-y-5">
          <Notice tone="danger">
            {errorMsg ?? "We couldn't verify your identity this time. Try again with a clearer photo of your ID, or contact support."}
          </Notice>
          {actions(
            <FlowButton onClick={createSession} className="sm:flex-1">
              Try again
            </FlowButton>,
            <FlowButton tone="quiet" onClick={onClose} className="sm:w-32">
              Close
            </FlowButton>,
          )}
        </div>
      )}

      {step === "error" && (
        <div className="space-y-5">
          <Notice tone="danger">{errorMsg ?? "We couldn't start the check. Please try again."}</Notice>
          {actions(
            <FlowButton onClick={createSession} className="sm:flex-1">
              Try again
            </FlowButton>,
            <FlowButton tone="quiet" onClick={onClose} className="sm:w-32">
              Close
            </FlowButton>,
          )}
        </div>
      )}
    </FlowDialog>
  );
}
