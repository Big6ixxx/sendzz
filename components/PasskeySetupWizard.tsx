"use client";

import { useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { FlowButton, FlowDialog, FlowSuccess, Notice } from "@/components/flow/ui";
import { cn } from "@/lib/utils";
import { PinPad, PinPanel, PinPanelAction } from "@/components/security/PinPad";
import { toast } from "sonner";
import { ChevronRight, Loader2 } from "lucide-react";

interface PasskeySetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
  /**
   * Skip the chooser and set up this method directly.
   *
   * Settings lists the passkey and the PIN as separate rows, each added and removed on its
   * own, so a row opens the thing it names rather than asking again.
   */
  initialMethod?: Method;
}

type Step = "choose" | "registering" | "pin" | "success";
type Method = "biometric" | "pin";

/**
 * What the device can actually offer.
 *
 * `platform` is the built-in sensor — Face ID, Touch ID, Windows Hello, an Android screen
 * lock. It only exists on some devices, and offering it where there is none sends the user
 * into a dialog that can only fail, so it is asked for rather than assumed.
 *
 * `cross-platform` covers a security key or a phone scanned from another machine. Any browser
 * with WebAuthn can attempt it, so it is offered wherever passkeys work at all.
 */
function usePasskeySupport() {
  const [platform, setPlatform] = useState<boolean | null>(null);
  const [webauthn, setWebauthn] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      // Only a definitively missing API turns the passkey option off. Anything less
      // certain leaves it available, because refusing to offer it is worse than
      // offering it and letting the browser decline.
      const available =
        typeof window !== "undefined" && !!window.PublicKeyCredential;
      if (!available) {
        if (!cancelled) {
          setWebauthn(false);
          setPlatform(false);
        }
        return;
      }
      const hasSensor = await window.PublicKeyCredential
        .isUserVerifyingPlatformAuthenticatorAvailable()
        .catch(() => false);
      if (!cancelled) {
        setWebauthn(true);
        setPlatform(hasSensor);
      }
    };

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  return { platform, webauthn };
}

/** Name the sensor the way the user's own device does. */
function platformLabel(): { title: string; hint: string } {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/iPhone|iPad/i.test(ua)) {
    return { title: "Face ID or Touch ID", hint: "Built into this iPhone or iPad" };
  }
  if (/Macintosh/i.test(ua)) {
    return { title: "Touch ID", hint: "Built into this Mac" };
  }
  if (/Android/i.test(ua)) {
    return { title: "Fingerprint or face unlock", hint: "Built into this phone" };
  }
  if (/Windows/i.test(ua)) {
    return { title: "Windows Hello", hint: "Face, fingerprint or PIN on this PC" };
  }
  return { title: "This device", hint: "Use the screen lock on this device" };
}

/**
 * Turn a WebAuthn failure into something the person can act on.
 *
 * These errors are precise and each has a different remedy, so they must not be flattened
 * into one line. `SecurityError` in particular is a server misconfiguration, not anything the
 * user did — telling them to "try again" there guarantees they never succeed.
 */
function explainPasskeyError(name: string, raw: string): string {
  switch (name) {
    case "InvalidStateError":
      return "This device already has a passkey for your account. Remove it in Security, then add it again.";
    case "SecurityError":
      return "Passkeys are not set up for this address. This needs fixing on our side, so please contact support.";
    case "NotSupportedError":
      return "This device cannot create that kind of passkey. Try one of the other options.";
    case "AbortError":
      return "That took too long and timed out. Try again.";
    case "ConstraintError":
      return "Your device needs a screen lock, fingerprint or face unlock set up before it can hold a passkey.";
    default:
      return raw
        ? `Could not add the passkey: ${raw}`
        : "Could not add the passkey. Try again, or pick another option.";
  }
}

