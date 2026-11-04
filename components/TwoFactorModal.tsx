import React, { useState, useEffect, useRef } from "react";
import { Fingerprint, X } from "lucide-react";
import { FlowButton, FlowDialogHeading, FlowTabs } from "@/components/flow/ui";
import { PinPanel, PinPanelAction } from "@/components/security/PinPad";
import { createPortal } from "react-dom";
import { startAuthentication } from "@simplewebauthn/browser";
import { toast } from "sonner";

/**
 * The second factor on a large transaction.
 *
 * The PIN is deliberately not one of them. It is already required for EVERY outgoing
 * transaction, so offering it again here would mean one secret satisfying both checks — one
 * check wearing two hats. A second factor has to be something else you hold: your inbox, your
 * phone, or your device.
 */
export type VerificationMethod = "email" | "totp" | "passkey";

interface TwoFactorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (code: string, method?: VerificationMethod) => void;
  onResend?: () => void;
  loading: boolean;
  error?: string | null;
  method?: VerificationMethod;
  availableMethods?: VerificationMethod[];
  onMethodChange?: (method: VerificationMethod) => void;
  userEmail?: string;
}

export function TwoFactorModal({
  isOpen,
  onClose,
  onSubmit,
  onResend,
  loading,
  error,
  method = "email",
  availableMethods = ["email"],
  onMethodChange,
  userEmail = "",
}: TwoFactorModalProps) {
  const [code, setCode] = useState("");
  const [countdown, setCountdown] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const [currentMethod, setCurrentMethod] =
    useState<VerificationMethod>(method);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isFirstOpen = useRef(true);

  const startCountdown = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setCountdown(60);
    setCanResend(false);

    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setCanResend(true);
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    if (isOpen) {
      // Only set currentMethod from prop on first open, preserve user selection on re-open
      if (isFirstOpen.current) {
        setCurrentMethod(method);
        isFirstOpen.current = false;
      }
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            setCanResend(true);
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      timerRef.current = timer;
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setCode("");
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isOpen, method]);

  const handleResend = () => {
    if (canResend && onResend) {
      onResend();
      startCountdown();
    }
  };

  // Email and authenticator codes are both 6 digits.
  const codeLength = 6;

  const handleSubmit = () => {
    onSubmit(code, currentMethod);
  };

  const handleMethodChange = (newMethod: VerificationMethod) => {
    setCurrentMethod(newMethod);
    setCode("");
    if (onMethodChange) {
      onMethodChange(newMethod);
    }
    if (newMethod === "email" && onResend) {
      // Only send OTP if not sent yet or can resend
      if (!otpSent || canResend) {
        onResend();
        startCountdown();
        setOtpSent(true);
      }
    } else if (newMethod === "passkey") {
      // Trigger passkey authentication immediately when selected
      handlePasskeyAuth();
    }
  };

  const handlePasskeyAuth = async () => {
    if (!userEmail || isAuthenticating) return;

    setIsAuthenticating(true);
    try {
      const res = await fetch("/api/2fa/passkey/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate-options" }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate options");

      const { options, challengeId } = data;

      const authResponse = await startAuthentication(options);

      const verifyRes = await fetch("/api/2fa/passkey/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify-authentication",
          credential: authResponse,
          challengeId,
          authenticatorId: authResponse.id,
        }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok)
        throw new Error(verifyData.error || "Verification failed");

      toast.success("Passkey verified successfully");
      onSubmit("", "passkey");
    } catch (err) {
      console.error("Passkey authentication error:", err);
      toast.error("Passkey authentication failed. Please try again.");
      // Don't auto-switch to email on error, let user decide
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleClose = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    onClose();
  };

  if (!isOpen) return null;

  const methodLabel: Record<VerificationMethod, string> = { email: "Email", totp: "App", passkey: "Passkey" };

  // Portalled to <body> above the payment dialog it interrupts (deposit, withdraw, batch send),
  // and outside any page's cream scope, so it brings that scope with it.
  const modalContent = (
    <div className="lp-root contents">
      <div
        className="fixed inset-0 z-[9999] flex items-end justify-center bg-[rgba(17,26,19,0.5)] p-0 backdrop-blur-sm sm:items-center sm:p-4"
        onClick={handleClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="two-factor-title"
          className="pointer-events-auto relative max-h-[calc(100dvh-1rem)] w-full max-w-[460px] overflow-y-auto rounded-t-[28px] bg-[var(--lp-cream)] p-6 shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.06),0_32px_80px_-24px_rgb(17_26_19/0.45)] animate-in fade-in slide-in-from-bottom-4 duration-200 sm:rounded-[32px] sm:p-8 sm:zoom-in-95"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            aria-label="Close"
            className="absolute right-4 top-4 grid size-9 place-items-center rounded-full text-[var(--lp-muted)] transition-colors hover:bg-[var(--lp-sand)] hover:text-[var(--lp-ink)] disabled:opacity-50"
          >
            <X className="size-4" />
          </button>

          <div id="two-factor-title">
            <FlowDialogHeading
              eyebrow="Large payment"
              title="One more"
              italic="check."
            />
          </div>
          <p className="mt-3 text-[15px] leading-[1.55] text-[var(--lp-body)]">
            {currentMethod === "totp"
              ? "Enter the 6-digit code from your authenticator app to finish this payment."
              : currentMethod === "passkey"
                ? "Confirm with your face, fingerprint or device PIN to finish this payment."
                : userEmail
                  ? `We sent a 6-digit code to ${userEmail}. Enter it to finish this payment.`
                  : "We emailed you a 6-digit code. Enter it to finish this payment."}
          </p>

          <div className="mt-5 space-y-5">
            {availableMethods.length > 1 && (
              <FlowTabs
                label="How to confirm"
                value={currentMethod}
                onChange={handleMethodChange}
                options={availableMethods.map((m) => ({ value: m, label: methodLabel[m] }))}
              />
            )}

            {currentMethod === "passkey" ? (
              <FlowButton onClick={handlePasskeyAuth} loading={isAuthenticating}>
                <Fingerprint className="size-5" /> Confirm with passkey
              </FlowButton>
            ) : (
              <>
                <PinPanel
                  length={6}
                  label={currentMethod === "totp" ? "Code from your authenticator app" : "Code from your email"}
                  action={
                    currentMethod === "email" &&
                    (canResend ? (
                      <PinPanelAction onClick={handleResend} disabled={loading}>
                        Send another
                      </PinPanelAction>
                    ) : (
                      <>
                        Send another in <span className="lp-mono tabular-nums">{countdown}s</span>
                      </>
                    ))
                  }
                  value={code}
                  onChange={setCode}
                  onComplete={handleSubmit}
                  onEnter={() => code.length === codeLength && handleSubmit()}
                  disabled={loading}
                  error={error}
                  footer={
                    <FlowButton tone="accent" onClick={handleSubmit} loading={loading} disabled={code.length < codeLength}>
                      Confirm payment
                    </FlowButton>
                  }
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
