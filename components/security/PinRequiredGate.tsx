"use client";

/**
 * The one-time explanation of why a transaction PIN exists, and the screen that sets it.
 *
 * Shown once, blocking, the first time someone reaches the dashboard without a PIN. It blocks
 * because the PIN is now required for every outgoing transaction: letting it be dismissed
 * would only move the interruption to the moment someone is mid-payment, which is the worst
 * possible time to be asked to invent and memorise four digits.
 *
 * --- On the wording ----------------------------------------------------------
 *
 * The copy below avoids "2FA", "second factor", "authentication" and every other word that
 * means something precise to us and nothing to the person reading it. What it says instead is
 * what is actually true and actually matters to them: this runs in a browser tab, a tab can be
 * reached by someone who is not you, and this is the thing that stops that person spending
 * your money. Someone who understands that will choose a PIN they can remember and will not
 * resent being asked for it later.
 *
 * It is also honest about the trade they are making. It says plainly that we cannot recover
 * the PIN, and it points at the way back in BEFORE they need it, because the moment they need
 * it is the moment they cannot get in to read about it.
 */

import { useEffect, useState } from "react";
import { KeyRound, Lock, MailCheck, ShieldCheck } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PinSetup } from "@/components/PasskeySetupWizard";

/** Whether this account has a PIN. Null while we do not yet know. */
export function usePinStatus(enabled: boolean) {
  const [hasPin, setHasPin] = useState<boolean | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    // Retried, because giving up once is giving up for the whole session.
    //
    // A failed check leaves `hasPin` null, and null keeps the gate SHUT — the right call on
    // its own terms, since guessing "no PIN" would throw an undismissable setup screen at
    // somebody who already has one. But it also means a single bad response, at the one
    // moment this runs, silently costs that user the setup prompt entirely. They then meet
    // the PIN at the till instead, asked for something nobody told them to create.
    //
    // The window is real: this fires the instant Privy reports ready, which is also when the
    // session cookie is newest and the account row may still be being written.
    let attempt = 0;
    const check = () => {
      fetch("/api/2fa/pin")
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((data) => {
          if (cancelled) return;
          setHasPin(!!data.enabled);
        })
        .catch(() => {
          if (cancelled || attempt >= 3) return;
          attempt += 1;
          // 1s, 2s, 4s. Long enough to outlast a cold start, short enough to land before
          // anyone has navigated to a payment screen.
          setTimeout(check, 1000 * 2 ** (attempt - 1));
        });
    };
    check();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { hasPin, setHasPin };
}

export function PinRequiredGate({
  open,
  onComplete,
}: {
  open: boolean;
  onComplete: () => void;
}) {
  const [step, setStep] = useState<"why" | "choose">("why");

  return (
    <Dialog open={open}>
      {/* No close affordance and no dismiss-on-outside-click: there is nothing behind this
          the user can safely do yet. `showCloseButton` is the dialog primitive's own opt-out. */}
      <DialogContent
        className="card-glass border-white/10 max-w-md"
        showCloseButton={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl text-brand-secondary">
            {step === "why" ? "Set up your transaction PIN" : "Choose a PIN"}
          </DialogTitle>
        </DialogHeader>

        {step === "why" ? (
          <div className="space-y-5 py-1">
            <p className="text-sm text-brand-secondary/70 leading-relaxed">
              Sendzz runs in a browser tab, the same as your email does. That makes it quick to
              get to — and it means anyone who reaches this tab while you are signed in could
              send your money without ever knowing your password.
            </p>
            <p className="text-sm text-brand-secondary/70 leading-relaxed">
              A 4-digit PIN closes that gap. From now on nothing leaves your account until the
              PIN is typed in, so an open laptop is no longer the same as an open wallet.
            </p>

            <div className="space-y-3">
              <Point
                icon={<Lock className="w-4 h-4" />}
                title="Signing in and sending are different things"
                body="Your email code gets you into Sendzz. Your PIN approves money leaving it. Two separate locks, so getting past one is not getting past both."
              />
              <Point
                icon={<KeyRound className="w-4 h-4" />}
                title="Only you ever know it"
                body="We scramble your PIN before storing it, in a way that cannot be undone. Nobody at Sendzz can look it up, and nobody will ever ask you for it — not by email, not in chat."
              />
              <Point
                icon={<ShieldCheck className="w-4 h-4" />}
                title="You'll be asked when money goes out"
                body="Sending, withdrawing and bridging ask for it every time. Receiving money, checking your balance and looking at your history never do."
              />
              <Point
                icon={<MailCheck className="w-4 h-4" />}
                title="If you forget it, you're not locked out"
                body="Because we can't read your PIN, we can't tell it to you. What we can do is email you a code that lets you set a new one — it's under Security in Settings, any time."
              />
            </div>

            <p className="text-[12px] text-brand-secondary/40 leading-relaxed">
              Pick four digits you will remember but nobody could guess from knowing you — not
              your birth year, and not the PIN on your bank card.
            </p>

            <button
              type="button"
              onClick={() => setStep("choose")}
              className="btn-primary w-full h-12"
            >
              Choose my PIN
            </button>
          </div>
        ) : (
          <PinSetup onDone={onComplete} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Point({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-accent/70">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold text-brand-secondary">{title}</span>
        <span className="block text-[12.5px] text-brand-secondary/50 leading-relaxed mt-0.5">
          {body}
        </span>
      </span>
    </div>
  );
}
