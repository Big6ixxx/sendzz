"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldX,
  Shield,
  Loader2,
  ExternalLink,
  CheckCircle2,
  Clock,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { usePrivy } from "@privy-io/react-auth";

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
 * Guides the user through the Didit KYC verification flow:
 * 1. Creates a verification session (POST /api/kyc/session)
 * 2. Shows a link to the Didit-hosted flow (opens in new tab)
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
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-md rounded-3xl p-0 overflow-hidden border-0"
        style={{
          background: "rgba(12,12,16,0.97)",
          border: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <DialogHeader className="px-7 pt-7 pb-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-3 text-white font-bold text-lg">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(0,232,122,0.12)" }}
              >
                <Shield className="w-5 h-5" style={{ color: "#00e87a" }} />
              </div>
              Identity Verification
            </DialogTitle>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="px-7 py-6">
          <AnimatePresence mode="wait">
            {/* Creating session */}
            {step === "creating" && (
              <motion.div
                key="creating"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 py-8"
              >
                <Loader2
                  className="w-10 h-10 animate-spin"
                  style={{ color: "#00e87a" }}
                />
                <p
                  className="text-sm"
                  style={{ color: "rgba(248,248,246,0.5)" }}
                >
                  Setting up your verification session…
                </p>
              </motion.div>
            )}

            {/* Ready — show Didit link */}
            {(step === "ready" || step === "polling") && (
              <motion.div
                key="ready"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex flex-col gap-5"
              >
                {/* Info cards */}
                <div
                  className="rounded-2xl p-4 flex flex-col gap-3"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  {[
                    {
                      icon: "🪪",
                      text: "A government photo ID that shows your date of birth (in Nigeria, also your NIN or BVN)",
                    },
                    {
                      icon: "📷",
                      text: "Photograph the original ID, not a printout or a photo of a screen",
                    },
                    { icon: "🤳", text: "Liveness check (selfie)" },
                    { icon: "⏱", text: "Takes ~2 minutes" },
                  ].map(({ icon, text }) => (
                    <div key={text} className="flex items-center gap-3">
                      <span className="text-lg">{icon}</span>
                      <p
                        className="text-sm"
                        style={{ color: "rgba(248,248,246,0.6)" }}
                      >
                        {text}
                      </p>
                    </div>
                  ))}
                </div>

                <p
                  className="text-xs text-center"
                  style={{ color: "rgba(248,248,246,0.35)" }}
                >
                  Powered by{" "}
                  <a
                    href="https://didit.me"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:opacity-80"
                  >
                    Didit
                  </a>{" "}
                  · Your data is encrypted and never stored by Sendzz.
                </p>

                {step === "polling" ? (
                  <div className="flex flex-col items-center gap-3">
                    <div
                      className="flex items-center gap-2 text-sm"
                      style={{ color: "rgba(248,248,246,0.5)" }}
                    >
                      <Clock className="w-4 h-4 animate-pulse" />
                      Waiting for verification result…
                    </div>
                    <p
                      className="text-xs text-center"
                      style={{ color: "rgba(248,248,246,0.3)" }}
                    >
                      Completed? This page will update automatically.
                    </p>
                  </div>
                ) : (
                  <button
                    id="kyc-modal-open-didit-btn"
                    onClick={handleOpenDidit}
                    className="w-full py-3.5 rounded-2xl flex items-center justify-center gap-2 font-bold text-sm transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                    style={{
                      background:
                        "linear-gradient(135deg, #00e87a 0%, #00c468 100%)",
                      color: "#07070a",
                    }}
                  >
                    Start Verification
                    <ExternalLink className="w-4 h-4" />
                  </button>
                )}
              </motion.div>
            )}

            {/* Approved */}
            {step === "in_review" && (
              <motion.div
                key="in_review"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 py-8 text-center"
              >
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(245,158,11,0.15)" }}
                >
                  <Clock className="w-9 h-9" style={{ color: "#f59e0b" }} />
                </div>
                <div>
                  <p className="font-bold text-white text-lg">Being Reviewed</p>
                  <p className="text-sm mt-1" style={{ color: "rgba(248,248,246,0.5)" }}>
                    {reverifySessionId
                      ? "Your new ID is with our team for a quick check. We'll email you the result, and your current verification stays in place until then."
                      : "Your ID is with our team for a quick check. We'll email you as soon as it's decided."}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="mt-2 px-8 py-3 rounded-2xl font-bold text-sm border transition-all duration-200 hover:bg-white/5"
                  style={{ border: "1px solid rgba(255,255,255,0.1)", color: "rgba(248,248,246,0.8)" }}
                >
                  Close
                </button>
              </motion.div>
            )}

            {step === "approved" && (
              <motion.div
                key="approved"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 py-8 text-center"
              >
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(0,232,122,0.15)" }}
                >
                  <CheckCircle2
                    className="w-9 h-9"
                    style={{ color: "#00e87a" }}
                  />
                </div>
                <div>
                  <p className="font-bold text-white text-lg">
                    Verification Complete!
                  </p>
                  <p
                    className="text-sm mt-1"
                    style={{ color: "rgba(248,248,246,0.5)" }}
                  >
                    Your identity has been verified. You can now transact
                    freely.
                  </p>
                </div>
                <button
                  id="kyc-modal-done-btn"
                  onClick={onClose}
                  className="mt-2 px-8 py-3 rounded-2xl font-bold text-sm transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background:
                      "linear-gradient(135deg, #00e87a 0%, #00c468 100%)",
                    color: "#07070a",
                  }}
                >
                  Done
                </button>
              </motion.div>
            )}

            {/* Declined */}
            {step === "declined" && (
              <motion.div
                key="declined"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 py-8 text-center"
              >
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(239,68,68,0.12)" }}
                >
                  <ShieldX className="w-9 h-9" style={{ color: "#ef4444" }} />
                </div>
                <div>
                  <p className="font-bold text-white text-lg">
                    Verification Not Approved
                  </p>
                  <p
                    className="text-sm mt-1"
                    style={{ color: "rgba(248,248,246,0.5)" }}
                  >
                    {errorMsg ??
                      "We couldn't verify your identity at this time. Please try again with a clearer photo ID, or contact support."}
                  </p>
                </div>
                <div className="flex gap-3 mt-2">
                  <button
                    onClick={createSession}
                    className="px-6 py-2.5 rounded-xl font-bold text-sm border transition-all duration-200 hover:bg-white/5"
                    style={{
                      border: "1px solid rgba(255,255,255,0.1)",
                      color: "rgba(248,248,246,0.7)",
                    }}
                  >
                    Try Again
                  </button>
                  <button
                    onClick={onClose}
                    className="px-6 py-2.5 rounded-xl font-bold text-sm transition-all duration-200 hover:opacity-80"
                    style={{
                      background: "rgba(255,255,255,0.06)",
                      color: "rgba(248,248,246,0.5)",
                    }}
                  >
                    Close
                  </button>
                </div>
              </motion.div>
            )}

            {/* Error */}
            {step === "error" && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 py-8 text-center"
              >
                <ShieldX className="w-10 h-10" style={{ color: "#ef4444" }} />
                <div>
                  <p className="font-bold text-white">Something went wrong</p>
                  <p
                    className="text-sm mt-1"
                    style={{ color: "rgba(248,248,246,0.5)" }}
                  >
                    {errorMsg ??
                      "Could not start verification. Please try again."}
                  </p>
                </div>
                <button
                  onClick={createSession}
                  className="px-6 py-2.5 rounded-xl font-bold text-sm"
                  style={{
                    background: "rgba(0,232,122,0.1)",
                    color: "#00e87a",
                    border: "1px solid rgba(0,232,122,0.2)",
                  }}
                >
                  Retry
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}
