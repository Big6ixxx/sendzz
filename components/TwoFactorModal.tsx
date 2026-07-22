import React, { useState, useEffect, useRef } from "react";
import {
  Loader2,
  X,
  RefreshCw,
  Smartphone,
  Mail,
  Fingerprint,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createPortal } from "react-dom";
import { startAuthentication } from "@simplewebauthn/browser";
import { toast } from "sonner";

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
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
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
      // Focus first input when modal opens
      setTimeout(() => {
        inputRefs.current[0]?.focus();
      }, 100);
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
        body: JSON.stringify({ email: userEmail, action: "generate-options" }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate options");

      const { options, challengeId } = data;

      const authResponse = await startAuthentication(options);

      const verifyRes = await fetch("/api/2fa/passkey/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userEmail,
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

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-md bg-[#0d0d0f] border border-white/10 rounded-2xl p-8 shadow-2xl animate-in fade-in zoom-in-95 duration-200 pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleClose}
          disabled={loading}
          className="absolute top-4 right-4 p-2 rounded-lg hover:bg-white/5 transition-colors disabled:opacity-50 z-10"
        >
          <X className="w-5 h-5 text-white/50" />
        </button>

        <div className="flex flex-col items-center text-center space-y-6 mb-8">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center border border-accent/30 shadow-lg shadow-accent/10">
            {currentMethod === "totp" ? (
              <Smartphone className="w-10 h-10 text-accent" />
            ) : currentMethod === "passkey" ? (
              <Fingerprint className="w-10 h-10 text-accent" />
            ) : (
              <Mail className="w-10 h-10 text-accent" />
            )}
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-black uppercase tracking-tighter text-white">
              Security Check
            </h2>
            <p className="text-sm font-medium text-white/60 leading-relaxed">
              {currentMethod === "totp"
                ? "Enter the 6-digit code from your authenticator app"
                : currentMethod === "passkey"
                  ? "Use your passkey to verify"
                  : "Enter the 6-digit code sent to your email to complete this transaction"}
            </p>
          </div>
        </div>

        {availableMethods.length > 1 && (
          <div className="flex gap-2 justify-center mb-6">
            {availableMethods.includes("email") && (
              <button
                onClick={() => handleMethodChange("email")}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                  currentMethod === "email"
                    ? "bg-accent text-black"
                    : "bg-white/5 text-white/60 hover:bg-white/10",
                )}
              >
                <Mail className="w-4 h-4" />
                Email
              </button>
            )}
            {availableMethods.includes("totp") && (
              <button
                onClick={() => handleMethodChange("totp")}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                  currentMethod === "totp"
                    ? "bg-accent text-black"
                    : "bg-white/5 text-white/60 hover:bg-white/10",
                )}
              >
                <Smartphone className="w-4 h-4" />
                App
              </button>
            )}
            {availableMethods.includes("passkey") && (
              <button
                onClick={() => handleMethodChange("passkey")}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                  currentMethod === "passkey"
                    ? "bg-accent text-black"
                    : "bg-white/5 text-white/60 hover:bg-white/10",
                )}
              >
                <Fingerprint className="w-4 h-4" />
                Passkey
              </button>
            )}
          </div>
        )}

        <div className="space-y-6">
          {currentMethod !== "passkey" && (
            <>
              <div className="space-y-3">
                <div className="flex gap-2 justify-center">
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <input
                      key={index}
                      ref={(el) => {
                        inputRefs.current[index] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={code[index] || ""}
                      onChange={(e) => {
                        const value = e.target.value.replace(/[^0-9]/g, "");
                        const newCode = code.split("");
                        newCode[index] = value;
                        setCode(newCode.join(""));
                        if (value && index < 5) {
                          inputRefs.current[index + 1]?.focus();
                        }
                      }}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Backspace" &&
                          !code[index] &&
                          index > 0
                        ) {
                          inputRefs.current[index - 1]?.focus();
                        }
                      }}
                      onPaste={(e) => {
                        e.preventDefault();
                        const pastedData = e.clipboardData
                          .getData("text")
                          .replace(/[^0-9]/g, "")
                          .slice(0, 6);
                        if (pastedData) {
                          setCode(pastedData);
                          const nextIndex = Math.min(pastedData.length, 5);
                          inputRefs.current[nextIndex]?.focus();
                        }
                      }}
                      className={cn(
                        "w-12 h-14 text-center text-2xl font-bold bg-white/5 border-2 rounded-xl text-white placeholder:text-white/20 focus:outline-none transition-all",
                        error
                          ? "border-red-500/50 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                          : "border-white/10 focus:border-accent focus:ring-2 focus:ring-accent/20",
                      )}
                      disabled={loading}
                    />
                  ))}
                </div>
                {error && (
                  <p className="text-xs font-bold text-red-400 uppercase tracking-widest text-center">
                    {error}
                  </p>
                )}
              </div>
            </>
          )}

          {currentMethod !== "passkey" && (
            <button
              onClick={handleSubmit}
              disabled={loading || code.length < 6}
              className="btn-primary w-full h-14 text-sm md:text-base font-bold tracking-wide"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="animate-spin w-5 h-5" />
                  Verifying...
                </span>
              ) : (
                "Verify Code"
              )}
            </button>
          )}

          {currentMethod === "email" && (
            <div className="text-center pt-2">
              {canResend ? (
                <button
                  onClick={handleResend}
                  disabled={loading}
                  className="text-sm font-medium text-accent hover:text-accent/80 transition-colors flex items-center justify-center gap-2 mx-auto"
                >
                  <RefreshCw className="w-4 h-4" />
                  Resend Code
                </button>
              ) : (
                <p className="text-sm text-white/40">
                  Resend available in{" "}
                  <span className="font-mono font-bold text-white/60">
                    {countdown}s
                  </span>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
