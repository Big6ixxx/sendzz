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
import { Shield, Smartphone, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseAppError } from "@/lib/errors/appErrors";

interface TOTPSetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  onComplete: () => void;
}

type Step = "intro" | "qr" | "verify" | "success";

export function TOTPSetupWizard({
  open,
  onOpenChange,
  email,
  onComplete,
}: TOTPSetupWizardProps) {
  const [step, setStep] = useState<Step>("intro");
  const [loading, setLoading] = useState(false);
  const [qrUri, setQrUri] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [error, setError] = useState("");
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleStartSetup = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/2fa/totp/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Setup failed");

      setQrUri(data.qrUri);
      setStep("qr");
    } catch (err) {
      toast.error(parseAppError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
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
        body: JSON.stringify({ email, token: verificationCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");

      setStep("success");
    } catch {
      setError("Invalid code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

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
  }, [verificationCode, step, loading, error]);

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
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted">
              <Smartphone className="w-5 h-5 mt-0.5 text-primary" />
              <div>
                <p className="font-medium">Download an authenticator app</p>
                <p className="text-sm text-muted-foreground">
                  We recommend Google Authenticator or Authy
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted">
              <Shield className="w-5 h-5 mt-0.5 text-primary" />
              <div>
                <p className="font-medium">Scan the QR code</p>
                <p className="text-sm text-muted-foreground">
                  Link your app to your Sendzz account
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted">
              <CheckCircle2 className="w-5 h-5 mt-0.5 text-primary" />
              <div>
                <p className="font-medium">Enter verification code</p>
                <p className="text-sm text-muted-foreground">
                  Confirm the setup is working
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
                  Scan with Google Authenticator, Authy, or any TOTP app
                </span>
              </div>
            </div>
            <Button onClick={() => setStep("verify")} className="w-full h-12">
              I&apos;ve scanned the code
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
            <p className="text-lg font-medium">Authenticator app enabled!</p>
            <p className="text-sm text-muted-foreground">
              Your account is now protected with 2FA
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
