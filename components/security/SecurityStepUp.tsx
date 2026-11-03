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
import { Fingerprint } from "lucide-react";
import { FlowButton, FlowDialog, FlowTabs } from "@/components/flow/ui";
import { PinPanel, PinPanelAction } from "@/components/security/PinPad";
import { toast } from "sonner";


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
    <FlowDialog
      open={!!request}
      onClose={onClose}
      eyebrow="Confirm it's you"
      title={request?.title ?? "Confirm this change"}
      description={request?.description}
    >
        <div className="space-y-5">
          {/* Said out loud, because it is the question people ask here. */}
          <p className="text-[13px] leading-[1.5] text-[var(--lp-muted)]">
            We ask for this instead of your PIN. Your PIN approves payments. If it also switched protections off, one
            secret would open both doors.
          </p>

          {methods.length > 1 && (
            <FlowTabs
              label="How to confirm"
              value={method}
              onChange={(m) => {
                setMethod(m);
                setCode("");
                setError(null);
              }}
              options={methods.map((m) => ({ value: m, label: m === "totp" ? "App" : m === "passkey" ? "Passkey" : "Email" }))}
            />
          )}

          {method === "passkey" ? (
            <>
              <div className="lp-card rounded-[22px] p-5 text-center">
              <p className="text-[15px] font-semibold">Use your face, fingerprint or device PIN</p>
              <p className="mt-1 text-[14px] text-[var(--lp-muted)]">Your device will ask once you press the button.</p>
            </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <FlowButton tone="quiet" onClick={onClose} disabled={busy} className="sm:w-32">
                  Cancel
                </FlowButton>
                <FlowButton onClick={usePasskey} loading={busy} className="sm:flex-1">
                  <Fingerprint className="size-5" /> Confirm with passkey
                </FlowButton>
              </div>
            </>
          ) : (
            <PinPanel
              length={6}
              label={method === "totp" ? "Code from your authenticator app" : "Code we emailed you"}
              action={
                method === "email" && (
                  <PinPanelAction onClick={sendEmailCode} disabled={sending}>
                    {sending ? "Sending…" : "Send another"}
                  </PinPanelAction>
                )
              }
              value={code}
              onChange={(digits) => {
                setError(null);
                setCode(digits);
              }}
              onComplete={submitCode}
              onEnter={submitCode}
              disabled={busy}
              error={error}
              footer={
                <>
                  <FlowButton tone={request?.destructive ? "danger" : "accent"} onClick={submitCode} loading={busy} disabled={code.length < 6}>
                    {request?.confirmLabel ?? "Confirm"}
                  </FlowButton>
                  <p className="text-center text-[14px]">
                    <PinPanelAction onClick={onClose} disabled={busy}>
                      Cancel
                    </PinPanelAction>
                  </p>
                </>
              }
            />
          )}
        </div>
    </FlowDialog>
  );
}
