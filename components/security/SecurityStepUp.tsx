"use client";

/**
 * Proving a second factor before a security setting is weakened.
 *
 * This replaced the PIN prompt that used to guard these changes, and the reason is worth
 * stating plainly: the PIN already authorises every outgoing payment. Accepting it here too
 * would mean one secret satisfying both the payment check and the check that guards it —
 * somebody who reads it over a shoulder gets the money AND the ability to switch off
 * everything that would have stopped them.
 *
 * So turning a protection off costs one of the protections: the authenticator app, a passkey,
 * or a code emailed to the address on the account. Email is always offered, because every
 * account has one — nobody can be locked out of their own settings by this.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint, Loader2, Mail, ShieldAlert, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type SecurityControl = "two_fa" | "threshold" | "totp" | "passkey" | "pin";
type Method = "email" | "totp" | "passkey";

export interface StepUpRequest {
  /** What is about to change, in the user's words. */
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  /** Which control. The minted token is bound to it. */
  control: SecurityControl;
  /** Whether this account has an authenticator paired. */
  totpEnabled?: boolean;
  /** Whether this account has any passkey. */
  passkeyEnabled?: boolean;
  /** Runs once a factor is proven, with the single-use token the server requires. */
  run: (authorization: string) => Promise<void> | void;
}

export function SecurityStepUp({
  request,
  onClose,
}: {
  request: StepUpRequest | null;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<Method>("email");
  const [code, setCode] = useState("");
  const [codeId, setCodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const sentFor = useRef<string | null>(null);

  const methods: Method[] = [
    ...(request?.passkeyEnabled ? (["passkey"] as const) : []),
    ...(request?.totpEnabled ? (["totp"] as const) : []),
    "email",
  ];

  // Open on the strongest method the account actually has. Somebody with a passkey should not
  // have to wait for an email they did not need.
  useEffect(() => {
    if (!request) return;
    setCode("");
    setCodeId(null);
    setError(null);
    sentFor.current = null;
    setMethod(request.passkeyEnabled ? "passkey" : request.totpEnabled ? "totp" : "email");
  }, [request]);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch("/api/2fa/step-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, control: request?.control }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That did not work.");
      return data;
    },
    [request?.control],
  );

  const sendEmailCode = useCallback(async () => {
    if (!request || sending) return;
    setSending(true);
    setError(null);
    try {
      const data = await post({ action: "send" });
      setCodeId(data.codeId as string);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }, [request, sending, post]);

  // Requested once per opening, not on every render — a re-render must not mint another code
  // and trip the resend cooldown.
  useEffect(() => {
    if (!request || method !== "email") return;
    const key = `${request.control}:email`;
    if (sentFor.current === key) return;
    sentFor.current = key;
    void sendEmailCode();
  }, [request, method, sendEmailCode]);

  const finish = async (authorization: string) => {
    await request?.run(authorization);
    onClose();
  };

  const submitCode = async () => {
    if (!request || code.length < 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await post(
        method === "totp"
          ? { action: "verify-totp", code }
          : { action: "verify-email", code, codeId },
      );
      await finish(data.authorization as string);
    } catch (err) {
      setError((err as Error).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const usePasskey = async () => {
    if (!request || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { options, challengeId } = await post({ action: "passkey-options" });
      const credential = await startAuthentication(options);
      const data = await post({ action: "verify-passkey", challengeId, credential });
      await finish(data.authorization as string);
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "";
      // Backing out of the device prompt is a decision, not a failure worth shouting about.
      if (name !== "NotAllowedError") {
        setError((err as Error).message || "That passkey was not accepted.");
        toast.error("Could not confirm with your passkey.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="card-glass border-white/10 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl text-brand-secondary">
            {request?.title ?? "Confirm this change"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <p className="text-sm text-brand-secondary/70 leading-relaxed">
            {request?.description}
          </p>

          {/* Said out loud, because it is the question people ask here. */}
          <p className="flex items-start gap-2 text-[12px] text-brand-secondary/45 leading-relaxed">
            <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent/60" />
            <span>
              We ask for this instead of your PIN. Your PIN approves payments — if it also
              switched protections off, one secret would open both doors.
            </span>
          </p>

          {methods.length > 1 && (
            <div className="flex gap-2">
              {methods.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMethod(m);
                    setCode("");
                    setError(null);
                  }}
                  className={cn(
                    "flex items-center gap-2 px-3.5 py-2 rounded-lg text-[12.5px] font-medium transition-colors",
                    method === m
                      ? "bg-accent text-black"
                      : "bg-white/5 text-brand-secondary/60 hover:bg-white/10",
                  )}
                >
                  {m === "passkey" ? (
                    <Fingerprint className="w-4 h-4" />
                  ) : m === "totp" ? (
                    <Smartphone className="w-4 h-4" />
                  ) : (
                    <Mail className="w-4 h-4" />
                  )}
                  {m === "passkey" ? "Passkey" : m === "totp" ? "App" : "Email"}
                </button>
              ))}
            </div>
          )}

          {method === "passkey" ? (
            <button
              type="button"
              onClick={usePasskey}
              disabled={busy}
              className="btn-primary w-full h-12 gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
              {busy ? "Waiting for your device…" : "Confirm with your passkey"}
            </button>
          ) : (
            <label className="block">
              <span className="block mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30">
                {method === "totp" ? "Code from your app" : "Code from your email"}
              </span>
              <input
                value={code}
                onChange={(e) => {
                  setError(null);
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                }}
                onKeyDown={(e) => e.key === "Enter" && submitCode()}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                disabled={busy}
                className="w-full h-14 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-center text-xl font-bold tracking-[0.4em] text-brand-secondary focus:outline-none focus:border-accent/60"
              />
            </label>
          )}

          {method === "email" && (
            <p className="text-[12px] text-brand-secondary/40 text-center">
              {sending ? (
                "Sending…"
              ) : (
                <button
                  type="button"
                  onClick={sendEmailCode}
                  className="hover:text-brand-secondary/80 transition-colors"
                >
                  Didn&apos;t get it? Send another
                </button>
              )}
            </p>
          )}

          {error && <p className="text-[12.5px] text-orange-400 text-center">{error}</p>}
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={busy} className="btn-secondary flex-1">
            Cancel
          </button>
          {method !== "passkey" && (
            <button
              type="button"
              onClick={submitCode}
              disabled={busy || code.length < 6}
              className={cn(
                "btn-primary flex-1",
                request?.destructive && "!bg-red-500 !text-white hover:!bg-red-600",
              )}
            >
              {busy ? "Confirming…" : (request?.confirmLabel ?? "Confirm")}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
