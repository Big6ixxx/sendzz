"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Shield, Smartphone, CheckCircle2, Check, Copy, KeyRound, LifeBuoy } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseAppError } from "@/lib/errors/appErrors";

interface TOTPSetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

type Step = "intro" | "qr" | "verify" | "success";

export function TOTPSetupWizard({
  open,
  onOpenChange,
  onComplete,
}: TOTPSetupWizardProps) {
  const [step, setStep] = useState<Step>("intro");
  const [loading, setLoading] = useState(false);
  const [qrUri, setQrUri] = useState("");
  // Returned by the setup endpoint and previously discarded. It is the only thing that lets
  // somebody re-add the app on a new phone, and the only option when a camera cannot scan.
  const [secret, setSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [error, setError] = useState("");
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleStartSetup = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/2fa/totp/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Setup failed");

      setQrUri(data.qrUri);
      setSecret(data.secret ?? "");
      setStep("qr");
    } catch (err) {
      toast.error(parseAppError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = useCallback(async () => {
    if (!verificationCode || verificationCode.length !== 6) {
      setError("Please enter a 6-digit code");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/2fa/totp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: verificationCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");

      setStep("success");
    } catch {
      setError("Invalid code. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [verificationCode]);

  const handleComplete = useCallback(() => {
    onComplete();
    onOpenChange(false);
    setStep("intro");
    setQrUri("");
    setVerificationCode("");
  }, [onComplete, onOpenChange]);

  useEffect(() => {
    if (step === "verify") {
      setTimeout(() => {
        inputRefs.current[0]?.focus();
      }, 100);
    }
  }, [step]);

  useEffect(() => {
    if (
      step === "verify" &&
      verificationCode.length === 6 &&
      !loading &&
      !error
    ) {
      handleVerify();
    }
  }, [verificationCode, step, loading, error, handleVerify]);

  useEffect(() => {
    if (step === "success") {
      handleComplete();
    }
  }, [step, handleComplete]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {step === "intro" && "Set up Authenticator App"}
            {step === "qr" && "Scan QR Code"}
            {step === "verify" && "Enter Verification Code"}
            {step === "success" && "Setup Complete"}
          </DialogTitle>
        </DialogHeader>

        {step === "intro" && (
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              An authenticator app shows a 6-digit code that changes every 30 seconds. We ask
              for it on large withdrawals, so that someone who has your password still cannot
              move your money without the phone in your pocket.
            </p>

            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted">
              <Smartphone className="w-5 h-5 mt-0.5 text-primary shrink-0" />
              <div>
                <p className="font-medium">Get an app, if you have not got one</p>
                <p className="text-sm text-muted-foreground">
                  Google Authenticator, Authy, 1Password and Bitwarden all work. Any of them
                  is fine — the code is the same.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted">
              <Shield className="w-5 h-5 mt-0.5 text-primary shrink-0" />
              <div>
                <p className="font-medium">Scan the code we show you</p>
                <p className="text-sm text-muted-foreground">
                  That links the app to this account. We will also show you a setup key to
                  save — that key is what lets you set the app up again on a new phone.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted">
              <LifeBuoy className="w-5 h-5 mt-0.5 text-primary shrink-0" />
              <div>
                <p className="font-medium">Losing your phone is not losing your account</p>
                <p className="text-sm text-muted-foreground">
                  You can always get a code by email instead. Turning the app off later just
                  needs one of those.
                </p>
              </div>
            </div>

            <Button
              onClick={handleStartSetup}
              disabled={loading}
              className="w-full"
            >
              {loading ? "Setting up..." : "Get Started"}
            </Button>
          </div>
        )}

        {step === "qr" && (
          <div className="space-y-6 py-4">
            <div className="flex flex-col items-center space-y-4">
              <div className="relative">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-accent to-accent/50 rounded-2xl blur opacity-30"></div>
                <div className="relative p-6 bg-gray-50 rounded-2xl shadow-2xl border-4 border-gray-200">
                  {qrUri && (
                    <div className="bg-white p-2 rounded-lg inline-block">
                      <QRCodeSVG
                        value={qrUri}
                        size={280}
                        level="H"
                        includeMargin={false}
                        bgColor="#FFFFFF"
                        fgColor="#000000"
                      />
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full border border-white/10">
                <Smartphone className="w-4 h-4 text-accent" />
                <span className="text-xs text-muted-foreground">
                  Scan with Google Authenticator, Authy, 1Password or Bitwarden
                </span>
              </div>
            </div>

            {/* The setup key, and what to do with it.
                
                Shown rather than hidden behind a "can't scan?" link, because it is not only
                for people who cannot scan — it is the ONLY way back if the phone is lost, and
                a key nobody noticed is a key nobody saved. */}
            {secret && (
              <div className="space-y-3 p-4 rounded-2xl border border-white/10 bg-white/[0.03]">
                <div className="flex items-start gap-3">
                  <KeyRound className="w-4 h-4 mt-0.5 text-accent shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold text-brand-secondary">
                      Save this setup key
                    </p>
                    <p className="text-[12px] text-muted-foreground leading-relaxed mt-0.5">
                      Can&apos;t scan? Type it into the app instead. Either way, keep a copy —
                      it is what lets you set this up again on a new phone.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-black/30 border border-white/10 font-mono text-[12.5px] text-brand-secondary break-all">
                    {secret}
                  </code>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(secret);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      } catch {
                        toast.error("Could not copy. Select the key and copy it manually.");
                      }
                    }}
                    className="shrink-0 p-2.5 rounded-lg border border-white/10 hover:bg-white/5 transition-colors text-brand-secondary/60"
                    aria-label="Copy setup key"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-accent" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>

                {/* Named specifically. "Store it securely" means nothing; the habits below
                    are the ones people actually have. */}
                <div className="space-y-1.5 pt-1 text-[12px] leading-relaxed">
                  <p className="text-accent/80">
                    <span className="font-semibold">Good places:</span> a password manager, or
                    written on paper somewhere only you can reach.
                  </p>
                  <p className="text-orange-400/80">
                    <span className="font-semibold">Not:</span> a screenshot in your camera
                    roll, a note that syncs to an unlocked cloud account, or a message to
                    yourself. Anyone who reads those can generate your codes.
                  </p>
                  <p className="text-muted-foreground">
                    We will not show you this key again after setup.
                  </p>
                </div>
              </div>
            )}

            <Button onClick={() => setStep("verify")} className="w-full h-12">
              I&apos;ve scanned the code and saved the key
            </Button>
          </div>
        )}

        {step === "verify" && (
          <div className="space-y-4 py-4">
            <p className="text-sm text-center text-muted-foreground">
              Enter the 6-digit code from your authenticator app
            </p>
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
                  value={verificationCode[index] || ""}
                  onChange={(e) => {
                    const value = e.target.value.replace(/[^0-9]/g, "");
                    const newCode = verificationCode.split("");
                    newCode[index] = value;
                    setVerificationCode(newCode.join(""));
                    if (value && index < 5) {
                      inputRefs.current[index + 1]?.focus();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Backspace" &&
                      !verificationCode[index] &&
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
                      setVerificationCode(pastedData);
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
            <Button
              onClick={handleVerify}
              disabled={loading || verificationCode.length < 6}
              className="w-full"
            >
              {loading ? "Verifying..." : "Verify"}
            </Button>
          </div>
        )}

        {step === "success" && (
          <div className="space-y-4 py-4 text-center">
            <CheckCircle2 className="w-16 h-16 mx-auto text-green-500" />
            <p className="text-lg font-medium">Your authenticator app is on</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              We will ask for a code from it on large withdrawals, and before any change to
              your security settings.
            </p>
            <p className="text-[12.5px] text-muted-foreground leading-relaxed">
              If you lose the phone, you can still confirm by email — and if you saved the
              setup key, you can add the app straight back on a new one.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
