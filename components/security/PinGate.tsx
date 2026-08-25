"use client";

/**
 * Confirming a security change with the transaction PIN.
 *
 * Every control that weakens the account — removing a passkey, unpairing an authenticator,
 * turning off verification, raising the threshold at which it applies — asks for the PIN first.
 * Without that, anyone who reaches an unlocked session can quietly strip every protection and
 * then withdraw freely, which makes the other factors decorative.
 *
 * The PIN is checked by the server, which also owns the attempt counter. Verifying here would
 * be worthless: a 4-digit secret is only defensible when guessing is rate limited somewhere the
 * caller cannot skip.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface PinGateRequest {
  /** What the PIN is authorising, in the user's words. */
  title: string;
  description: string;
  /** Wording for the confirm button, e.g. "Remove passkey". */
  confirmLabel: string;
  /** Whether the action is destructive, which the button colour follows. */
  destructive?: boolean;
  /** Runs only after the PIN is accepted. */
  run: () => Promise<void> | void;
}

export function PinGate({
  request,
  onClose,
}: {
  request: PinGateRequest | null;
  onClose: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (request) {
      setPin("");
      setError(null);
    }
  }, [request]);

  const confirm = async () => {
    if (!request || pin.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/2fa/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        // The server's message carries the attempts left, or how long a lockout has to run.
        setError(data.error ?? "That PIN was not accepted.");
        setPin("");
        return;
      }
      await request.run();
      onClose();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!request} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="card-glass border-white/10 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl text-brand-secondary">
            {request?.title ?? "Confirm with your PIN"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-brand-secondary/70 leading-relaxed">
            {request?.description}
          </p>

          <PinInput
            value={pin}
            onChange={(v) => {
              setError(null);
              setPin(v);
            }}
            onEnter={confirm}
            error={error}
            autoFocus
          />
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-4">
          <button onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={busy || pin.length < 4}
            className={
              request?.destructive
                ? "btn-primary flex-1 !bg-red-500 !text-white hover:!bg-red-600"
                : "btn-primary flex-1"
            }
          >
            {busy ? "Confirming..." : (request?.confirmLabel ?? "Confirm")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The 4-digit PIN field, wherever one is asked for.
 *
 * One real input sitting invisible behind four painted boxes. A grid of four separate inputs
 * is the obvious way to build this and the wrong one: it breaks paste, fights autofill, and
 * loses the mobile numeric keypad as focus jumps between fields. Here the browser only ever
 * sees a single numeric field.
 *
 * Digits only and capped at four in one place, so no caller can accidentally accept a fifth
 * character or a letter and send something the server will only reject after a round trip.
 */
export function PinInput({
  value,
  onChange,
  onEnter,
  error,
  label = "Transaction PIN",
  srOnlyLabel,
  autoFocus,
  disabled,
  autoComplete = "off",
}: {
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  error?: string | null;
  label?: string;
  /** Hide the label visually when the surrounding copy already says what to type. */
  srOnlyLabel?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  autoComplete?: string;
}) {
  return (
    <div className="space-y-3">
      <label className="block relative">
        <span
          className={cn(
            srOnlyLabel
              ? "sr-only"
              : "block mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30",
          )}
        >
          {label}
        </span>

        <input
          autoFocus={autoFocus}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter) onEnter();
          }}
          inputMode="numeric"
          type="password"
          autoComplete={autoComplete}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />

        <span className="flex gap-2.5 justify-center pointer-events-none">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cn(
                "h-14 rounded-xl flex items-center justify-center border",
                "text-2xl font-bold text-brand-secondary transition-colors",
                error
                  ? "border-orange-400/40 bg-orange-500/5"
                  : value.length === i && !disabled
                    ? "border-accent/60 bg-accent/5"
                    : "border-white/10 bg-white/[0.03]",
              )}
              style={{ width: 52 }}
            >
              {value[i] ? "\u2022" : ""}
            </span>
          ))}
        </span>
      </label>

      {error && <p className="text-[12.5px] text-orange-400 text-center">{error}</p>}
    </div>
  );
}