export function PasskeySetupWizard({
  open,
  onOpenChange,
  onComplete,
  initialMethod,
}: PasskeySetupWizardProps) {
  const [step, setStep] = useState<Step>("choose");
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<Method | null>(null);
  const { platform, webauthn } = usePasskeySupport();

  // Reopening after a cancel should start clean, not on the previous attempt's screen.
  useEffect(() => {
    if (!open) return;
    if (initialMethod === "pin") {
      setChosen("pin");
      setStep("pin");
    } else {
      setStep("choose");
      setChosen(null);
    }
  }, [open, initialMethod]);

  const register = async () => {
    setChosen("biometric");
    setLoading(true);
    setStep("registering");

    try {
      const res = await fetch("/api/2fa/passkey/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate-options" }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate options");

      const { options, challengeId } = data;
      const registrationResponse = await startRegistration(options);

      const verifyRes = await fetch("/api/2fa/passkey/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify-registration",
          credential: registrationResponse,
          challengeId,
        }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || "Verification failed");

      setStep("success");
      onComplete();
    } catch (err) {
      // The browser's own error name says exactly what went wrong. Collapsing all of them
      // into one message, as this did, turns a fixable problem into a dead end: a domain
      // misconfiguration and a passkey that already exists read identically to the user.
      const name = (err as { name?: string })?.name ?? "";
      const raw = err instanceof Error ? err.message : String(err);
      console.error("[Passkey] registration failed", { name, raw });

      // Backing out of the device prompt is a decision, not a failure.
      const cancelled =
        name === "NotAllowedError" || /cancel|abort|denied/i.test(raw);

      if (!cancelled) {
        toast.error(explainPasskeyError(name, raw), { duration: 8000 });
      }
      setStep("choose");
    } finally {
      setLoading(false);
    }
  };

  const p = platformLabel();

  const titles: Record<Step, [string, string]> = {
    choose: ["Approve with", "a touch."],
    registering: ["Waiting for", "your device."],
    pin: ["Choose", "four digits."],
    success: chosen === "pin" ? ["Your PIN", "is set."] : ["Passkey", "added."],
  };

  return (
    <FlowDialog
      open={open}
      onClose={() => onOpenChange(false)}
      size="md"
      eyebrow={step === "pin" ? "Transaction PIN" : "Passkey"}
      title={titles[step][0]}
      italic={titles[step][1]}
    >
      {/* ── Choose how to confirm ───────────────────────────────── */}
      {step === "choose" && (
        <div className="space-y-4">
          <p className="text-[15px] leading-[1.55] text-[var(--lp-body)]">
            Approve large withdrawals with your fingerprint, face or a PIN, instead of waiting for a code.
          </p>

          {!webauthn && <Notice tone="warning">This browser does not support passkeys. Try Chrome, Safari or Edge.</Notice>}

          <div className="space-y-2">
            {/* Offered whenever the browser supports passkeys at all. The sensor probe only decides
                what to call it: a Mac without Touch ID can still use a phone or a security key. */}
            {webauthn && (
              <MethodCard
                title={platform ? p.title : "Passkey"}
                hint={platform ? p.hint : "Use your phone, or a security key you plug in"}
                recommended
                disabled={loading}
                onClick={register}
              />
            )}
            <MethodCard
              title="4-digit PIN"
              hint="Works on any device, even without a fingerprint sensor"
              disabled={loading}
              onClick={() => {
                setChosen("pin");
                setStep("pin");
              }}
            />
          </div>

          {platform === null && webauthn && (
            <p className="flex items-center gap-2 text-[13px] text-[var(--lp-muted)]">
              <Loader2 className="size-3.5 animate-spin" /> Checking what this device supports…
            </p>
          )}
          {platform === false && webauthn && (
            <p className="text-[13px] text-[var(--lp-muted)]">
              This device has no fingerprint or face unlock set up. You can still use a passkey from your phone, or choose a PIN.
            </p>
          )}

          {/* What a passkey IS: people assume a password stored somewhere they can read, which is
              wrong in a way that matters, since there is nothing to write down. */}
          {webauthn && (
            <div className="space-y-2 rounded-[22px] bg-[var(--lp-sand)] p-4 text-[14px] leading-[1.55] text-[var(--lp-body)]">
              <p className="font-semibold text-[var(--lp-ink)]">About passkeys</p>
              <p>
                A passkey is not a password. There is nothing to write down: the key stays on your device, or in a password
                manager that syncs them, and your face, fingerprint or device PIN is what proves it is you.
              </p>
              <p>It cannot be phished either. It only works on the real Sendzz site.</p>
              <p>
                <span className="font-semibold text-[var(--lp-ink)]">If you lose the device,</span> a passkey that lives
                only on it goes with it. Email codes still get you in, but add a second method too.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Device prompt in progress ───────────────────────────── */}
      {step === "registering" && (
        <div className="space-y-4 py-6 text-center">
          <span className="lp-card mx-auto grid size-16 place-items-center rounded-full">
            <Loader2 className="size-7 animate-spin" />
          </span>
          <p className="text-[16px] font-semibold">{chosen === "biometric" ? `Confirm with ${p.title}` : "Follow the prompts from your browser"}</p>
          <p className="text-[14px] text-[var(--lp-muted)]">Nothing is saved until you approve it.</p>
        </div>
      )}

      {/* ── Choose a PIN ────────────────────────────────────────── */}
      {step === "pin" && (
        <PinSetup
          onDone={() => {
            setStep("success");
            onComplete();
          }}
          // Only when the chooser is behind us: opened straight from the PIN row there is nothing to go back to.
          footer={
            !initialMethod && (
              <p className="text-center text-[14px]">
                <PinPanelAction onClick={() => setStep("choose")}>Back to the options</PinPanelAction>
              </p>
            )
          }
        />
      )}

      {/* ── Done ────────────────────────────────────────────────── */}
      {step === "success" && (
        <div className="space-y-5">
          <FlowSuccess
            title={titles.success[0]}
            italic={titles.success[1]}
            body={
              chosen === "pin"
                ? "You will be asked for it on every payment. Only you know it; we store it scrambled and cannot read it back."
                : "Approve large withdrawals with a touch instead of a code. If you lose this device, an email code still gets you in."
            }
          />
          {/* Both can be set: a passkey is tied to one device, so a PIN alongside it is what works from a
              borrowed laptop or a new phone. Offered, never assumed. */}
          {!initialMethod && (
            <div className="space-y-2">
              <p className="text-center text-[14px] font-semibold">Add the other as well?</p>
              {chosen === "pin"
                ? webauthn && <MethodCard title={platform ? p.title : "Passkey"} hint="A second way in, in case you forget your PIN" onClick={register} />
                : (
                    <MethodCard
                      title="4-digit PIN"
                      hint="Works from any device, not just this one"
                      onClick={() => {
                        setChosen("pin");
                        setStep("pin");
                      }}
                    />
                  )}
              <FlowButton tone="quiet" onClick={() => onOpenChange(false)}>
                Not now
              </FlowButton>
            </div>
          )}
        </div>
      )}
    </FlowDialog>
  );
}

/** One choice in the list: what it is and where it works. No icon; the name carries it. */
function MethodCard({
  title,
  hint,
  recommended,
  disabled,
  onClick,
}: {
  title: string;
  hint: string;
  recommended?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-[20px] bg-[var(--lp-surface)] px-4 py-4 text-left shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)] outline-none transition-shadow hover:shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.3)] focus-visible:ring-2 focus-visible:ring-[#04c96a] disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[16px] font-semibold">{title}</span>
          {recommended && <span className="rounded-full bg-[var(--lp-good-soft)] px-2 py-px text-[11px] font-semibold text-[var(--lp-good)]">Fastest</span>}
        </span>
        <span className="mt-0.5 block text-[14px] text-[var(--lp-muted)]">{hint}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-[var(--lp-muted)]" />
    </button>
  );
}

