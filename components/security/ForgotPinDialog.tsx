"use client";

/**
 * Setting a new PIN after forgetting the old one.
 *
 * Two steps in one dialog: send a code to the account's own email, then use that code to set a
 * new PIN. The old PIN is never involved, because by definition it cannot be — and never
 * revealed, because it cannot be read back at all.
 *
 * Reachable from the PIN prompt itself, which is the only place the problem is ever noticed.
 * A recovery path that lives only in Settings is a recovery path nobody finds: the user is
 * standing in front of a prompt they cannot answer, and telling them to go and look elsewhere
 * is how a forgotten PIN turns into a support ticket.
 */

import { useState } from "react";
import { toast } from "sonner";

import { PinPanel, PinPanelAction } from "@/components/security/PinPad";
import { FlowButton, FlowDialog, Notice } from "@/components/flow/ui";

type Step = "confirm" | "code";

export function ForgotPinDialog({
  open,
  onOpenChange,
  email,
  onReset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown so the user can see WHERE the code is going before asking for it. */
  email: string;
  /** Fired once a new PIN is in place. */
  onReset: () => void;
}) {
  const [step, setStep] = useState<Step>("confirm");
  const [resetId, setResetId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [phase, setPhase] = useState<"code" | "pin" | "confirm">("code");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = (next: boolean) => {
    if (busy) return;
    if (!next) {
      setStep("confirm");
      setResetId(null);
      setCode("");
      setPin("");
      setConfirmPin("");
      setPhase("code");
      setError(null);
    }
    onOpenChange(next);
  };

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/2fa/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-request" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not send the code.");
        return;
      }
      setResetId(data.resetId as string);
      setStep("code");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    // Checked here so a typo costs a keystroke rather than a round trip and a spent code.
    if (pin !== confirmPin) {
      setError("Those two PINs are different. Try again.");
      setConfirmPin("");
      setPin("");
      setPhase("pin");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/2fa/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset", resetId, resetCode: code, pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Start the entry again from the code: the server's message says what to fix.
        setError(data.error ?? "Could not set your new PIN.");
        setCode("");
        setPin("");
        setConfirmPin("");
        setPhase("code");
        return;
      }
      toast.success("Your new PIN is set.");
      onReset();
      close(false);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlowDialog
      open={open}
      onClose={() => close(false)}
      eyebrow={step === "confirm" ? "Reset your PIN" : "Check your email"}
      title={step === "confirm" ? "Forgot" : "Choose a"}
      italic={step === "confirm" ? "your PIN?" : "new one."}
    >
        {step === "confirm" ? (
          <div className="space-y-4">
            <p className="text-[15px] leading-[1.6] text-[var(--lp-body)]">
              Your PIN is stored in a way that cannot be reversed, so we genuinely cannot look it up.
              We can email you a code that lets you set a new one.
            </p>
            <div className="lp-card rounded-[18px] px-4 py-3.5">
              <p className="text-[13px] text-[var(--lp-muted)]">The code goes to</p>
              <p className="mt-0.5 break-all text-[15px] font-semibold">{email || "your account email"}</p>
            </div>
            <p className="text-[13px] leading-[1.5] text-[var(--lp-muted)]">
              Your current PIN keeps working until you finish setting a new one.
            </p>

            {error && <Notice tone="danger">{error}</Notice>}

            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row">
              <FlowButton tone="quiet" onClick={() => close(false)} disabled={busy} className="sm:w-32">
                Cancel
              </FlowButton>
              <FlowButton onClick={sendCode} loading={busy} className="sm:flex-1">
                Email me a code
              </FlowButton>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {/* One keypad, re-keyed per phase so each entry starts empty. */}
            <PinPanel
              key={phase}
              above={
                <div className="flex gap-1.5" aria-hidden>
                  {(["code", "pin", "confirm"] as const).map((p, i) => (
                    <span
                      key={p}
                      className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                        i <= ["code", "pin", "confirm"].indexOf(phase) ? "bg-[var(--lp-green)]" : "bg-[rgba(246,242,233,0.18)]"
                      }`}
                    />
                  ))}
                </div>
              }
              length={phase === "code" ? 6 : 4}
              label={phase === "code" ? "Code from your email" : phase === "pin" ? "Your new PIN" : "The new PIN again"}
              action={
                phase !== "code" && (
                  <PinPanelAction
                    onClick={() => {
                      setError(null);
                      if (phase === "confirm") {
                        setConfirmPin("");
                        setPin("");
                        setPhase("pin");
                      } else {
                        setPin("");
                        setPhase("code");
                      }
                    }}
                  >
                    Back
                  </PinPanelAction>
                )
              }
              value={phase === "code" ? code : phase === "pin" ? pin : confirmPin}
              onChange={(digits) => {
                setError(null);
                if (phase === "code") setCode(digits);
                else if (phase === "pin") setPin(digits);
                else setConfirmPin(digits);
              }}
              onComplete={() => {
                if (phase === "code") setPhase("pin");
                else if (phase === "pin") setPhase("confirm");
                else void submit();
              }}
              disabled={busy}
              error={error}
              footer={
                <>
                  {/* After a failed send (a dropped connection) the entry is still good: send it again. */}
                  {phase === "confirm" && confirmPin.length === 4 && error && !busy && (
                    <FlowButton tone="accent" onClick={() => void submit()}>
                      Try again
                    </FlowButton>
                  )}
                  <p className="text-center text-[14px]">
                    <PinPanelAction onClick={() => close(false)} disabled={busy}>
                      Cancel
                    </PinPanelAction>
                  </p>
                </>
              }
            />
          </div>
        )}
    </FlowDialog>
  );
}
