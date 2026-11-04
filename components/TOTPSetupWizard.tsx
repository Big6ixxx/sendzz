"use client";

import { useState, useEffect, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import { FlowButton, FlowDialog, FlowSteps, FlowSuccess } from "@/components/flow/ui";
import { PinPanel, PinPanelAction } from "@/components/security/PinPad";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
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

  const stepIndex = step === "intro" ? 0 : step === "qr" ? 1 : 2;
  const titles: Record<Step, [string, string]> = {
    intro: ["Add an", "authenticator app."],
    qr: ["Scan,", "then save the key."],
    verify: ["Enter the", "code it shows."],
    success: ["Your app", "is on."],
  };

  return (
    <FlowDialog
      open={open}
      onClose={() => onOpenChange(false)}
      size="md"
      eyebrow="Authenticator app"
      title={titles[step][0]}
      italic={titles[step][1]}
    >
      <div className="space-y-5">
        {step !== "success" && <FlowSteps steps={["Before you start", "Scan and save", "Confirm"]} current={stepIndex} />}

        {step === "intro" && (
          <>
            <p className="text-[15px] leading-[1.55] text-[var(--lp-body)]">
              An authenticator app shows a 6-digit code that changes every 30 seconds. We ask for it on large
              withdrawals, so someone who has your password still cannot move your money without your phone.
            </p>
            <ul className="divide-y divide-[var(--lp-line)] border-y border-[var(--lp-line)]">
              {[
                ["Get an app, if you have not got one", "Google Authenticator, Authy, 1Password and Bitwarden all work. Any of them is fine, the code is the same."],
                ["Scan the code we show you", "That links the app to this account. We also show you a setup key to save: it is what lets you set the app up again on a new phone."],
                ["Losing your phone is not losing your account", "You can always get a code by email instead. Turning the app off later just needs one of those."],
              ].map(([title, body]) => (
                <li key={title} className="py-3.5">
                  <p className="text-[15px] font-semibold">{title}</p>
                  <p className="mt-0.5 text-[14px] leading-[1.5] text-[var(--lp-body)]">{body}</p>
                </li>
              ))}
            </ul>
            <FlowButton onClick={handleStartSetup} loading={loading}>
              Show me the code
            </FlowButton>
          </>
        )}

        {step === "qr" && (
          <>
            {/* Pinned light in both modes: a scanner needs dark modules on a light ground. */}
            <div className="lp-fixed lp-card mx-auto w-fit rounded-[24px] p-5">
              {qrUri && <QRCodeSVG value={qrUri} size={208} level="H" includeMargin={false} bgColor="#ffffff" fgColor="#111a13" />}
            </div>
            <p className="text-center text-[14px] text-[var(--lp-muted)]">Open your authenticator app and scan this code.</p>

            {/* The setup key, shown rather than hidden behind "can't scan?": it is the only way back
                if the phone is lost, and a key nobody noticed is a key nobody saved. */}
            {secret && (
              <div className="space-y-3 rounded-[22px] bg-[var(--lp-sand)] p-4">
                <div>
                  <p className="text-[15px] font-semibold">Save this setup key</p>
                  <p className="mt-0.5 text-[14px] leading-[1.5] text-[var(--lp-body)]">
                    Can&apos;t scan? Type it into the app instead. Either way, keep a copy. We will not show it again.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <code className="lp-mono min-w-0 flex-1 break-all rounded-[14px] bg-[var(--lp-surface)] px-3 py-2.5 text-[13px]">{secret}</code>
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
                    className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--lp-surface)] transition-colors hover:bg-[var(--lp-cream)]"
                    aria-label="Copy setup key"
                  >
                    {copied ? <Check className="size-4 text-[var(--lp-good)]" /> : <Copy className="size-4" />}
                  </button>
                </div>
                {/* Named specifically: "store it securely" means nothing, these are the habits people have. */}
                <p className="text-[13px] leading-[1.5] text-[var(--lp-body)]">
                  <span className="font-semibold">Good places:</span> a password manager, or paper somewhere only you can
                  reach. <span className="font-semibold">Not</span> a screenshot, a synced note or a message to yourself:
                  anyone who reads those can make your codes.
                </p>
              </div>
            )}

            <FlowButton onClick={() => setStep("verify")}>I&apos;ve scanned it and saved the key</FlowButton>
          </>
        )}

        {step === "verify" && (
          <>
            <PinPanel
              length={6}
              label="Code from your authenticator app"
              value={verificationCode}
              onChange={(digits) => {
                setError("");
                setVerificationCode(digits);
              }}
              onEnter={handleVerify}
              disabled={loading}
              error={error || null}
              footer={
                <>
                  <FlowButton tone="accent" onClick={handleVerify} loading={loading} disabled={verificationCode.length < 6}>
                    Turn it on
                  </FlowButton>
                  <p className="text-center text-[14px]">
                    <PinPanelAction onClick={() => setStep("qr")} disabled={loading}>
                      Back to the code
                    </PinPanelAction>
                  </p>
                </>
              }
            />
          </>
        )}

        {step === "success" && (
          <FlowSuccess title="Your app" italic="is on." body="We will ask for a code from it on large withdrawals and before any change to your security settings." />
        )}
      </div>
    </FlowDialog>
  );
}