/**
 * Choosing a PIN: enter it, then confirm it.
 *
 * Two rules shape this. The PIN is never sent anywhere until both entries match, so a typo is
 * caught here rather than becoming a PIN the user does not know. And the server, not this
 * component, is the authority on whether a PIN is acceptable — the check here is only to give
 * an answer instantly, and the same rules run again before anything is stored.
 */
export function PinSetup({
  onDone,
  tone = "cream",
  footer,
}: {
  onDone: () => void;
  tone?: "cream" | "forest";
  /** Extra actions on the panel under the keypad (cream screens only). */
  footer?: React.ReactNode;
}) {
  const [phase, setPhase] = useState<"enter" | "confirm">("enter");
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const value = phase === "enter" ? first : second;
  const setValue = phase === "enter" ? setFirst : setSecond;

  // PinPad hands back digits only, already capped at four.
  const onChange = (digits: string) => {
    setError(null);
    setValue(digits);

    if (digits.length === 4 && phase === "enter") {
      setPhase("confirm");
      return;
    }
    if (digits.length === 4 && phase === "confirm") {
      void submit(digits);
    }
  };

  const submit = async (confirmValue: string) => {
    if (confirmValue !== first) {
      setError("Those did not match. Start again.");
      setFirst("");
      setSecond("");
      setPhase("enter");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/2fa/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set", pin: first }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save your PIN.");
        setFirst("");
        setSecond("");
        setPhase("enter");
        return;
      }
      onDone();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const forest = tone === "forest";
  const label = phase === "enter" ? "Type your new PIN" : "Type it again to confirm";
  // Where they are in the two entries, as the same bars the money flows use; green on the forest.
  const bars = (
    <div className="flex gap-1.5" aria-hidden>
      {["enter", "confirm"].map((p) => (
        <span
          key={p}
          className={cn(
            "h-1.5 flex-1 rounded-full transition-colors duration-300",
            phase === "confirm" || p === "enter" ? "lp-fixed bg-[var(--lp-green)]" : "bg-[rgba(246,242,233,0.18)]",
          )}
        />
      ))}
    </div>
  );
  const saved = saving && (
    <p className={cn("flex items-center justify-center gap-2 text-center text-[14px]", forest ? "text-[#cfe0d6]" : "text-[var(--lp-muted)]")}>
      <Loader2 className="size-3.5 animate-spin" />
      Saving securely…
    </p>
  );

  // Already on a forest panel (the payment approval): no second panel around it.
  if (forest) {
    return (
      <div className="space-y-5">
        <div className="mx-auto max-w-[300px]">{bars}</div>
        <p className="text-center text-[15px] font-semibold text-[var(--lp-cream)]">{label}</p>
        {/* Keyed by phase so the pad starts empty and fresh for the confirming entry. */}
        <PinPad key={phase} value={value} onChange={onChange} error={error} disabled={saving} label={label} />
        {saved}
      </div>
    );
  }

  // The panel ends the dialog, so the note sits above it.
  return (
    <div className="space-y-5">
      <p className="text-[14px] leading-[1.55] text-[var(--lp-muted)]">
        Avoid birthdays and anything on your cards. Your PIN is scrambled before it is stored and cannot be turned back into
        digits, so if you forget it, it is replaced rather than recovered.
      </p>
      <PinPanel
        key={phase}
        above={bars}
        label={label}
        value={value}
        onChange={onChange}
        error={error}
        disabled={saving}
        footer={
          (saving || footer) && (
            <>
              {saving && (
                <p className="flex items-center justify-center gap-2 text-center text-[14px] text-[#cfe0d6]">
                  <Loader2 className="size-3.5 animate-spin" />
                  Saving securely…
                </p>
              )}
              {footer}
            </>
          )
        }
      />
    </div>
  );
}
