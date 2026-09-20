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

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PinInput } from "@/components/security/PinGate";

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
        setError(data.error ?? "Could not set your new PIN.");
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
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="card-glass border-white/10 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl text-brand-secondary">
            {step === "confirm" ? "Forgot your PIN?" : "Choose a new PIN"}
          </DialogTitle>
        </DialogHeader>

        {step === "confirm" ? (
          <div className="space-y-4 py-1">
            <p className="text-sm text-brand-secondary/70 leading-relaxed">
              Your PIN is stored in a way that cannot be reversed, so we genuinely cannot look
              it up or tell you what it was. What we can do is email you a code that lets you
              set a new one.
            </p>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-secondary/35">
                Code goes to
              </p>
              <p className="text-[13px] font-semibold text-brand-secondary mt-1 break-all">
                {email || "your account email"}
              </p>
            </div>
            <p className="text-[12px] text-brand-secondary/45 leading-relaxed">
              Your current PIN keeps working until you finish setting a new one.
            </p>

            {error && <p className="text-[12.5px] text-orange-400">{error}</p>}

            <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
              <button
                type="button"
                onClick={() => close(false)}
                disabled={busy}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={sendCode}
                disabled={busy}
                className="btn-primary flex-1"
              >
                {busy ? "Sending…" : "Email me a code"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-5 py-1">
            <p className="text-sm text-brand-secondary/70 leading-relaxed">
              Enter the 6-digit code we just emailed you, then pick a new PIN.
            </p>

            <label className="block">
              <span className="block mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30">
                Code from your email
              </span>
              <input
                value={code}
                onChange={(e) => {
                  setError(null);
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                disabled={busy}
                className="w-full h-13 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-center text-xl font-bold tracking-[0.4em] text-brand-secondary focus:outline-none focus:border-accent/60"
              />
            </label>

            <PinInput
              value={pin}
              onChange={(next) => {
                setError(null);
                setPin(next);
              }}
              label="New PIN"
              disabled={busy}
            />

            <PinInput
              value={confirmPin}
              onChange={(next) => {
                setError(null);
                setConfirmPin(next);
              }}
              onEnter={submit}
              label="Confirm new PIN"
              error={error}
              disabled={busy}
            />

            <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
              <button
                type="button"
                onClick={() => close(false)}
                disabled={busy}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy || code.length < 6 || pin.length < 4 || confirmPin.length < 4}
                className="btn-primary flex-1"
              >
                {busy ? "Saving…" : "Set new PIN"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
