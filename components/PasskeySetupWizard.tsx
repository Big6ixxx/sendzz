"use client";

import { useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PinInput } from "@/components/security/PinGate";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";

interface PasskeySetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
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
  email,
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
        body: JSON.stringify({ email, action: "generate-options" }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate options");

      const { options, challengeId } = data;
      const registrationResponse = await startRegistration(options);

      const verifyRes = await fetch("/api/2fa/passkey/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md card-glass border-white/10">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {/* Only when the chooser is behind us. Opened straight from the Transaction PIN
                row there is nothing to go back TO, and a control that returns somewhere the
                user never was is worse than no control. */}
            {step === "pin" && !initialMethod && (
              <button
                type="button"
                onClick={() => setStep("choose")}
                aria-label="Back"
                className="-ml-1.5 p-1.5 rounded-lg text-brand-secondary/45 hover:text-brand-secondary hover:bg-white/5 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <DialogTitle className="text-xl text-brand-secondary">
              {step === "choose" && "Secure your withdrawals"}
              {step === "registering" && "Waiting for your device"}
              {step === "pin" && "Choose a PIN"}
              {step === "success" && (chosen === "pin" ? "PIN set" : "Passkey added")}
            </DialogTitle>
          </div>
        </DialogHeader>

        {/* ── Choose how to sign in ───────────────────────────────── */}
        {step === "choose" && (
          <div className="space-y-4 py-1">
            <p className="text-sm text-brand-secondary/60">
              Sign in and approve large withdrawals without a code. Pick how you
              want to confirm it is you.
            </p>

            {!webauthn && (
              <div className="rounded-xl p-4 text-sm bg-orange-500/10 border border-orange-500/20 text-brand-secondary/80">
                This browser does not support passkeys. Try Chrome, Safari or Edge.
              </div>
            )}

            <div className="space-y-2.5">
              {/*
                Offered whenever the browser supports passkeys at all.
                
                It used to be gated on `isUserVerifyingPlatformAuthenticatorAvailable()`, which
                answers a narrower question than it looks: it reports whether THIS device has an
                enrolled sensor, and returns false on a Mac without Touch ID set up or a PC
                without Windows Hello. Those browsers can still register a passkey perfectly
                well — via a phone, or a security key — so gating on it removed the option from
                people who could have used it.
                
                The probe now only decides what to CALL it, never whether to show it.
              */}
              {webauthn && (
                <MethodCard
                  title={platform ? p.title : "Passkey"}
                  hint={
                    platform
                      ? p.hint
                      : "Use your phone, or a security key you plug in"
                  }
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
              <p className="text-xs text-brand-secondary/40 flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                Checking what this device supports…
              </p>
            )}

            {platform === false && webauthn && (
              <p className="text-xs text-brand-secondary/40">
                This device has no fingerprint or face unlock set up. You can
                still use a passkey from your phone, or choose a PIN.
              </p>
            )}
          </div>
        )}

        {/* ── Device prompt in progress ───────────────────────────── */}
        {step === "registering" && (
          <div className="py-10 text-center space-y-5">
            <Loader2 className="w-7 h-7 mx-auto animate-spin text-brand-secondary/35" />
            <div className="space-y-1.5">
              <p className="font-semibold text-brand-secondary">
                {chosen === "biometric"
                  ? `Confirm with ${p.title}`
                  : "Follow the prompts from your browser"}
              </p>
              <p className="text-sm text-brand-secondary/50">
                Nothing is saved until you approve it.
              </p>
            </div>
          </div>
        )}

        {/* ── Choose a PIN ────────────────────────────────────────── */}
        {step === "pin" && (
          <PinSetup
            onDone={() => {
              setStep("success");
              onComplete();
            }}
          />
        )}

        {/* ── Done ────────────────────────────────────────────────── */}
        {step === "success" && (
          <div className="py-8 text-center space-y-4">
            <div className="space-y-1.5">
              <p className="font-semibold text-brand-secondary">
                {chosen === "pin"
                  ? "Your PIN is set"
                  : "You can now approve with your passkey"}
              </p>
              <p className="text-sm text-brand-secondary/50">
                {chosen === "pin"
                  ? "You will be asked for it on large withdrawals. Only you know it."
                  : "Approve large withdrawals with a touch instead of a code."}
              </p>
            </div>

            {/*
              Both can be set, and having both is worth offering: a passkey is tied to one
              device, so a PIN alongside it is what gets you in from a borrowed laptop or a
              replaced phone. Offered rather than assumed, and the dialog closes on its own if
              they would rather not.
            */}
            {!initialMethod && (
            <div className="pt-2 space-y-2.5 text-left">
              <p className="text-[11px] font-bold uppercase tracking-wider text-brand-secondary/35 text-center">
                Add the other as well?
              </p>
              {chosen === "pin"
                ? webauthn && (
                    <MethodCard
                      title={platform ? p.title : "Passkey"}
                      hint="A second way in, in case you forget your PIN"
                      onClick={register}
                    />
                  )
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
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="w-full text-[12.5px] text-brand-secondary/45 hover:text-brand-secondary/80 transition-colors py-1"
              >
                Not now
              </button>
            </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * One choice in the list.
 *
 * No icon: the settings rows this sits alongside identify a method by its name, and an
 * accent-tinted glyph beside every option added colour without adding meaning.
 */
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
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left",
        "border border-white/10 bg-white/[0.03]",
        "transition-colors hover:bg-white/[0.06] hover:border-white/20",
        "disabled:opacity-40 disabled:pointer-events-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-brand-secondary">
            {title}
          </span>
          {recommended && (
            <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-accent">
              Fastest
            </span>
          )}
        </span>
        <span className="block text-[12px] text-brand-secondary/45 mt-0.5">
          {hint}
        </span>
      </span>
      <ChevronRight className="w-4 h-4 shrink-0 text-brand-secondary/25" />
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
function PinSetup({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<"enter" | "confirm">("enter");
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const value = phase === "enter" ? first : second;
  const setValue = phase === "enter" ? setFirst : setSecond;

  // PinInput hands back digits only, already capped at four.
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

  return (
    <div className="space-y-5 py-1">
      <p className="text-sm text-brand-secondary/60">
        {phase === "enter"
          ? "Pick 4 digits you will remember. Avoid birthdays and anything on your cards."
          : "Enter it once more to confirm."}
      </p>

      <div className="space-y-3">
        <PinInput
          value={value}
          onChange={onChange}
          error={error}
          label={phase === "enter" ? "Choose your PIN" : "Confirm your PIN"}
          srOnlyLabel
          autoComplete="one-time-code"
          disabled={saving}
          autoFocus
        />

        {saving && (
          <p className="text-[12.5px] text-brand-secondary/40 text-center flex items-center justify-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            Saving securely…
          </p>
        )}
      </div>

      <div className="rounded-xl p-3.5 bg-white/[0.03] border border-white/10">
        <p className="text-[12px] text-brand-secondary/55 leading-relaxed">
          Your PIN is scrambled before it is stored, and it cannot be turned back into digits.
          Nobody at Sendzz can see it or look it up, so keep it somewhere safe: if you forget
          it, it has to be replaced rather than recovered.
        </p>
      </div>
    </div>
  );
}
